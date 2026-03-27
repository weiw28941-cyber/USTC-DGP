import { Node } from './node.js';
import { NodeGroup } from './node_group.js';
import { Connection } from './connection.js';

function cloneJson(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
}

function mapNodesById(graphData) {
    const map = new Map();
    for (const node of Array.isArray(graphData?.nodes) ? graphData.nodes : []) {
        if (Number.isFinite(node?.id)) {
            map.set(Number(node.id), node);
        }
    }
    return map;
}

function makeConnKey(conn) {
    return `${Number(conn?.from_node)}|${String(conn?.from_socket || '')}|${Number(conn?.to_node)}|${String(conn?.to_socket || '')}`;
}

function buildGraphDiffPatches(currentGraph, targetGraph) {
    const patches = [];
    const currentNodes = mapNodesById(currentGraph);
    const targetNodes = mapNodesById(targetGraph);
    const currentConnections = Array.isArray(currentGraph?.connections) ? currentGraph.connections : [];
    const targetConnections = Array.isArray(targetGraph?.connections) ? targetGraph.connections : [];
    const currentConnMap = new Map(currentConnections.map(conn => [makeConnKey(conn), conn]));
    const targetConnMap = new Map(targetConnections.map(conn => [makeConnKey(conn), conn]));

    for (const [key, conn] of currentConnMap.entries()) {
        if (targetConnMap.has(key)) continue;
        patches.push({
            op: 'remove_connection',
            from_node: Number(conn.from_node),
            from_socket: String(conn.from_socket),
            to_node: Number(conn.to_node),
            to_socket: String(conn.to_socket)
        });
    }

    for (const [id, currentNode] of currentNodes.entries()) {
        const targetNode = targetNodes.get(id);
        if (targetNode && String(targetNode.type || '') === String(currentNode.type || '')) {
            continue;
        }
        const downstreamNodeIds = currentConnections
            .filter(conn => Number(conn.from_node) === id && Number(conn.to_node) !== id)
            .map(conn => Number(conn.to_node))
            .filter(Number.isFinite);
        patches.push({
            op: 'remove_node',
            nodeId: id,
            downstreamNodeIds: [...new Set(downstreamNodeIds)]
        });
    }

    for (const [id, targetNode] of targetNodes.entries()) {
        const currentNode = currentNodes.get(id);
        if (!currentNode || String(currentNode.type || '') !== String(targetNode.type || '')) {
            patches.push({
                op: 'add_node',
                node: cloneJson(targetNode)
            });
        }
    }

    for (const [id, targetNode] of targetNodes.entries()) {
        const currentNode = currentNodes.get(id);
        if (!currentNode || String(currentNode.type || '') !== String(targetNode.type || '')) {
            continue;
        }

        const currentProps = (currentNode.properties && typeof currentNode.properties === 'object') ? currentNode.properties : {};
        const targetProps = (targetNode.properties && typeof targetNode.properties === 'object') ? targetNode.properties : {};
        const propertyKeys = new Set([...Object.keys(currentProps), ...Object.keys(targetProps)]);
        for (const key of propertyKeys) {
            const currentValue = Object.prototype.hasOwnProperty.call(currentProps, key) ? currentProps[key] : undefined;
            const targetValue = Object.prototype.hasOwnProperty.call(targetProps, key) ? targetProps[key] : undefined;
            if (JSON.stringify(currentValue) === JSON.stringify(targetValue)) {
                continue;
            }
            patches.push({
                op: 'set_node_property',
                nodeId: id,
                key,
                value: cloneJson(targetValue)
            });
        }

        if (Number(currentNode.x) !== Number(targetNode.x) || Number(currentNode.y) !== Number(targetNode.y)) {
            patches.push({
                op: 'move_node',
                nodeId: id,
                x: Number(targetNode.x),
                y: Number(targetNode.y)
            });
        }
        if (Number(currentNode.width) !== Number(targetNode.width) ||
            Number(currentNode.height) !== Number(targetNode.height)) {
            patches.push({
                op: 'set_node_size',
                nodeId: id,
                width: Number(targetNode.width),
                height: Number(targetNode.height)
            });
        }
    }

    for (const [key, conn] of targetConnMap.entries()) {
        if (currentConnMap.has(key)) continue;
        patches.push({
            op: 'add_connection',
            from_node: Number(conn.from_node),
            from_socket: String(conn.from_socket),
            to_node: Number(conn.to_node),
            to_socket: String(conn.to_socket)
        });
    }

    return patches;
}

function stateToGraphData(state) {
    if (state?.graphData) {
        return cloneJson(state.graphData);
    }
    return {
        schemaVersion: 2,
        meta: {
            nodeIdCounter: Number.isFinite(state?.nodeIdCounter) ? state.nodeIdCounter : 0
        },
        nodes: Array.isArray(state?.nodes) ? state.nodes.map(node => ({
            id: node.id,
            type: node.type,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            properties: {
                value: node.value,
                operation: node.operation,
                label: node.label,
                text: node.text,
                values: cloneJson(node.values)
            },
            value: node.value,
            operation: node.operation,
            label: node.label,
            text: node.text,
            values: cloneJson(node.values)
        })) : [],
        groups: Array.isArray(state?.groups) ? cloneJson(state.groups) : [],
        comments: [],
        connections: Array.isArray(state?.connections) ? state.connections.map(conn => ({
            from_node: conn.fromNodeId,
            from_socket: conn.fromSocketId,
            to_node: conn.toNodeId,
            to_socket: conn.toSocketId
        })) : []
    };
}

export const historyMixin = {
saveHistory(actionName = 'Action') {
    if (this.isPerformingHistoryAction) return;

    const state = {
        actionName,
        graphData: this.collectGraphData()
    };

    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(state);

    if (this.history.length > this.maxHistorySize) {
        this.history.shift();
    } else {
        this.historyIndex++;
    }
},

async restoreHistory(state) {
    this.isPerformingHistoryAction = true;
    const currentGraph = this.collectGraphData();
    const targetGraph = stateToGraphData(state);
    const patches = buildGraphDiffPatches(currentGraph, targetGraph);

    this.applyGraphData(targetGraph, { resetSession: false });
    this.isPerformingHistoryAction = false;
    this.requestRender();

    if (!this.sessionClient.hasSession()) {
        this.requestExecutionRefresh({ immediate: true });
        return;
    }

    if (patches.length > 0) {
        try {
            await this.dispatchGraphPatches(patches, {
                execute: true,
                fullResults: false,
                silentResult: false
            });
        } catch (_) {
            this.requestExecutionRefresh({ immediate: true });
        }
    }
    this.requestSessionSnapshotSync();
  },

async undo() {
    if (this.historyIndex <= 0) {
        console.log('Nothing to undo');
        return;
    }

    this.historyIndex--;
    await this.restoreHistory(this.history[this.historyIndex]);

    document.getElementById('output').textContent =
        `Undo: ${this.history[this.historyIndex].actionName}\n` +
        `History: ${this.historyIndex + 1}/${this.history.length}`;
},

async redo() {
    if (this.historyIndex >= this.history.length - 1) {
        console.log('Nothing to redo');
        return;
    }

    this.historyIndex++;
    await this.restoreHistory(this.history[this.historyIndex]);

    document.getElementById('output').textContent =
        `Redo: ${this.history[this.historyIndex].actionName}\n` +
        `History: ${this.historyIndex + 1}/${this.history.length}`;
}
};
