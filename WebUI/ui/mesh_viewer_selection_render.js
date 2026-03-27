export function renderSelectedVertices(viewer, mvp) {
    const gl = viewer.gl;
    if (!gl || viewer.selectedVertices.size === 0) return;

    const positions = [];
    for (const vid of viewer.selectedVertices) {
        const pos = viewer.vertexPositions.get(vid);
        if (pos) positions.push(pos[0], pos[1], pos[2]);
    }
    if (positions.length === 0) return;

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(viewer.program);
    gl.uniformMatrix4fv(viewer.uniforms.mvp, false, mvp);
    gl.uniform1f(viewer.uniforms.renderMode, 2.0);
    gl.uniform1f(viewer.uniforms.colorMode, -1.0);
    gl.uniform1f(viewer.uniforms.pointSize, 12.0);
    gl.enableVertexAttribArray(viewer.attribs.pos);
    gl.vertexAttribPointer(viewer.attribs.pos, 3, gl.FLOAT, false, 0, 0);

    if (viewer.attribs.color !== undefined && viewer.attribs.color >= 0) {
        gl.disableVertexAttribArray(viewer.attribs.color);
        gl.vertexAttrib4f(viewer.attribs.color, 0.0, 1.0, 0.0, 1.0);
    }
    if (viewer.attribs.normal !== undefined && viewer.attribs.normal >= 0) {
        gl.disableVertexAttribArray(viewer.attribs.normal);
        gl.vertexAttrib3f(viewer.attribs.normal, 0.0, 1.0, 0.0);
    }
    if (viewer.attribs.uv !== undefined && viewer.attribs.uv >= 0) {
        gl.disableVertexAttribArray(viewer.attribs.uv);
        gl.vertexAttrib2f(viewer.attribs.uv, 0.0, 0.0);
    }

    gl.drawArrays(gl.POINTS, 0, positions.length / 3);
    gl.enable(gl.DEPTH_TEST);
    gl.deleteBuffer(vbo);
    gl.uniform1f(viewer.uniforms.pointSize, 4.0);
}

export function renderSelectedEdges(viewer, mvp) {
    const gl = viewer.gl;
    if (!gl || viewer.selectedEdges.size === 0) return;

    const positions = [];
    for (const edgeStr of viewer.selectedEdges) {
        const [v1, v2] = edgeStr.split('-').map(Number);
        const p1 = viewer.vertexPositions.get(v1);
        const p2 = viewer.vertexPositions.get(v2);
        if (p1 && p2) {
            positions.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
        }
    }
    if (positions.length === 0) return;

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(viewer.program);
    gl.uniformMatrix4fv(viewer.uniforms.mvp, false, mvp);
    gl.uniform1f(viewer.uniforms.renderMode, 1.0);
    gl.uniform1f(viewer.uniforms.colorMode, -1.0);
    gl.enableVertexAttribArray(viewer.attribs.pos);
    gl.vertexAttribPointer(viewer.attribs.pos, 3, gl.FLOAT, false, 0, 0);

    if (viewer.attribs.color !== undefined && viewer.attribs.color >= 0) {
        gl.disableVertexAttribArray(viewer.attribs.color);
        gl.vertexAttrib4f(viewer.attribs.color, 0.0, 1.0, 0.0, 1.0);
    }
    if (viewer.attribs.normal !== undefined && viewer.attribs.normal >= 0) {
        gl.disableVertexAttribArray(viewer.attribs.normal);
        gl.vertexAttrib3f(viewer.attribs.normal, 0.0, 1.0, 0.0);
    }
    if (viewer.attribs.uv !== undefined && viewer.attribs.uv >= 0) {
        gl.disableVertexAttribArray(viewer.attribs.uv);
        gl.vertexAttrib2f(viewer.attribs.uv, 0.0, 0.0);
    }

    gl.lineWidth(3.0);
    gl.drawArrays(gl.LINES, 0, positions.length / 3);
    gl.lineWidth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.deleteBuffer(vbo);
}

export function renderSelectedFaces(viewer, mvp) {
    const gl = viewer.gl;
    if (!gl || viewer.selectedFaces.size === 0) return;

    const positions = [];
    for (const faceId of viewer.selectedFaces) {
        const face = viewer.faceList[faceId];
        if (!face) continue;
        const [v1, v2, v3] = face;
        const p1 = viewer.vertexPositions.get(v1);
        const p2 = viewer.vertexPositions.get(v2);
        const p3 = viewer.vertexPositions.get(v3);
        if (p1 && p2 && p3) {
            positions.push(
                p1[0], p1[1], p1[2],
                p2[0], p2[1], p2[2],
                p3[0], p3[1], p3[2]
            );
        }
    }
    if (positions.length === 0) return;

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(viewer.program);
    gl.uniformMatrix4fv(viewer.uniforms.mvp, false, mvp);
    gl.uniform1f(viewer.uniforms.renderMode, 0.0);
    gl.uniform1f(viewer.uniforms.colorMode, -1.0);
    gl.enableVertexAttribArray(viewer.attribs.pos);
    gl.vertexAttribPointer(viewer.attribs.pos, 3, gl.FLOAT, false, 0, 0);

    if (viewer.attribs.color !== undefined && viewer.attribs.color >= 0) {
        gl.disableVertexAttribArray(viewer.attribs.color);
        gl.vertexAttrib4f(viewer.attribs.color, 0.0, 1.0, 0.0, 0.5);
    }
    if (viewer.attribs.normal !== undefined && viewer.attribs.normal >= 0) {
        gl.disableVertexAttribArray(viewer.attribs.normal);
        gl.vertexAttrib3f(viewer.attribs.normal, 0.0, 1.0, 0.0);
    }
    if (viewer.attribs.uv !== undefined && viewer.attribs.uv >= 0) {
        gl.disableVertexAttribArray(viewer.attribs.uv);
        gl.vertexAttrib2f(viewer.attribs.uv, 0.0, 0.0);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, positions.length / 3);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.deleteBuffer(vbo);
}
