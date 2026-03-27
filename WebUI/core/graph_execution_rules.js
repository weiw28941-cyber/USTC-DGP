function viewerInteractionTriggersExecution(patch) {
    if (!patch || typeof patch !== 'object') return false;
    if (String(patch.op || '') !== 'viewer_interaction') return false;
    const event = (patch.value && typeof patch.value === 'object' && !Array.isArray(patch.value))
        ? patch.value
        : null;
    const channel = typeof event?.channel === 'string' ? event.channel : '';
    return channel !== 'camera';
}

function isConnectionPatch(patch) {
    if (!patch || typeof patch !== 'object') return false;
    const op = String(patch.op || '');
    return op === 'add_connection' || op === 'remove_connection';
}

function patchBatchContainsConnectionChanges(patches) {
    const list = Array.isArray(patches) ? patches : [];
    return list.some((patch) => isConnectionPatch(patch));
}

function patchBatchTriggersAutoExecute(patches) {
    const list = Array.isArray(patches) ? patches : [];
    return list.some((patch) => {
        const op = String(patch?.op || '');
        return op === 'add_node' ||
            op === 'remove_node' ||
            op === 'add_connection' ||
            op === 'remove_connection' ||
            op === 'set_node_property' ||
            op === 'set_node_input_literal' ||
            viewerInteractionTriggersExecution(patch);
    });
}

function coalescePatchBatch(patches) {
    const list = Array.isArray(patches) ? patches : [];
    if (list.length <= 1) return list.slice();

    const records = [];
    const latestByKey = new Map();
    const connStateByKey = new Map();
    const makeConnKey = (p) =>
        `${Number(p.from_node)}|${String(p.from_socket)}|${Number(p.to_node)}|${String(p.to_socket)}`;
    const makePatchKey = (p) => {
        if (!p || typeof p !== 'object') return null;
        const op = String(p.op || '');
        if (!op) return null;
        if (op === 'set_node_property' || op === 'set_node_input_literal' ||
            (op === 'viewer_interaction' && viewerInteractionTriggersExecution(p))) {
            if (!Number.isFinite(p.nodeId) || !p.key) return null;
            return `${op}|${Number(p.nodeId)}|${String(p.key)}`;
        }
        if (op === 'move_node' || op === 'set_node_size') {
            if (!Number.isFinite(p.nodeId)) return null;
            return `${op}|${Number(p.nodeId)}`;
        }
        if (op === 'set_graph_meta') {
            if (!p.key) return null;
            return `${op}|${String(p.key)}`;
        }
        return null;
    };

    for (const patch of list) {
        if (!patch || typeof patch !== 'object') continue;
        const op = String(patch.op || '');
        if (!op) continue;

        if (op === 'add_connection' || op === 'remove_connection') {
            if (patch.from_node === undefined || patch.to_node === undefined ||
                !patch.from_socket || !patch.to_socket) {
                records.push(patch);
                continue;
            }
            const connKey = makeConnKey(patch);
            const prev = connStateByKey.get(connKey);
            if (!prev) {
                const idx = records.push(patch) - 1;
                connStateByKey.set(connKey, { op, idx });
                continue;
            }
            if (prev.op === op) {
                records[prev.idx] = patch;
                continue;
            }
            if (prev.op === 'add_connection' && op === 'remove_connection') {
                records[prev.idx] = null;
                connStateByKey.delete(connKey);
                continue;
            }
            if (prev.op === 'remove_connection' && op === 'add_connection') {
                records[prev.idx] = patch;
                connStateByKey.set(connKey, { op, idx: prev.idx });
                continue;
            }
            const idx = records.push(patch) - 1;
            connStateByKey.set(connKey, { op, idx });
            continue;
        }

        const key = makePatchKey(patch);
        if (!key) {
            records.push(patch);
            continue;
        }
        const prevIdx = latestByKey.get(key);
        if (Number.isInteger(prevIdx) && prevIdx >= 0 && prevIdx < records.length) {
            records[prevIdx] = patch;
        } else {
            const idx = records.push(patch) - 1;
            latestByKey.set(key, idx);
        }
    }

    return records.filter(Boolean);
}

export {
    isConnectionPatch,
    patchBatchContainsConnectionChanges,
    viewerInteractionTriggersExecution,
    patchBatchTriggersAutoExecute,
    coalescePatchBatch
};
