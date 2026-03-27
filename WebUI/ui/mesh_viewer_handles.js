import { isChunkedOutput } from '../core/output_transport.js';
import { buildPointIndices, buildUniqueEdgeIndices } from './mesh_viewer_geometry.js';

function createIndexedLodBuffer(viewer, indexArray) {
    if (!viewer.gl) return null;
    const ebo = viewer.gl.createBuffer();
    const typed = new Uint32Array(Array.isArray(indexArray) ? indexArray : []);
    viewer.gl.bindBuffer(viewer.gl.ELEMENT_ARRAY_BUFFER, ebo);
    viewer.gl.bufferData(viewer.gl.ELEMENT_ARRAY_BUFFER, typed, viewer.gl.STATIC_DRAW);
    return { ebo, indexCount: typed.length };
}

export function ensureLineRenderBuffers(viewer, handle) {
    if (!viewer.gl || !handle) return;
    const hasLineLods = Array.isArray(handle.lineLods) && handle.lineLods.some((lod) => lod && lod.indexCount > 0);
    if (hasLineLods) return;
    let lineIndices = Array.isArray(handle.geometry?.lineIndices) ? handle.geometry.lineIndices : [];
    if (lineIndices.length === 0 && Array.isArray(handle.triIndices) && handle.triIndices.length > 0) {
        lineIndices = buildUniqueEdgeIndices(handle.triIndices);
        if (!handle.geometry) handle.geometry = {};
        handle.geometry.lineIndices = lineIndices;
        handle.geometry.lineIndicesDerived = true;
    }
    if (lineIndices.length === 0) return;
    handle.lineLods = [createIndexedLodBuffer(viewer, lineIndices)];
    handle.arrowLods = [
        viewer.buildDirectedArrowLod(
            handle.geometry?.vertices || [],
            handle.geometry?.colors || [],
            lineIndices,
            handle.geometry?.vectorLineFlags || [],
            1
        )
    ];
}

export function ensurePointRenderResources(viewer, handle) {
    if (!viewer.gl || !handle) return;
    const hasPointLods = Array.isArray(handle.pointLods) && handle.pointLods.some((lod) => lod && lod.indexCount > 0);
    if (hasPointLods) return;
    const vertexCount = Number(handle.geometry?.vertexCount || handle.vertexCount || 0);
    if (vertexCount <= 0) return;
    const pointIndices = Array.isArray(handle.geometry?.pointIndices) && handle.geometry.pointIndices.length > 0
        ? handle.geometry.pointIndices
        : buildPointIndices(vertexCount);
    handle.pointLods = [createIndexedLodBuffer(viewer, pointIndices)];
    if (!handle.geometry) handle.geometry = {};
    handle.geometry.pointIndices = pointIndices;
}

export function ensureHandleRenderResources(viewer, handle) {
    if (!handle) return;
    ensureLineRenderBuffers(viewer, handle);
    ensurePointRenderResources(viewer, handle);
}

export function bindMesh(viewer, payload) {
    if (!viewer.gl || !viewer.program) return;
    const handle = getOrCreateHandleForPayload(viewer, payload);
    if (!handle) return;
    if (handle.isComposite && Array.isArray(handle.parts)) {
        for (const part of handle.parts) {
            ensureHandleRenderResources(viewer, part);
        }
    } else {
        ensureHandleRenderResources(viewer, handle);
    }
    viewer.currentMeshHandle = handle;
    viewer.clearInteractionGeometryCache();
    viewer.scheduleInteractionGeometryPrep(handle);
    const indexCount = handle.parts
        ? handle.parts.reduce((sum, p) => sum + (p.lods?.[0]?.indexCount || 0), 0)
        : (handle.lods?.[0]?.indexCount || 0);
    viewer.updateMeta(payload, indexCount);
    viewer.scheduleViewerUiRefresh();
    if (handle.isComposite && Array.isArray(handle.parts)) {
        for (const part of handle.parts) {
            viewer.scheduleHandleAuxiliaryBuild(part);
        }
    } else {
        viewer.scheduleHandleAuxiliaryBuild(handle);
    }
}

export function getOrCreateHandleForPayload(viewer, payload) {
    if (!viewer.gl || !viewer.program) return null;
    const key = payload.meshId || `mesh_${payload.version || '0'}`;
    const version = payload.version || 0;
    const cached = viewer.meshCache.get(key);
    if (cached && cached.version === version) {
        return hydrateHandleForPayload(viewer, payload) || cached;
    }

    if (!isChunkedOutput(payload) && Array.isArray(payload.objects) && payload.objects.length > 0) {
        const parts = [];
        for (let i = 0; i < payload.objects.length; i++) {
            const obj = payload.objects[i];
            const geom = viewer.extractGeometry(obj);
            if (!geom || geom.vertexCount === 0) continue;
            if (typeof obj.type === 'string' && obj.type) {
                const t = obj.type.toLowerCase();
                if (t === 'points' || t === 'lines' || t === 'mesh') {
                    geom.objectType = t;
                }
            }
            const part = viewer.createHandleFromGeometry(
                geom,
                `${key}_obj${i}`,
                version,
                obj.texturePath || payload.texturePath || 'builtin://checkerboard',
                `${obj.type || 'object'} #${i}`
            );
            if (part) parts.push(part);
        }
        if (parts.length > 0) {
            const handle = { key, version, parts, isComposite: true, geometryInteractionReady: false };
            viewer.meshCache.set(key, handle);
            return handle;
        }
    }

    const geom = viewer.extractGeometry(payload);
    if (!geom || geom.vertexCount === 0) return null;
    const handle = viewer.createHandleFromGeometry(
        geom,
        key,
        version,
        geom.texturePath || payload.texturePath || 'builtin://checkerboard',
        payload.meshId || key
    );
    if (!handle) return null;
    viewer.meshCache.set(key, handle);
    return handle;
}

export function hydrateHandleForPayload(viewer, payload) {
    if (!viewer.gl || !viewer.program || !payload) return null;
    const key = payload.meshId || `mesh_${payload.version || '0'}`;
    const version = payload.version || 0;
    const handle = viewer.meshCache.get(key);
    if (!handle || handle.version !== version || handle.isComposite) {
        return null;
    }

    const geom = viewer.extractGeometry(payload);
    if (!geom || geom.vertexCount === 0) {
        return handle;
    }

    let touched = false;

    const nextTri = Array.isArray(geom.triIndices) ? geom.triIndices : [];
    if (nextTri.length > 0) {
        const prevTri = Array.isArray(handle.geometry?.triIndices) ? handle.geometry.triIndices : [];
        if (prevTri.length !== nextTri.length) {
            viewer.releaseIndexedLodBuffers(handle.lods);
            viewer.releaseIndexedLodBuffers(handle.edgeLods);
            handle.lods = [createIndexedLodBuffer(viewer, nextTri)];
            handle.edgeLods = null;
            handle.triIndices = nextTri;
            handle.geometry.triIndices = nextTri;
            handle.objectType = 'mesh';
            touched = true;
        }
    }

    const nextLine = Array.isArray(geom.lineIndices) ? geom.lineIndices : [];
    if (nextLine.length > 0) {
        const prevLine = Array.isArray(handle.geometry?.lineIndices) ? handle.geometry.lineIndices : [];
        if (prevLine.length !== nextLine.length) {
            viewer.releaseIndexedLodBuffers(handle.lineLods);
            viewer.releaseArrowLodBuffers(handle.arrowLods);
            handle.lineLods = [createIndexedLodBuffer(viewer, nextLine)];
            handle.arrowLods = [
                viewer.buildDirectedArrowLod(
                    handle.geometry.vertices,
                    handle.geometry.colors || [],
                    nextLine,
                    geom.vectorLineFlags || handle.geometry.vectorLineFlags || [],
                    1
                )
            ];
            handle.geometry.lineIndices = nextLine;
            handle.geometry.lineIndicesDerived = !!geom.lineIndicesDerived;
            handle.geometry.vectorLineFlags = geom.vectorLineFlags || handle.geometry.vectorLineFlags || [];
            if ((handle.geometry.triIndices || []).length === 0) {
                handle.objectType = 'lines';
            }
            touched = true;
        }
    }

    const nextPoint = Array.isArray(geom.pointIndices) ? geom.pointIndices : [];
    if (nextPoint.length > 0) {
        const prevPoint = Array.isArray(handle.geometry?.pointIndices) ? handle.geometry.pointIndices : [];
        if (prevPoint.length !== nextPoint.length) {
            viewer.releaseIndexedLodBuffers(handle.pointLods);
            handle.pointLods = [createIndexedLodBuffer(viewer, nextPoint)];
            handle.geometry.pointIndices = nextPoint;
            if ((handle.geometry.triIndices || []).length === 0 && (handle.geometry.lineIndices || []).length === 0) {
                handle.objectType = 'points';
            }
            touched = true;
        }
    }

    if (touched) {
        handle.auxBuffersReady = false;
    }
    return handle;
}
