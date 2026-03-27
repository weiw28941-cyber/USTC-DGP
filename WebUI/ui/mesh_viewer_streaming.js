import {
    DEFAULT_CHUNKED_STREAM_CHUNK_SIZE,
    DEFAULT_CHUNKED_STREAM_MAX_PARALLEL,
    isChunkedOutput,
    isGeometryViewerPayload
} from '../core/output_transport.js';

export function getAvailableStreamFields(viewer, payload) {
    const fields = payload?.stream?.fields || {};
    return Object.entries(fields)
        .filter(([, meta]) => {
            if (typeof meta === 'number') return meta > 0;
            if (meta && typeof meta === 'object') return Number(meta.count || 0) > 0;
            return false;
        })
        .map(([name]) => name);
}

export function getLoadedStreamFields(viewer, data) {
    const loaded = Array.isArray(data?.loadedFields) ? data.loadedFields : [];
    return new Set(loaded);
}

export function getPrimaryStreamFields(viewer, payload) {
    const available = new Set(getAvailableStreamFields(viewer, payload));
    const required = new Set();
    if (available.has('positions')) {
        required.add('positions');
    }
    const triangleCount = Number(payload?.triangleCount || 0);
    const lineCount = Number(payload?.lineCount || 0);
    const pointCount = Number(payload?.pointCount || 0);
    const viewerType = String(payload?.viewerType || '').toLowerCase();
    if ((viewerType === 'mesh' || triangleCount > 0) && (available.has('triIndices') || available.has('indices'))) {
        required.add(available.has('triIndices') ? 'triIndices' : 'indices');
    } else if ((viewerType === 'lines' || lineCount > 0) && available.has('lineIndices')) {
        required.add('lineIndices');
    } else if ((viewerType === 'points' || pointCount > 0) && available.has('pointIndices')) {
        required.add('pointIndices');
    }
    if (required.size === 1 && available.has('triIndices')) {
        required.add('triIndices');
    }
    return required;
}

export function getInitialStreamFields(viewer, payload) {
    return getPrimaryStreamFields(viewer, payload);
}

export function getRequiredFieldsForDisplay(viewer, payload, displayFlags, handle = null) {
    const available = new Set(getAvailableStreamFields(viewer, payload));
    const required = new Set();
    if (available.has('positions')) {
        required.add('positions');
    }

    const hasLineField = available.has('lineIndices');
    const hasTriField = available.has('triIndices') || available.has('indices');
    const triFieldName = available.has('triIndices') ? 'triIndices' : 'indices';
    const handleType = typeof viewer.getHandleObjectType === 'function'
        ? viewer.getHandleObjectType(handle)
        : null;

    if (displayFlags?.faces && hasTriField) {
        required.add(triFieldName);
    }

    if (displayFlags?.lines) {
        if (hasLineField) {
            required.add('lineIndices');
        } else if (hasTriField && (handleType === 'mesh' || Number(payload?.triangleCount || 0) > 0)) {
            required.add(triFieldName);
        }
    }

    if (displayFlags?.points && available.has('pointIndices')) {
        required.add('pointIndices');
    }

    return required;
}

export function mergeStreamPayloadData(viewer, existing, incoming) {
    const merged = { ...(existing || {}) };
    for (const field of ['positions', 'triIndices', 'lineIndices', 'pointIndices']) {
        if (incoming && incoming[field] && incoming[field].length >= 0) {
            merged[field] = incoming[field];
        }
    }
    const loaded = new Set([
        ...(Array.isArray(existing?.loadedFields) ? existing.loadedFields : []),
        ...(Array.isArray(incoming?.loadedFields) ? incoming.loadedFields : [])
    ]);
    merged.loadedFields = [...loaded];
    return merged;
}

export async function ensureStreamFields(viewer, payload, requiredFields) {
    if (!isChunkedOutput(payload)) {
        return payload;
    }
    const key = viewer.getMeshKey(payload);
    if (!key) {
        throw new Error('Invalid mesh stream key');
    }
    const required = new Set(requiredFields || []);
    const cached = viewer.streamPayloadCache.get(key);
    const loaded = getLoadedStreamFields(viewer, cached);
    const missing = [...required].filter((field) => !loaded.has(field));
    if (!cached && missing.length === 0) {
        return payload;
    }
    if (missing.length === 0 && cached) {
        return { ...payload, ...cached };
    }
    const hydrationKey = `${key}|${missing.slice().sort().join(',')}`;
    const pending = viewer.pendingStreamFieldHydrations.get(hydrationKey);
    if (pending) {
        const data = await pending;
        return { ...payload, ...data };
    }
    const request = (async () => {
        const next = await fetchStreamPayload(viewer, payload, { includeFields: missing });
        const merged = mergeStreamPayloadData(viewer, cached, next);
        viewer.streamPayloadCache.set(key, merged);
        return merged;
    })();
    viewer.pendingStreamFieldHydrations.set(hydrationKey, request);
    try {
        const data = await request;
        return { ...payload, ...data };
    } finally {
        viewer.pendingStreamFieldHydrations.delete(hydrationKey);
    }
}

export async function ensureFieldsForDisplay(viewer, handle, displayFlags) {
    if (!viewer.currentPayload || !isChunkedOutput(viewer.currentPayload)) return;
    const required = getRequiredFieldsForDisplay(viewer, viewer.currentPayload, displayFlags, handle);
    const nextPayload = await ensureStreamFields(viewer, viewer.currentPayload, required);
    if (nextPayload !== viewer.currentPayload) {
        viewer.currentPayload = nextPayload;
        const nextHandle = typeof viewer.hydrateHandleForPayload === 'function'
            ? viewer.hydrateHandleForPayload(nextPayload)
            : null;
        if (nextHandle) {
            viewer.currentMeshHandle = nextHandle;
            viewer.scheduleViewerUiRefresh();
            viewer.scheduleHandleAuxiliaryBuild(nextHandle);
        } else {
            const key = nextPayload.meshId || `mesh_${nextPayload.version || '0'}`;
            viewer.meshCache.delete(key);
            viewer.bindMesh(nextPayload);
        }
        viewer.startRenderLoop();
    }
}

export async function resolvePayload(viewer, payload) {
    if (!isGeometryViewerPayload(payload)) return payload;
    if (!isChunkedOutput(payload)) {
        throw new Error('Geometry viewer requires chunked stream payload');
    }
    const key = viewer.getMeshKey(payload);
    if (!key) {
        throw new Error('Invalid mesh stream key');
    }

    const requiredFields = getInitialStreamFields(viewer, payload);
    const cached = viewer.streamPayloadCache.get(key);
    if (cached) {
        const loaded = getLoadedStreamFields(viewer, cached);
        const missing = [...requiredFields].filter((field) => !loaded.has(field));
        if (missing.length === 0) {
            return { ...payload, ...cached };
        }
    }

    const pending = viewer.pendingStreamFetches.get(key);
    if (pending) {
        const data = await pending;
        return ensureStreamFields(viewer, { ...payload, ...data }, requiredFields);
    }

    const fetchPromise = fetchStreamPayload(viewer, payload, { includeFields: [...requiredFields] });
    viewer.pendingStreamFetches.set(key, fetchPromise);
    try {
        const data = await fetchPromise;
        const merged = mergeStreamPayloadData(viewer, cached, data);
        viewer.streamPayloadCache.set(key, merged);
        return { ...payload, ...merged };
    } finally {
        viewer.pendingStreamFetches.delete(key);
    }
}

export async function fetchStreamPayload(viewer, payload, options = {}) {
    const stream = payload.stream;
    const fields = stream.fields || {};
    const chunkSize = stream.chunkSize || DEFAULT_CHUNKED_STREAM_CHUNK_SIZE;
    const maxParallel = Math.max(1, Math.min(8, Number(stream.maxParallel || DEFAULT_CHUNKED_STREAM_MAX_PARALLEL)));
    const endpoint = stream.endpoint;
    if (!endpoint) {
        throw new Error('Missing stream endpoint');
    }
    let activeChunkRequests = 0;
    const pendingChunkWaiters = [];

    const acquireChunkSlot = async () => {
        if (activeChunkRequests < maxParallel) {
            activeChunkRequests += 1;
            return;
        }
        await new Promise((resolve) => pendingChunkWaiters.push(resolve));
        activeChunkRequests += 1;
    };

    const releaseChunkSlot = () => {
        activeChunkRequests = Math.max(0, activeChunkRequests - 1);
        const next = pendingChunkWaiters.shift();
        if (next) next();
    };

    const fetchStreamChunk = async (field, offset, limit, expectedDType) => {
        const chunkKey = viewer.getStreamChunkKey(endpoint, field, offset, limit, expectedDType);
        const cached = viewer.streamChunkCache.get(chunkKey);
        if (cached) {
            viewer.rememberStreamChunk(chunkKey, cached);
            return cached;
        }
        const pending = viewer.pendingStreamChunks.get(chunkKey);
        if (pending) {
            return pending;
        }
        const request = (async () => {
            await acquireChunkSlot();
            try {
                const url = `${endpoint}/chunk?field=${encodeURIComponent(field)}&offset=${offset}&limit=${limit}`;
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`${field} chunk request failed (${response.status})`);
                }
                const chunkDType = (response.headers.get('x-chunk-dtype') || '').toLowerCase();
                if (chunkDType !== expectedDType) {
                    throw new Error(`${field} chunk dtype mismatch: expected ${expectedDType}, got ${chunkDType || 'unknown'}`);
                }
                const countHeader = parseInt(response.headers.get('x-chunk-count') || String(limit), 10);
                const arrayBuffer = await response.arrayBuffer();
                let typed;
                if (expectedDType === 'f32') {
                    typed = new Float32Array(arrayBuffer);
                } else if (expectedDType === 'u32') {
                    typed = new Uint32Array(arrayBuffer);
                } else {
                    throw new Error(`${field} unsupported dtype ${expectedDType}`);
                }
                const count = Math.min(countHeader, typed.length);
                const sliced = count === typed.length ? typed : typed.slice(0, count);
                viewer.rememberStreamChunk(chunkKey, sliced);
                return sliced;
            } finally {
                releaseChunkSlot();
            }
        })();
        viewer.pendingStreamChunks.set(chunkKey, request);
        try {
            return await request;
        } finally {
            viewer.pendingStreamChunks.delete(chunkKey);
        }
    };

    const fetchFieldBinary = async (field, total, out, expectedDType) => {
        const offsets = [];
        for (let offset = 0; offset < total; offset += chunkSize) {
            offsets.push(offset);
        }
        let nextIndex = 0;
        let written = 0;

        const fetchOneChunk = async () => {
            while (true) {
                const index = nextIndex++;
                if (index >= offsets.length) return;
                const offset = offsets[index];
                const limit = Math.min(chunkSize, total - offset);
                const typed = await fetchStreamChunk(field, offset, limit, expectedDType);
                const count = Math.min(typed.length, total - offset);
                if (count > 0) {
                    if (count === typed.length) {
                        out.set(typed, offset);
                    } else {
                        out.set(typed.subarray(0, count), offset);
                    }
                }
                written += count;
            }
        };

        const workers = [];
        const workerCount = Math.min(maxParallel, offsets.length);
        for (let i = 0; i < workerCount; i++) {
            workers.push(fetchOneChunk());
        }
        await Promise.all(workers);

        if (written !== total) {
            throw new Error(`${field} chunk size mismatch`);
        }
        return out;
    };

    const readFieldMeta = (fieldName, fallbackDType) => {
        const meta = fields[fieldName];
        if (typeof meta === 'number') {
            return { count: meta, dtype: fallbackDType };
        }
        if (meta && typeof meta === 'object') {
            return { count: Number(meta.count || 0), dtype: (meta.dtype || fallbackDType).toLowerCase() };
        }
        return { count: 0, dtype: fallbackDType };
    };

    const requestedFields = new Set(Array.isArray(options.includeFields) ? options.includeFields : []);
    const wantsAll = requestedFields.size === 0;
    const posMeta = readFieldMeta('positions', 'f32');
    const triMeta = readFieldMeta('triIndices', 'u32');
    const lineMeta = readFieldMeta('lineIndices', 'u32');
    const pointMeta = readFieldMeta('pointIndices', 'u32');
    const legacyIdxMeta = readFieldMeta('indices', 'u32');
    const needPositions = wantsAll || requestedFields.has('positions');
    const needTri = wantsAll || requestedFields.has('triIndices') || requestedFields.has('indices');
    const needLine = wantsAll || requestedFields.has('lineIndices');
    const needPoint = wantsAll || requestedFields.has('pointIndices');
    const totalPositions = needPositions ? posMeta.count : 0;
    const totalTri = needTri ? (triMeta.count > 0 ? triMeta.count : legacyIdxMeta.count) : 0;
    const totalLine = needLine ? lineMeta.count : 0;
    const totalPoint = needPoint ? pointMeta.count : 0;
    if (totalPositions <= 0 || (totalTri <= 0 && totalLine <= 0 && totalPoint <= 0)) {
        throw new Error('Invalid stream field sizes');
    }

    const positionsOut = new Float32Array(totalPositions);
    const triOut = new Uint32Array(totalTri);
    const lineOut = new Uint32Array(Math.max(0, totalLine));
    const pointOut = new Uint32Array(Math.max(0, totalPoint));
    const promises = [];
    if (totalPositions > 0) {
        promises.push(fetchFieldBinary('positions', totalPositions, positionsOut, posMeta.dtype));
    }
    if (totalTri > 0) {
        const triField = triMeta.count > 0 ? 'triIndices' : 'indices';
        const triDType = triMeta.count > 0 ? triMeta.dtype : legacyIdxMeta.dtype;
        promises.push(fetchFieldBinary(triField, totalTri, triOut, triDType));
    }
    if (totalLine > 0) {
        promises.push(fetchFieldBinary('lineIndices', totalLine, lineOut, lineMeta.dtype));
    }
    if (totalPoint > 0) {
        promises.push(fetchFieldBinary('pointIndices', totalPoint, pointOut, pointMeta.dtype));
    }
    await Promise.all(promises);

    const result = {
        loadedFields: [
            ...(totalPositions > 0 ? ['positions'] : []),
            ...(totalTri > 0 ? ['triIndices'] : []),
            ...(totalLine > 0 ? ['lineIndices'] : []),
            ...(totalPoint > 0 ? ['pointIndices'] : [])
        ]
    };
    if (totalPositions > 0) result.positions = positionsOut;
    if (totalTri > 0) result.triIndices = triOut;
    if (totalLine > 0) result.lineIndices = lineOut;
    if (totalPoint > 0) result.pointIndices = pointOut;
    return result;
}
