function viewerInteractionAffectsGraphExecution(patch) {
    if (!patch || typeof patch !== 'object') return false;
    if (String(patch.op || '') !== 'viewer_interaction') return false;
    const event = (patch.value && typeof patch.value === 'object' && !Array.isArray(patch.value))
        ? patch.value
        : null;
    const channel = typeof event?.channel === 'string' ? event.channel : '';
    return channel !== 'camera';
}

function patchAffectsGraphExecution(patch) {
    if (!patch || typeof patch !== 'object') return false;
    const op = String(patch.op || '');
    return op === 'add_node' ||
        op === 'remove_node' ||
        op === 'add_connection' ||
        op === 'remove_connection' ||
        op === 'set_node_property' ||
        op === 'set_node_input_literal' ||
        viewerInteractionAffectsGraphExecution(patch);
}

function collectExecutionSeedNodeIds(patches) {
    const seeds = new Set();
    for (const patch of (Array.isArray(patches) ? patches : [])) {
        if (!patchAffectsGraphExecution(patch) || !patch || typeof patch !== 'object') continue;
        const op = String(patch.op || '');
        if ((op === 'set_node_property' || op === 'set_node_input_literal' || op === 'viewer_interaction') &&
            Number.isFinite(patch.nodeId)) {
            seeds.add(Number(patch.nodeId));
            continue;
        }
        if (op === 'add_node' && patch.node && Number.isFinite(patch.node.id)) {
            seeds.add(Number(patch.node.id));
            continue;
        }
        if (op === 'remove_node' && Array.isArray(patch.downstreamNodeIds)) {
            for (const id of patch.downstreamNodeIds) {
                if (Number.isFinite(id)) {
                    seeds.add(Number(id));
                }
            }
            continue;
        }
        if ((op === 'add_connection' || op === 'remove_connection') && Number.isFinite(patch.to_node)) {
            seeds.add(Number(patch.to_node));
        }
    }
    return seeds;
}

function computeAffectedNodes(graphData, patches) {
    const connections = Array.isArray(graphData?.connections) ? graphData.connections : [];
    const adj = new Map();
    for (const conn of connections) {
        const from = Number(conn.from_node);
        const to = Number(conn.to_node);
        if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
        if (!adj.has(from)) adj.set(from, []);
        adj.get(from).push(to);
    }

    const seeds = collectExecutionSeedNodeIds(patches);
    const queue = [...seeds];
    for (let i = 0; i < queue.length; i++) {
        const nodeId = queue[i];
        const next = adj.get(nodeId) || [];
        for (const dst of next) {
            if (seeds.has(dst)) continue;
            seeds.add(dst);
            queue.push(dst);
        }
    }
    return [...seeds];
}

function buildNodeDeltas(result, patches, explicitNodeIds = null) {
    if (!result || !Array.isArray(result.nodes)) return [];
    const affectedIds = new Set();
    if (Array.isArray(explicitNodeIds)) {
        for (const id of explicitNodeIds) {
            if (Number.isFinite(id)) affectedIds.add(Number(id));
        }
    }
    for (const id of collectExecutionSeedNodeIds(patches)) {
        affectedIds.add(id);
    }
    if (affectedIds.size === 0) return [];
    return result.nodes
        .filter(n => n && Number.isFinite(n.id) && affectedIds.has(Number(n.id)))
        .map(n => ({
            id: n.id,
            success: !!n.success,
            error: n.error || '',
            outputs: n.outputs || {}
        }));
}

function buildConnectionDeltas(result, patches, explicitNodeIds = null) {
    if (!result || !Array.isArray(result.connections)) return [];
    const affectedNodeIds = new Set();
    const affectedConnKeys = new Set();
    const makeConnKey = (c) => `${Number(c.from_node)}|${String(c.from_socket)}|${Number(c.to_node)}|${String(c.to_socket)}`;

    for (const patch of (Array.isArray(patches) ? patches : [])) {
        if (!patchAffectsGraphExecution(patch) || !patch || typeof patch !== 'object') continue;
        if ((patch.op === 'add_connection' || patch.op === 'remove_connection') &&
            patch.from_node !== undefined && patch.from_socket && patch.to_node !== undefined && patch.to_socket) {
            affectedConnKeys.add(makeConnKey(patch));
        }
    }
    if (Array.isArray(explicitNodeIds)) {
        for (const id of explicitNodeIds) {
            if (Number.isFinite(id)) affectedNodeIds.add(Number(id));
        }
    }
    for (const id of collectExecutionSeedNodeIds(patches)) {
        affectedNodeIds.add(id);
    }
    if (affectedNodeIds.size === 0 && affectedConnKeys.size === 0) return [];

    return result.connections.filter(c => {
        const key = makeConnKey(c);
        return affectedConnKeys.has(key) ||
            affectedNodeIds.has(Number(c.from_node)) ||
            affectedNodeIds.has(Number(c.to_node));
    });
}

module.exports = {
    viewerInteractionAffectsGraphExecution,
    patchAffectsGraphExecution,
    collectExecutionSeedNodeIds,
    computeAffectedNodes,
    buildNodeDeltas,
    buildConnectionDeltas
};
