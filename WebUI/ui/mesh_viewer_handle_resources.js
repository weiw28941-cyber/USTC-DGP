export function computeVertexNormals(viewer, vertices, triIndices, vertexCount) {
    const normals = new Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) normals[i] = [0, 0, 0];

    for (let i = 0; i + 2 < triIndices.length; i += 3) {
        const i0 = triIndices[i] | 0;
        const i1 = triIndices[i + 1] | 0;
        const i2 = triIndices[i + 2] | 0;
        if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) {
            continue;
        }
        const v0 = vertices[i0];
        const v1 = vertices[i1];
        const v2 = vertices[i2];
        const ux = v1[0] - v0[0];
        const uy = v1[1] - v0[1];
        const uz = v1[2] - v0[2];
        const vx = v2[0] - v0[0];
        const vy = v2[1] - v0[1];
        const vz = v2[2] - v0[2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        normals[i0][0] += nx; normals[i0][1] += ny; normals[i0][2] += nz;
        normals[i1][0] += nx; normals[i1][1] += ny; normals[i1][2] += nz;
        normals[i2][0] += nx; normals[i2][1] += ny; normals[i2][2] += nz;
    }
    return normals;
}

export function releaseIndexedLodBuffers(viewer, lods) {
    if (!viewer.gl || !Array.isArray(lods)) return;
    for (const lod of lods) {
        if (lod?.ebo) {
            viewer.gl.deleteBuffer(lod.ebo);
        }
    }
}

export function releaseArrowLodBuffers(viewer, lods) {
    if (!viewer.gl || !Array.isArray(lods)) return;
    for (const lod of lods) {
        if (lod?.vao) {
            viewer.gl.deleteVertexArray(lod.vao);
        }
        if (lod?.vbo) {
            viewer.gl.deleteBuffer(lod.vbo);
        }
    }
}

export function releaseHandleGpuResources(viewer, handle) {
    if (!viewer.gl || !handle) return;
    if (handle.vao) {
        viewer.gl.deleteVertexArray(handle.vao);
    }
    if (handle.vbo) {
        viewer.gl.deleteBuffer(handle.vbo);
    }
    releaseIndexedLodBuffers(viewer, handle.lods);
    releaseIndexedLodBuffers(viewer, handle.lineLods);
    releaseIndexedLodBuffers(viewer, handle.pointLods);
    releaseIndexedLodBuffers(viewer, handle.edgeLods);
    releaseArrowLodBuffers(viewer, handle.arrowLods);
}

export function createHandleFromGeometry(viewer, geom, key, version, texturePath, label = '') {
    if (!viewer.gl || !viewer.program) return null;
    const gl = viewer.gl;
    const vertices = geom.vertices;
    const triIndices = geom.triIndices;
    const lineIndicesInput = geom.lineIndices;
    const lineIndicesDerived = !!geom.lineIndicesDerived;
    const lineFlagsInput = geom.vectorLineFlags || [];
    const pointIndicesInput = geom.pointIndices;
    const vertexCount = geom.vertexCount;
    const vertexColors = geom.colors || [];
    let vertexUV = (Array.isArray(geom.uv) && geom.uv.length === vertexCount)
        ? geom.uv.slice()
        : new Array(vertexCount).fill(null).map(() => [0.0, 0.0]);
    const uvPool = geom.uvPool || [];
    const triUvIds = geom.triTexcoordIndices || [];
    if (triUvIds.length > 0 && uvPool.length > 0) {
        const assigned = new Uint8Array(vertexCount);
        const pairCount = Math.min(triIndices.length, triUvIds.length);
        for (let i = 0; i + 2 < pairCount; i += 3) {
            for (let k = 0; k < 3; k++) {
                const vi = triIndices[i + k] | 0;
                const ui = triUvIds[i + k] | 0;
                if (vi < 0 || vi >= vertexCount || ui < 0 || ui >= uvPool.length) continue;
                if (!assigned[vi]) {
                    vertexUV[vi] = uvPool[ui];
                    assigned[vi] = 1;
                }
            }
        }
    }
    const hasPrecomputedNormals = Array.isArray(geom.normals) && geom.normals.length === vertexCount;
    const normals = hasPrecomputedNormals
        ? geom.normals
        : (triIndices.length > 0
            ? computeVertexNormals(viewer, vertices, triIndices, vertexCount)
            : (() => {
                const seed = new Array(vertexCount);
                for (let i = 0; i < vertexCount; i++) seed[i] = [0, 0, 1];
                return seed;
            })());

    const interleaved = new Float32Array(vertexCount * 11);
    for (let i = 0; i < vertexCount; i++) {
        const v = vertices[i];
        const n = normals[i];
        const len = Math.hypot(n[0], n[1], n[2]) || 1.0;
        const c = vertexColors[i] || [0.82, 0.84, 0.88];
        const uv = vertexUV[i] || [0.0, 0.0];
        const o = i * 11;
        interleaved[o] = v[0];
        interleaved[o + 1] = v[1];
        interleaved[o + 2] = v[2];
        interleaved[o + 3] = n[0] / len;
        interleaved[o + 4] = n[1] / len;
        interleaved[o + 5] = n[2] / len;
        interleaved[o + 6] = Number(c[0]) || 0;
        interleaved[o + 7] = Number(c[1]) || 0;
        interleaved[o + 8] = Number(c[2]) || 0;
        interleaved[o + 9] = Number(uv[0]) || 0;
        interleaved[o + 10] = Number(uv[1]) || 0;
    }

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(viewer.attribs.pos);
    gl.vertexAttribPointer(viewer.attribs.pos, 3, gl.FLOAT, false, 44, 0);
    gl.enableVertexAttribArray(viewer.attribs.normal);
    gl.vertexAttribPointer(viewer.attribs.normal, 3, gl.FLOAT, false, 44, 12);
    gl.enableVertexAttribArray(viewer.attribs.color);
    gl.vertexAttribPointer(viewer.attribs.color, 3, gl.FLOAT, false, 44, 24);
    gl.enableVertexAttribArray(viewer.attribs.uv);
    gl.vertexAttribPointer(viewer.attribs.uv, 2, gl.FLOAT, false, 44, 36);
    gl.bindVertexArray(null);

    const makeLodBuffer = (indexArray) => {
        const ebo = gl.createBuffer();
        const typed = new Uint32Array(indexArray);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, typed, gl.STATIC_DRAW);
        return { ebo, indexCount: typed.length };
    };
    const lods = [makeLodBuffer(triIndices)];
    const lineLods = [makeLodBuffer(lineIndicesInput)];
    const pointLods = [makeLodBuffer(pointIndicesInput)];
    const arrowLods = [
        viewer.buildDirectedArrowLod(vertices, vertexColors, lineIndicesInput, lineFlagsInput, 1)
    ];

    return {
        key,
        version,
        vao,
        vbo,
        lods,
        triIndices,
        lineLods,
        arrowLods,
        pointLods,
        edgeLods: null,
        vertexCount,
        texturePath: texturePath || 'builtin://checkerboard',
        label: label || key,
        objectType: (geom.objectType === 'points' || geom.objectType === 'lines' || geom.objectType === 'mesh')
            ? geom.objectType
            : ((triIndices.length > 0) ? 'mesh' : ((lineIndicesInput.length > 0) ? 'lines' : 'points')),
        geometry: {
            vertices,
            triIndices,
            lineIndices: lineIndicesInput,
            lineIndicesDerived,
            pointIndices: pointIndicesInput,
            colors: vertexColors,
            uv: vertexUV,
            normals,
            uvPool,
            triTexcoordIndices: triUvIds,
            vectorLineFlags: lineFlagsInput,
            vertexCount
        },
        auxBuffersReady: false,
        normalsReady: true,
        geometryInteractionReady: false
    };
}
