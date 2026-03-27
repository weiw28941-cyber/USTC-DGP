import {
    getOutputLoadedCount,
    getOutputSocketId,
    getOutputTotalCount,
    isGeometryViewerPayload,
    isPagedOutput
} from './output_transport.js';

class ExecutionResultApplier {
    constructor(editor) {
        this.editor = editor;
    }

    applyPagedPreviewValue(node, outputValue, socketId) {
        const existingPreviewValue = node?.previewValue;
        const hadLoadedArray = Array.isArray(existingPreviewValue);
        const isPagedDescriptor = isPagedOutput(outputValue);

        if (!isPagedDescriptor) {
            node.previewValue = outputValue;
            node.previewMeta.socketId = socketId;
            node.previewMeta.loadedCount = Array.isArray(node.previewValue)
                ? node.previewValue.length
                : null;
            return;
        }

        node.previewMeta.socketId = getOutputSocketId(outputValue, socketId);
        node.previewMeta.totalCount = getOutputTotalCount(outputValue, node.previewMeta.totalCount ?? null);
        node.previewMeta.pageSize = Number.isFinite(outputValue?.stream?.pageSize)
            ? Number(outputValue.stream.pageSize)
            : (node.previewMeta.pageSize ?? null);
        node.previewMeta.rows = Number.isFinite(outputValue?.stream?.rows)
            ? Number(outputValue.stream.rows)
            : (node.previewMeta.rows ?? null);
        node.previewMeta.cols = Number.isFinite(outputValue?.stream?.cols)
            ? Number(outputValue.stream.cols)
            : (node.previewMeta.cols ?? null);
        node.previewMeta.pageUnit = typeof outputValue?.stream?.pageUnit === 'string'
            ? outputValue.stream.pageUnit
            : (node.previewMeta.pageUnit ?? null);

        if (hadLoadedArray) {
            node.previewMeta.loadedCount = existingPreviewValue.length;
            node.previewMeta.hasMorePages = Number(node.previewMeta.totalCount || 0) > existingPreviewValue.length;
            return;
        }

        node.previewValue = outputValue;
        node.previewMeta.loadedCount = getOutputLoadedCount(outputValue, 0);
        node.previewMeta.hasMorePages = Number(node.previewMeta.totalCount || 0) > 0;
    }

    updateNodeFromExecution(node, nodeResult, errorLines) {
        if (!node || !nodeResult) return;
        node.success = !!nodeResult.success;
        node.errorMessage = nodeResult.error || '';
        node.errorInputs.clear();
        node.errorOutputs.clear();
        const existingPreviewMeta = (node.previewMeta && typeof node.previewMeta === 'object')
            ? node.previewMeta
            : {};
        node.previewMeta = {
            ...existingPreviewMeta,
            outputsTruncated: nodeResult.outputs_truncated === true,
            maxPreviewItems: Number.isFinite(nodeResult.max_preview_items)
                ? Number(nodeResult.max_preview_items)
                : null,
            socketId: null,
            totalCount: existingPreviewMeta.totalCount ?? null,
            loadedCount: existingPreviewMeta.loadedCount ?? null,
            hasMorePages: existingPreviewMeta.hasMorePages ?? false,
            pageSize: existingPreviewMeta.pageSize ?? null,
            rows: existingPreviewMeta.rows ?? null,
            cols: existingPreviewMeta.cols ?? null,
            pageUnit: existingPreviewMeta.pageUnit ?? null,
            previewEpoch: existingPreviewMeta.previewEpoch ?? 0
        };

        if (nodeResult.outputs) {
            node.previewMeta.previewEpoch = Number(node.previewMeta.previewEpoch || 0) + 1;
            if (node.type === 'interaction_state') {
                this.editor.lastInteractionStateOutputs = nodeResult.outputs;
                if (nodeResult.outputs.event !== undefined) {
                    node.interaction_event = nodeResult.outputs.event;
                }
            }
            if (nodeResult.outputs.interaction !== undefined && node.type === 'geometry_viewer') {
                node.interaction_event = nodeResult.outputs.interaction;
            }
            if (nodeResult.outputs.view !== undefined) {
                node.previewValue = nodeResult.outputs.view;
                node.previewMeta.socketId = 'view';
                node.previewMeta.loadedCount = Array.isArray(node.previewValue?.positions)
                    ? node.previewValue.positions.length
                    : null;
            } else if (node.type === 'interaction_state') {
                const outEvent = (nodeResult.outputs.event && typeof nodeResult.outputs.event === 'object')
                    ? nodeResult.outputs.event
                    : {};
                const outState = (nodeResult.outputs.state && typeof nodeResult.outputs.state === 'object')
                    ? nodeResult.outputs.state
                    : {};
                node.previewValue = {
                    channel: nodeResult.outputs.channel ?? '',
                    phase: nodeResult.outputs.phase ?? '',
                    target: nodeResult.outputs.target ?? -1,
                    version: nodeResult.outputs.version ?? 0,
                    sourceNodeId: outEvent.sourceNodeId ?? -1,
                    timestampMs: outEvent.timestampMs ?? outState.timestampMs ?? 0,
                    event: outEvent,
                    payload: nodeResult.outputs.payload ?? {},
                    committed: nodeResult.outputs.committed ?? {},
                    transient: nodeResult.outputs.transient ?? {},
                    channel_state: nodeResult.outputs.channel_state ?? {},
                    state: outState,
                    channels: outState.channels ?? {},
                    phaseMatched: nodeResult.outputs.phaseMatched ?? 0
                };
                node.previewMeta.socketId = 'state';
            } else if (node.type === 'vector' && nodeResult.outputs.vec !== undefined) {
                this.applyPagedPreviewValue(node, nodeResult.outputs.vec, 'vec');
            } else if (node.type === 'list' && nodeResult.outputs.list !== undefined) {
                this.applyPagedPreviewValue(node, nodeResult.outputs.list, 'list');
            } else if (node.type === 'matrix' && nodeResult.outputs.mat !== undefined) {
                this.applyPagedPreviewValue(node, nodeResult.outputs.mat, 'mat');
            } else if (nodeResult.outputs.result !== undefined) {
                this.applyPagedPreviewValue(node, nodeResult.outputs.result, 'result');
            } else {
                const outputKeys = Object.keys(nodeResult.outputs);
                if (outputKeys.length > 0) {
                    this.applyPagedPreviewValue(node, nodeResult.outputs[outputKeys[0]], outputKeys[0]);
                }
            }
        } else if (nodeResult.outputs_omitted !== true) {
            node.previewValue = null;
            node.previewMeta.socketId = null;
            node.previewMeta.loadedCount = null;
            node.previewMeta.previewEpoch = Number(node.previewMeta.previewEpoch || 0) + 1;
        }
        if (node.previewMeta.outputsTruncated === true && node.previewMeta.loadedCount !== null) {
            node.previewMeta.totalCount = Math.max(
                Number(node.previewMeta.totalCount || 0),
                Number(node.previewMeta.loadedCount)
            );
            node.previewMeta.hasMorePages = true;
        } else if (node.previewMeta.outputsTruncated !== true) {
            node.previewMeta.totalCount = node.previewMeta.loadedCount;
            node.previewMeta.hasMorePages = false;
            node.previewMeta.pageSize = null;
            node.previewMeta.rows = null;
            node.previewMeta.cols = null;
            node.previewMeta.pageUnit = null;
        }

        if (isGeometryViewerPayload(node.previewValue)) {
            if (typeof this.editor.meshViewerPanel?.setPreviewStatus === 'function') {
                this.editor.meshViewerPanel.setPreviewStatus(
                    node.previewMeta?.outputsTruncated === true
                        ? 'Lightweight geometry preview'
                        : 'Full geometry loaded'
                );
            }
            if (typeof this.editor.meshViewerPanel?.scheduleRuntimeWarmup === 'function') {
                this.editor.meshViewerPanel.scheduleRuntimeWarmup();
            }
            if (typeof this.editor.meshViewerPanel?.prewarmPayload === 'function') {
                this.editor.meshViewerPanel.prewarmPayload(node, node.previewValue);
            }
            this.editor.meshViewerPanel.updateIfVisible(node, node.previewValue);
        }

        if (this.editor.previewPanel && this.editor.previewPanel.node &&
            Number(this.editor.previewPanel.node.id) === Number(node.id)) {
            this.editor.previewPanel.refresh(node);
        }

        if (!node.success) {
            const nodeName = nodeResult.name || node.config.name || node.type;
            const reason = nodeResult.error || 'Node execution failed';
            errorLines.push(`Node ${node.id} (${nodeName}): ${reason}`);
        }
    }

    applyExecutionResult(result, options = {}) {
        const silent = options.silent === true;
        const errorLines = [];

        if (result && result.success) {
            const nodeMap = new Map(this.editor.nodes.map(n => [n.id, n]));
            const connKeyOf = (fromNodeId, fromSocketId, toNodeId, toSocketId) =>
                `${Number(fromNodeId)}|${String(fromSocketId)}|${Number(toNodeId)}|${String(toSocketId)}`;
            const connectionMap = new Map(
                this.editor.connections.map(c => [
                    connKeyOf(c.fromNode.id, c.fromSocket.id, c.toNode.id, c.toSocket.id),
                    c
                ])
            );
            const nodeResults = (Array.isArray(result.deltas) && result.deltas.length > 0)
                ? result.deltas
                : (Array.isArray(result.results?.nodes) ? result.results.nodes : []);
            nodeResults.forEach(nodeResult => {
                const node = nodeMap.get(nodeResult.id);
                if (node) {
                    this.updateNodeFromExecution(node, nodeResult, errorLines);
                }
            });

            const connectionResults = (Array.isArray(result.connectionDeltas) && result.connectionDeltas.length > 0)
                ? result.connectionDeltas
                : (Array.isArray(result.results?.connections) ? result.results.connections : []);
            connectionResults.forEach(connResult => {
                const conn = connectionMap.get(
                    connKeyOf(
                        connResult.from_node,
                        connResult.from_socket,
                        connResult.to_node,
                        connResult.to_socket
                    )
                );
                if (!conn) return;
                conn.success = connResult.success;
                conn.errorMessage = connResult.error || '';
                conn.fromNodeName = connResult.from_node_name || '';
                conn.toNodeName = connResult.to_node_name || '';
                conn.fromSocketIndex = Number.isFinite(connResult.from_socket_index)
                    ? connResult.from_socket_index
                    : -1;
                conn.toSocketIndex = Number.isFinite(connResult.to_socket_index)
                    ? connResult.to_socket_index
                    : -1;
                if (!conn.success) {
                    if (conn.fromSocketIndex >= 0) {
                        conn.fromNode.errorOutputs.add(conn.fromSocketIndex);
                    }
                    if (conn.toSocketIndex >= 0) {
                        conn.toNode.errorInputs.add(conn.toSocketIndex);
                    }
                    const fromName = conn.fromNodeName || conn.fromNode.type;
                    const toName = conn.toNodeName || conn.toNode.type;
                    const fromIdx = conn.fromSocketIndex >= 0 ? `#${conn.fromSocketIndex}` : '';
                    const toIdx = conn.toSocketIndex >= 0 ? `#${conn.toSocketIndex}` : '';
                    const reason = conn.errorMessage || 'Connection failed';
                    errorLines.push(
                        `Conn ${connResult.from_node}.${connResult.from_socket}${fromIdx} -> ` +
                        `${connResult.to_node}.${connResult.to_socket}${toIdx} ` +
                        `(${fromName} -> ${toName}): ${reason}`
                    );
                }
            });

            if (this.editor.previewRefreshScheduler &&
                typeof this.editor.previewRefreshScheduler.processExecutionResult === 'function') {
                this.editor.previewRefreshScheduler.processExecutionResult(result).catch(() => {});
            }

            this.editor.requestRender();
        }

        if (silent) {
            return errorLines;
        }

        if (result.success && errorLines.length === 0) {
            const touchedNodeIds = new Set();
            if (Array.isArray(result.deltas) && result.deltas.length > 0) {
                for (const d of result.deltas) {
                    if (d && Number.isFinite(d.id)) touchedNodeIds.add(Number(d.id));
                }
            } else if (Array.isArray(result.results?.nodes) && result.results.nodes.length > 0) {
                for (const n of result.results.nodes) {
                    if (n && Number.isFinite(n.id)) touchedNodeIds.add(Number(n.id));
                }
            }
            for (const node of this.editor.nodes) {
                if (!node || !touchedNodeIds.has(Number(node.id))) continue;
                if (node.success === false || node.errorMessage) {
                    node.success = true;
                    node.errorMessage = '';
                }
                if (node.errorInputs?.size > 0) node.errorInputs.clear();
                if (node.errorOutputs?.size > 0) node.errorOutputs.clear();
            }
            const stats = result.execution_stats || result.results?.execution_stats || null;
            const statsText = stats
                ? `Execution Stats: computed=${stats.computedNodeCount || 0}, cacheHit=${stats.cacheHitNodeCount || 0}, touched=${stats.totalTouchedNodeCount || 0}\n` +
                  `Computed Nodes: ${JSON.stringify(Array.isArray(stats.computedNodes) ? stats.computedNodes : [])}\n` +
                  `Cache Hit Nodes: ${JSON.stringify(Array.isArray(stats.cacheHitNodes) ? stats.cacheHitNodes : [])}\n\n`
                : '';
            const interactionText = this.editor.lastInteractionStateOutputs
                ? `Interaction Debug:\n${JSON.stringify(this.editor.lastInteractionStateOutputs, null, 2)}\n\n`
                : '';
            document.getElementById('output').textContent =
                'Execution successful!\n\n' + interactionText + statsText;
        } else {
            const header = 'Execution errors:\n\n';
            const details = errorLines.length > 0
                ? errorLines.join('\n')
                : ('Error: ' + (result.error || 'Unknown error') + '\n\n' +
                   (result.message || '') + '\n' +
                   (result.hint || ''));
            document.getElementById('output').textContent = header + details;
        }

        return errorLines;
    }
}

export { ExecutionResultApplier };
