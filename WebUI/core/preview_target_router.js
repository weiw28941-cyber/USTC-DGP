function getPreferredPreviewSocketId(node) {
    const declaredPreviewSocket = (typeof node?.previewSocket === 'string' && node.previewSocket)
        || (typeof node?.config?.previewSocket === 'string' && node.config.previewSocket)
        || null;
    if (declaredPreviewSocket) return declaredPreviewSocket;
    if (node?.config?.previewSocket === null || node?.previewSocket === null) return null;
    const outputs = Array.isArray(node?.outputs) ? node.outputs : [];
    if (outputs.length === 0) return null;
    throw new Error(
        `Missing previewSocket contract for node "${node?.type || 'unknown'}". ` +
        'Declare previewSocket during node type loading.'
    );
}

function createPreviewTargetAccumulator() {
    return {
        outputNodeIds: new Set(),
        outputSockets: {}
    };
}

function collectDownstreamPreviewNodes(context, startNode) {
    if (!context || !startNode || !Number.isFinite(startNode.id)) return [];
    const connections = Array.isArray(context.connections) ? context.connections : [];
    if (connections.length === 0) return [];
    const nodes = Array.isArray(context.nodes) ? context.nodes : [];
    const byId = new Map(nodes.map((node) => [Number(node.id), node]));
    const queue = [Number(startNode.id)];
    const visited = new Set(queue);
    const downstream = [];

    const extractEndpoint = (conn) => {
        if (typeof context.extractConnectionEndpoints === 'function') {
            return context.extractConnectionEndpoints(conn);
        }
        const fromNodeId = Number(conn?.fromNode?.id ?? conn?.from_node);
        const toNodeId = Number(conn?.toNode?.id ?? conn?.to_node);
        if (!Number.isFinite(fromNodeId) || !Number.isFinite(toNodeId)) return null;
        return { fromNodeId, toNodeId };
    };

    while (queue.length > 0) {
        const currentId = queue.shift();
        for (const conn of connections) {
            const endpoint = extractEndpoint(conn);
            if (!endpoint || endpoint.fromNodeId !== currentId) continue;
            if (visited.has(endpoint.toNodeId)) continue;
            visited.add(endpoint.toNodeId);
            queue.push(endpoint.toNodeId);
            const targetNode = byId.get(endpoint.toNodeId);
            if (targetNode) {
                downstream.push(targetNode);
            }
        }
    }

    return downstream;
}

function addNodePreviewTarget(accumulator, node, socketId = null) {
    if (!accumulator || !node || !Number.isFinite(node.id)) return;
    accumulator.outputNodeIds.add(node.id);
    const resolvedSocketId = socketId || getPreferredPreviewSocketId(node);
    if (!resolvedSocketId) return;
    const key = String(node.id);
    if (!Array.isArray(accumulator.outputSockets[key])) {
        accumulator.outputSockets[key] = [];
    }
    if (!accumulator.outputSockets[key].includes(resolvedSocketId)) {
        accumulator.outputSockets[key].push(resolvedSocketId);
    }
}

function finalizePreviewTargets(accumulator) {
    const outputNodeIds = accumulator?.outputNodeIds instanceof Set
        ? [...accumulator.outputNodeIds]
        : [];
    const outputSockets = (accumulator && typeof accumulator.outputSockets === 'object' && accumulator.outputSockets)
        ? accumulator.outputSockets
        : {};
    return {
        omitOutputs: outputNodeIds.length === 0,
        outputNodeIds,
        outputSockets
    };
}

function buildNodePreviewExecutionOptions(nodes) {
    const accumulator = createPreviewTargetAccumulator();
    for (const node of Array.isArray(nodes) ? nodes : []) {
        addNodePreviewTarget(accumulator, node);
    }
    return finalizePreviewTargets(accumulator);
}

function buildPropertyPreviewExecutionOptions(node, previewSocketId = null, context = null) {
    const accumulator = createPreviewTargetAccumulator();
    addNodePreviewTarget(accumulator, node, previewSocketId || getPreferredPreviewSocketId(node));
    for (const downstreamNode of collectDownstreamPreviewNodes(context, node)) {
        addNodePreviewTarget(accumulator, downstreamNode);
    }
    return finalizePreviewTargets(accumulator);
}

function buildConnectionPreviewExecutionOptions(nodes) {
    return buildConnectionPreviewExecutionOptionsWithContext(nodes, null);
}

function buildConnectionPreviewExecutionOptionsWithContext(nodes, context = null) {
    const accumulator = createPreviewTargetAccumulator();
    for (const node of Array.isArray(nodes) ? nodes : []) {
        addNodePreviewTarget(accumulator, node);
        for (const downstreamNode of collectDownstreamPreviewNodes(context, node)) {
            addNodePreviewTarget(accumulator, downstreamNode);
        }
    }
    return finalizePreviewTargets(accumulator);
}

function buildContextPreviewExecutionOptions(context) {
    const accumulator = createPreviewTargetAccumulator();

    if (context.previewPanel?.node && Number.isFinite(context.previewPanel.node.id)) {
        addNodePreviewTarget(accumulator, context.previewPanel.node);
    }

    if (context.meshViewerPanel && Number.isFinite(context.meshViewerPanel.currentNodeId)) {
        const viewerNode = context.nodes.find((n) => n.id === context.meshViewerPanel.currentNodeId);
        if (viewerNode) {
            addNodePreviewTarget(accumulator, viewerNode);
        } else {
            accumulator.outputNodeIds.add(context.meshViewerPanel.currentNodeId);
        }
    }

    for (const routedId of context.interactionFocusNodeIds || []) {
        const nodeId = Number(routedId);
        if (!Number.isFinite(nodeId)) continue;
        accumulator.outputNodeIds.add(nodeId);
        const node = context.nodes.find((n) => n.id === nodeId);
        if (node?.type === 'interaction_state') {
            delete accumulator.outputSockets[String(nodeId)];
        }
    }

    return finalizePreviewTargets(accumulator);
}

export {
    addNodePreviewTarget,
    buildConnectionPreviewExecutionOptions,
    buildConnectionPreviewExecutionOptionsWithContext,
    buildContextPreviewExecutionOptions,
    buildNodePreviewExecutionOptions,
    buildPropertyPreviewExecutionOptions,
    collectDownstreamPreviewNodes,
    createPreviewTargetAccumulator,
    finalizePreviewTargets,
    getPreferredPreviewSocketId
};
