const DEFAULT_PAGED_PREVIEW_ITEMS = 100;
const DEFAULT_CHUNKED_STREAM_CHUNK_SIZE = 65536;
const DEFAULT_CHUNKED_STREAM_MAX_PARALLEL = 4;

function getOutputTransportMode(value) {
    if (!value || typeof value !== 'object') return 'inline';
    const mode = value?.stream?.mode;
    if (mode === 'chunked') return 'chunked';
    if (mode === 'paged') return 'paged';
    return 'inline';
}

function isChunkedOutput(value) {
    return getOutputTransportMode(value) === 'chunked';
}

function isPagedOutput(value) {
    return getOutputTransportMode(value) === 'paged';
}

function isGeometryViewerPayload(value) {
    return !!value &&
        typeof value === 'object' &&
        (value.viewerType === 'mesh' || value.viewerType === 'geometry');
}

function getOutputSocketId(value, fallback = null) {
    return (typeof value?.stream?.socketId === 'string' && value.stream.socketId) || fallback;
}

function getOutputTotalCount(value, fallback = null) {
    return Number.isFinite(value?.stream?.totalCount) ? Number(value.stream.totalCount) : fallback;
}

function getOutputLoadedCount(value, fallback = null) {
    return Number.isFinite(value?.stream?.loadedCount) ? Number(value.stream.loadedCount) : fallback;
}

function getOutputPageSize(value, fallback = null) {
    return Number.isFinite(value?.stream?.pageSize) ? Number(value.stream.pageSize) : fallback;
}

export {
    DEFAULT_CHUNKED_STREAM_CHUNK_SIZE,
    DEFAULT_CHUNKED_STREAM_MAX_PARALLEL,
    DEFAULT_PAGED_PREVIEW_ITEMS,
    getOutputLoadedCount,
    getOutputPageSize,
    getOutputSocketId,
    getOutputTotalCount,
    getOutputTransportMode,
    isChunkedOutput,
    isGeometryViewerPayload,
    isPagedOutput
};
