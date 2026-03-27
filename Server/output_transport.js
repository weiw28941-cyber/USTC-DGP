const DEFAULT_PAGED_PREVIEW_ITEMS = 100;
const DEFAULT_CHUNKED_STREAM_CHUNK_SIZE = 65536;
const DEFAULT_CHUNKED_STREAM_MAX_PARALLEL = 4;

function isStreamDescriptor(value) {
    return !!value &&
        typeof value === 'object' &&
        value.stream &&
        typeof value.stream === 'object' &&
        typeof value.stream.mode === 'string';
}

function isChunkedGeometryPayload(value) {
    return !!value &&
        typeof value === 'object' &&
        (value.viewerType === 'mesh' || value.viewerType === 'geometry');
}

function makePagedDescriptor(socketId, totalCount, pageSize) {
    return {
        stream: {
            mode: 'paged',
            socketId,
            totalCount,
            loadedCount: 0,
            pageSize
        },
        paginated: true
    };
}

function inferMatrixLikeShape(value) {
    if (!Array.isArray(value) || value.length === 0) return null;
    let cols = 0;
    for (const row of value) {
        if (!Array.isArray(row)) {
            return null;
        }
        cols = Math.max(cols, row.length);
    }
    if (cols <= 0) return null;
    return { rows: value.length, cols };
}

function makePagedDescriptorForValue(socketId, value, maxItems) {
    const totalCount = Array.isArray(value) ? value.length : 0;
    const resolvedMaxItems = Number.isFinite(maxItems) && maxItems > 0
        ? maxItems
        : DEFAULT_PAGED_PREVIEW_ITEMS;
    const descriptor = makePagedDescriptor(socketId, totalCount, resolvedMaxItems);
    if (resolvedMaxItems > 0) {
        const matrix = inferMatrixLikeShape(value);
        if (matrix) {
            const rowsPerPage = Math.max(1, Math.floor(resolvedMaxItems / Math.max(1, matrix.cols)));
            descriptor.stream.pageSize = Math.min(matrix.rows, rowsPerPage);
            descriptor.stream.rows = matrix.rows;
            descriptor.stream.cols = matrix.cols;
            descriptor.stream.pageUnit = 'rows';
        }
    }
    return descriptor;
}

function rewriteOutputs(resultJson, handlers = []) {
    if (!resultJson || typeof resultJson !== 'object') return;
    const lists = [];
    if (Array.isArray(resultJson.nodes)) lists.push(resultJson.nodes);
    if (Array.isArray(resultJson.node_deltas)) lists.push(resultJson.node_deltas);
    for (const items of lists) {
        for (const node of items) {
            if (!node || typeof node !== 'object' || !node.outputs) continue;
            for (const [socketId, value] of Object.entries(node.outputs)) {
                for (const handler of handlers) {
                    const nextValue = handler({
                        node,
                        socketId,
                        value
                    });
                    if (nextValue !== undefined) {
                        node.outputs[socketId] = nextValue;
                        break;
                    }
                }
            }
        }
    }
}

module.exports = {
    DEFAULT_CHUNKED_STREAM_CHUNK_SIZE,
    DEFAULT_CHUNKED_STREAM_MAX_PARALLEL,
    DEFAULT_PAGED_PREVIEW_ITEMS,
    isStreamDescriptor,
    isChunkedGeometryPayload,
    makePagedDescriptor,
    makePagedDescriptorForValue,
    rewriteOutputs
};
