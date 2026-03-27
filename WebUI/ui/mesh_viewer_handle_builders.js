export function buildDirectedArrowLod(viewer, vertices, vertexColors, lineIndices, lineFlags, step) {
    if (!viewer.gl) return null;
    const gl = viewer.gl;
    if (!Array.isArray(lineIndices) || lineIndices.length < 2) {
        return { vao: null, vbo: null, vertexCount: 0 };
    }

    const lineCount = Math.floor(lineIndices.length / 2);
    const interleaved = [];
    const pushVertex = (p, c) => {
        interleaved.push(
            p[0], p[1], p[2],
            0, 0, 1,
            c[0], c[1], c[2],
            0, 0
        );
    };

    const worldUp = [0, 1, 0];
    const altUp = [1, 0, 0];
    for (let segIdx = 0; segIdx < lineCount; segIdx++) {
        if ((segIdx % step) !== 0) continue;
        const directed = (lineFlags[segIdx] | 0) === 1;
        if (!directed) continue;
        const aIdx = lineIndices[segIdx * 2] | 0;
        const bIdx = lineIndices[segIdx * 2 + 1] | 0;
        if (aIdx < 0 || bIdx < 0 || aIdx >= vertices.length || bIdx >= vertices.length) continue;
        const a = vertices[aIdx];
        const b = vertices[bIdx];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dz = b[2] - a[2];
        const len = Math.hypot(dx, dy, dz);
        if (len < 1e-8) continue;
        const dir = [dx / len, dy / len, dz / len];

        let px = dir[1] * worldUp[2] - dir[2] * worldUp[1];
        let py = dir[2] * worldUp[0] - dir[0] * worldUp[2];
        let pz = dir[0] * worldUp[1] - dir[1] * worldUp[0];
        let plen = Math.hypot(px, py, pz);
        if (plen < 1e-6) {
            px = dir[1] * altUp[2] - dir[2] * altUp[1];
            py = dir[2] * altUp[0] - dir[0] * altUp[2];
            pz = dir[0] * altUp[1] - dir[1] * altUp[0];
            plen = Math.hypot(px, py, pz);
        }
        if (plen < 1e-6) continue;
        px /= plen; py /= plen; pz /= plen;

        const wingLen = Math.max(0.01, len * 0.22);
        const spread = 0.55;
        const w1 = [-dir[0] + px * spread, -dir[1] + py * spread, -dir[2] + pz * spread];
        const w2 = [-dir[0] - px * spread, -dir[1] - py * spread, -dir[2] - pz * spread];
        const w1Len = Math.hypot(w1[0], w1[1], w1[2]) || 1;
        const w2Len = Math.hypot(w2[0], w2[1], w2[2]) || 1;
        const tip1 = [b[0] + (w1[0] / w1Len) * wingLen, b[1] + (w1[1] / w1Len) * wingLen, b[2] + (w1[2] / w1Len) * wingLen];
        const tip2 = [b[0] + (w2[0] / w2Len) * wingLen, b[1] + (w2[1] / w2Len) * wingLen, b[2] + (w2[2] / w2Len) * wingLen];
        const color = vertexColors[bIdx] || [0.95, 0.35, 0.2];
        pushVertex(b, color);
        pushVertex(tip1, color);
        pushVertex(b, color);
        pushVertex(tip2, color);
    }

    if (interleaved.length === 0) {
        return { vao: null, vbo: null, vertexCount: 0 };
    }

    const data = new Float32Array(interleaved);
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(viewer.attribs.pos);
    gl.vertexAttribPointer(viewer.attribs.pos, 3, gl.FLOAT, false, 44, 0);
    gl.enableVertexAttribArray(viewer.attribs.normal);
    gl.vertexAttribPointer(viewer.attribs.normal, 3, gl.FLOAT, false, 44, 12);
    gl.enableVertexAttribArray(viewer.attribs.color);
    gl.vertexAttribPointer(viewer.attribs.color, 3, gl.FLOAT, false, 44, 24);
    gl.enableVertexAttribArray(viewer.attribs.uv);
    gl.vertexAttribPointer(viewer.attribs.uv, 2, gl.FLOAT, false, 44, 36);
    gl.bindVertexArray(null);
    return { vao, vbo, vertexCount: data.length / 11 };
}

export function buildLodIndices(viewer, indices, triStep) {
    if (!Array.isArray(indices) || triStep <= 1) return indices;
    if (indices.length < 6) return indices;

    const tris = [];
    for (let i = 0; i + 2 < indices.length; i += 3) {
        tris.push([indices[i], indices[i + 1], indices[i + 2]]);
    }

    const groups = [];
    let pairedCount = 0;
    const shareEdge = (a, b) => {
        let shared = 0;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (a[i] === b[j]) shared++;
            }
        }
        return shared >= 2;
    };

    for (let i = 0; i < tris.length;) {
        if (i + 1 < tris.length && shareEdge(tris[i], tris[i + 1])) {
            groups.push([tris[i], tris[i + 1]]);
            pairedCount += 2;
            i += 2;
        } else {
            groups.push([tris[i]]);
            i += 1;
        }
    }

    const pairRatio = pairedCount / Math.max(1, tris.length);
    if (pairRatio < 0.6) return indices;

    const out = [];
    for (let g = 0; g < groups.length; g += triStep) {
        for (const tri of groups[g]) {
            out.push(tri[0], tri[1], tri[2]);
        }
    }
    return out.length > 0 ? out : indices;
}

export function buildLineLodIndices(viewer, indices, step) {
    if (!Array.isArray(indices) || step <= 1) return indices;
    const out = [];
    for (let i = 0; i + 1 < indices.length; i += 2 * step) {
        out.push(indices[i], indices[i + 1]);
    }
    return out.length > 0 ? out : indices;
}

export function buildPointLodIndices(viewer, indices, step) {
    if (!Array.isArray(indices) || step <= 1) return indices;
    const out = [];
    for (let i = 0; i < indices.length; i += step) {
        out.push(indices[i]);
    }
    return out.length > 0 ? out : indices;
}
