export function computeFrameViewState(viewer) {
    const canvas = viewer.canvas;
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }

    const boundsMin = viewer.currentPayload.boundsMin || [-1, -1, -1];
    const boundsMax = viewer.currentPayload.boundsMax || [1, 1, 1];
    const cx = 0.5 * (boundsMin[0] + boundsMax[0]);
    const cy = 0.5 * (boundsMin[1] + boundsMax[1]);
    const cz = 0.5 * (boundsMin[2] + boundsMax[2]);
    const tx = cx + viewer.cameraPan[0];
    const ty = cy + viewer.cameraPan[1];
    const tz = cz + viewer.cameraPan[2];
    const sx = boundsMax[0] - boundsMin[0];
    const sy = boundsMax[1] - boundsMin[1];
    const sz = boundsMax[2] - boundsMin[2];
    const radius = Math.max(0.001, 0.5 * Math.hypot(sx, sy, sz));
    const dist = Math.max(viewer.cameraDistance * radius, 0.01);

    const eyeOffset = viewer.rotateByQuat([0, 0, dist], viewer.viewQuat);
    const upDir = viewer.rotateByQuat([0, 1, 0], viewer.viewQuat);
    const ex = tx + eyeOffset[0];
    const ey = ty + eyeOffset[1];
    const ez = tz + eyeOffset[2];

    const proj = viewer.perspective(45 * Math.PI / 180, canvas.width / Math.max(1, canvas.height), 0.001, 1000.0);
    const view = viewer.lookAt([ex, ey, ez], [tx, ty, tz], upDir);
    const model = viewer.identity();
    const mvp = viewer.multiplyMat4(proj, viewer.multiplyMat4(view, model));

    return {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        model,
        mvp
    };
}

export function drawHandle(viewer, handle, shared) {
    const gl = viewer.gl;
    if (!gl) return;
    if (viewer.objectVisibility.get(handle.key) === false) {
        return;
    }

    const displayFlags = viewer.getObjectDisplayFlags(handle);
    const mode = viewer.getHandleColorMode(handle);
    let colorModeValue = 0.0;
    if (mode === 'colormap') colorModeValue = 1.0;
    else if (mode === 'texture') colorModeValue = 2.0;
    gl.uniform1f(viewer.uniforms.colorMode, colorModeValue);
    if (mode === 'colormap') {
        const stops = viewer.objectColorbars.get(handle.key) || viewer.getDefaultColorbarStops();
        viewer.updateColorbarTexture(stops);
    }
    const texturePath = viewer.objectTextureOverrides.get(handle.key) || handle.texturePath;
    const tex = viewer.getTexture(texturePath);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(viewer.uniforms.tex, 0);
    gl.uniform1i(viewer.uniforms.hasTexture, mode === 'texture' ? 1 : 0);
    gl.bindVertexArray(handle.vao);

    const faceLodIndex = Math.min(shared.lodIndex, handle.lods.length - 1);
    const lineLodIndex = viewer.chooseLineLodIndex(handle, faceLodIndex);
    const pointLodIndex = viewer.choosePointLodIndex(handle, faceLodIndex);
    const overlayOnly = !displayFlags.faces;
    if (!viewer.lastDrawStats) {
        viewer.lastDrawStats = { faces: 0, lines: 0, points: 0, faceIndices: 0, lineIndices: 0, pointIndices: 0 };
    }
    const triLod = handle.lods[faceLodIndex];
    if (displayFlags.faces && triLod && triLod.indexCount > 0) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.0, 1.0);
        gl.uniform1f(viewer.uniforms.renderMode, 0.0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triLod.ebo);
        gl.drawElements(gl.TRIANGLES, triLod.indexCount, gl.UNSIGNED_INT, 0);
        viewer.lastDrawStats.faces += 1;
        viewer.lastDrawStats.faceIndices += triLod.indexCount;
        gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    if (displayFlags.lines) {
        viewer.ensureLineRenderResources(handle);
    }
    const lineLod = viewer.getRenderableLineLod(handle, lineLodIndex);
    if (displayFlags.lines && lineLod && lineLod.indexCount > 0) {
        if (overlayOnly) {
            gl.disable(gl.DEPTH_TEST);
        }
        gl.uniform1f(viewer.uniforms.renderMode, 1.0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineLod.ebo);
        gl.drawElements(gl.LINES, lineLod.indexCount, gl.UNSIGNED_INT, 0);
        viewer.lastDrawStats.lines += 1;
        viewer.lastDrawStats.lineIndices += lineLod.indexCount;
        if (overlayOnly) {
            gl.enable(gl.DEPTH_TEST);
        }
    }
    const arrowLod = handle.arrowLods
        ? handle.arrowLods[Math.min(lineLodIndex, handle.arrowLods.length - 1)]
        : null;
    if (displayFlags.lines && arrowLod && arrowLod.vao && arrowLod.vertexCount > 0) {
        if (overlayOnly) {
            gl.disable(gl.DEPTH_TEST);
        }
        gl.uniform1f(viewer.uniforms.renderMode, 1.0);
        gl.bindVertexArray(arrowLod.vao);
        gl.drawArrays(gl.LINES, 0, arrowLod.vertexCount);
        gl.bindVertexArray(handle.vao);
        if (overlayOnly) {
            gl.enable(gl.DEPTH_TEST);
        }
    }

    if (displayFlags.points) {
        viewer.ensurePointRenderResources(handle);
    }
    const pointLod = handle.pointLods[Math.min(pointLodIndex, handle.pointLods.length - 1)];
    if (displayFlags.points && pointLod && pointLod.indexCount > 0) {
        gl.uniform1f(viewer.uniforms.renderMode, 2.0);
        gl.uniform1f(viewer.uniforms.pointSize, 6.0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pointLod.ebo);
        gl.drawElements(gl.POINTS, pointLod.indexCount, gl.UNSIGNED_INT, 0);
        viewer.lastDrawStats.points += 1;
        viewer.lastDrawStats.pointIndices += pointLod.indexCount;
        gl.uniform1f(viewer.uniforms.pointSize, 4.0);
    }
    gl.bindVertexArray(null);
}
