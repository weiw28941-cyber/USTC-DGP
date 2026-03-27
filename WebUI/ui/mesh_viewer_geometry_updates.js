import {
    buildLodIndices
} from './mesh_viewer_handle_builders.js';
import {
    computeVertexNormals,
    releaseIndexedLodBuffers
} from './mesh_viewer_handle_resources.js';

function getDefaultNormals(vertexCount) {
    const seed = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) seed[i] = [0, 0, 1];
    return seed;
}

function rebuildInterleavedVertexBuffer(viewer, handle) {
    const gl = viewer.gl;
    const geom = handle?.geometry;
    if (!gl || !geom || !handle?.vbo) return;
    const vertices = geom.vertices || [];
    const vertexCount = geom.vertexCount || vertices.length;
    const triIndices = geom.triIndices || [];
    const vertexColors = geom.colors || [];
    const vertexUV = geom.uv || [];
    const normals = triIndices.length > 0
        ? computeVertexNormals(viewer, vertices, triIndices, vertexCount)
        : (Array.isArray(geom.normals) && geom.normals.length === vertexCount
            ? geom.normals
            : getDefaultNormals(vertexCount));
    geom.normals = normals;
    handle.normalsReady = true;
    const interleaved = new Float32Array(vertexCount * 11);
    for (let i = 0; i < vertexCount; i++) {
        const v = vertices[i] || [0, 0, 0];
        const n = normals[i] || [0, 0, 1];
        const len = Math.hypot(n[0], n[1], n[2]) || 1.0;
        const c = vertexColors[i] || [0.82, 0.84, 0.88];
        const uv = vertexUV[i] || [0.0, 0.0];
        const o = i * 11;
        interleaved[o] = Number(v[0]) || 0;
        interleaved[o + 1] = Number(v[1]) || 0;
        interleaved[o + 2] = Number(v[2]) || 0;
        interleaved[o + 3] = (Number(n[0]) || 0) / len;
        interleaved[o + 4] = (Number(n[1]) || 0) / len;
        interleaved[o + 5] = (Number(n[2]) || 0) / len;
        interleaved[o + 6] = Number(c[0]) || 0;
        interleaved[o + 7] = Number(c[1]) || 0;
        interleaved[o + 8] = Number(c[2]) || 0;
        interleaved[o + 9] = Number(uv[0]) || 0;
        interleaved[o + 10] = Number(uv[1]) || 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, handle.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
}

function buildTriangleLods(viewer, triIndices) {
    const gl = viewer.gl;
    if (!gl) return [];
    const steps = [1, 2, 4];
    return steps.map((step) => {
        const reduced = buildLodIndices(viewer, triIndices, step);
        const typed = new Uint32Array(reduced || []);
        const ebo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, typed, gl.STATIC_DRAW);
        return { ebo, indexCount: typed.length };
    });
}

export function rebuildPartBuffers(viewer, part) {
    if (!part?.geometry || !part?.lods) return;
    rebuildInterleavedVertexBuffer(viewer, part);
    const newLods = buildTriangleLods(viewer, part.geometry.triIndices || []);
    releaseIndexedLodBuffers(viewer, part.lods);
    part.lods = newLods;
}

export function rebuildHandleBuffers(viewer, handle) {
    if (!handle?.geometry || !handle?.lods) return;
    rebuildInterleavedVertexBuffer(viewer, handle);
    const newLods = buildTriangleLods(viewer, handle.geometry.triIndices || []);
    releaseIndexedLodBuffers(viewer, handle.lods);
    handle.lods = newLods;
}

export function updateMeshGeometry(viewer) {
    if (!viewer.currentMeshHandle) return;
    if (viewer.currentMeshHandle.isComposite && viewer.currentMeshHandle.parts) {
        let globalVertexId = 0;
        for (const part of viewer.currentMeshHandle.parts) {
            if (part.geometry && part.geometry.vertices) {
                for (let i = 0; i < part.geometry.vertices.length; i++) {
                    const pos = viewer.vertexPositions.get(globalVertexId++);
                    if (pos) {
                        part.geometry.vertices[i] = [...pos];
                    }
                }
                rebuildPartBuffers(viewer, part);
            }
        }
        return;
    }
    if (viewer.currentMeshHandle.geometry && viewer.currentMeshHandle.geometry.vertices) {
        for (let i = 0; i < viewer.currentMeshHandle.geometry.vertices.length; i++) {
            const pos = viewer.vertexPositions.get(i);
            if (pos) {
                viewer.currentMeshHandle.geometry.vertices[i] = [...pos];
            }
        }
        rebuildHandleBuffers(viewer, viewer.currentMeshHandle);
    }
}
