function inferPreviewSocketFromType(nodeType) {
    const outputs = Array.isArray(nodeType?.outputs) ? nodeType.outputs : [];
    if (outputs.length === 0) return null;
    const ids = new Set(outputs.map((output) => output?.id).filter(Boolean));
    if (nodeType?.id === 'interaction_state') return null;
    if (nodeType?.id === 'points_attributes' && ids.has('vertices')) return 'vertices';
    if (typeof nodeType?.previewSocket === 'string' && nodeType.previewSocket) {
        return nodeType.previewSocket;
    }
    if (ids.has('view')) return 'view';
    if (nodeType?.id === 'vector' && ids.has('vec')) return 'vec';
    if (nodeType?.id === 'list' && ids.has('list')) return 'list';
    if (ids.has('result')) return 'result';
    if (ids.has('out')) return 'out';
    if (outputs.length === 1) {
        return outputs[0]?.id || null;
    }
    return null;
}

function validatePreviewSocket(nodeType, previewSocket) {
    if (previewSocket == null) return;
    const outputs = Array.isArray(nodeType?.outputs) ? nodeType.outputs : [];
    const outputIds = new Set(outputs.map((output) => output?.id).filter(Boolean));
    if (!outputIds.has(previewSocket)) {
        throw new Error(
            `Invalid previewSocket "${previewSocket}" for node type "${nodeType?.id || 'unknown'}".`
        );
    }
}

function applyNodePreviewContracts(nodeTypes) {
    const list = Array.isArray(nodeTypes) ? nodeTypes : [];
    for (const nodeType of list) {
        const previewSocket = inferPreviewSocketFromType(nodeType);
        validatePreviewSocket(nodeType, previewSocket);
        nodeType.previewSocket = previewSocket;
    }
    return list;
}

export {
    applyNodePreviewContracts,
    inferPreviewSocketFromType,
    validatePreviewSocket
};
