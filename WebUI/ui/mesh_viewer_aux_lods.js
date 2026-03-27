function createIndexedLodBuffer(viewer, indexArray) {
    if (!viewer.gl) return null;
    const ebo = viewer.gl.createBuffer();
    const typed = new Uint32Array(indexArray);
    viewer.gl.bindBuffer(viewer.gl.ELEMENT_ARRAY_BUFFER, ebo);
    viewer.gl.bufferData(viewer.gl.ELEMENT_ARRAY_BUFFER, typed, viewer.gl.STATIC_DRAW);
    return { ebo, indexCount: typed.length };
}

export function buildAuxiliaryFaceLods(viewer, handle) {
    const triIndices = Array.isArray(handle?.triIndices) ? handle.triIndices : [];
    const nextFaceLods = handle.lods && handle.lods.length > 0 ? [handle.lods[0]] : [];
    if (triIndices.length > 0) {
        const mid = viewer.buildLodIndices(triIndices, 2);
        const far = viewer.buildLodIndices(triIndices, 4);
        nextFaceLods[1] = createIndexedLodBuffer(viewer, mid);
        nextFaceLods[2] = createIndexedLodBuffer(viewer, far);
    }
    return nextFaceLods.filter(Boolean);
}

export function buildAuxiliaryLineLods(viewer, handle) {
    const lineIndicesInput = Array.isArray(handle?.geometry?.lineIndices) ? handle.geometry.lineIndices : [];
    const nextLineLods = handle.lineLods && handle.lineLods.length > 0 ? [handle.lineLods[0]] : [];
    if (lineIndicesInput.length > 0) {
        nextLineLods[1] = createIndexedLodBuffer(viewer, viewer.buildLineLodIndices(lineIndicesInput, 2));
        nextLineLods[2] = createIndexedLodBuffer(viewer, viewer.buildLineLodIndices(lineIndicesInput, 4));
    }
    return nextLineLods.filter(Boolean);
}

export function buildAuxiliaryPointLods(viewer, handle) {
    const pointIndicesInput = Array.isArray(handle?.geometry?.pointIndices) ? handle.geometry.pointIndices : [];
    const nextPointLods = handle.pointLods && handle.pointLods.length > 0 ? [handle.pointLods[0]] : [];
    if (pointIndicesInput.length > 0) {
        nextPointLods[1] = createIndexedLodBuffer(viewer, viewer.buildPointLodIndices(pointIndicesInput, 2));
        nextPointLods[2] = createIndexedLodBuffer(viewer, viewer.buildPointLodIndices(pointIndicesInput, 4));
    }
    return nextPointLods.filter(Boolean);
}

export function buildAuxiliaryArrowLods(viewer, handle) {
    const lineIndicesInput = Array.isArray(handle?.geometry?.lineIndices) ? handle.geometry.lineIndices : [];
    const lineFlagsInput = Array.isArray(handle?.geometry?.vectorLineFlags) ? handle.geometry.vectorLineFlags : [];
    const nextArrowLods = handle.arrowLods && handle.arrowLods.length > 0 ? [handle.arrowLods[0]] : [];
    nextArrowLods[1] = viewer.buildDirectedArrowLod(
        handle.geometry.vertices,
        handle.geometry.colors || [],
        lineIndicesInput,
        lineFlagsInput,
        2
    );
    nextArrowLods[2] = viewer.buildDirectedArrowLod(
        handle.geometry.vertices,
        handle.geometry.colors || [],
        lineIndicesInput,
        lineFlagsInput,
        4
    );
    return nextArrowLods.filter(Boolean);
}

export function scheduleHandleAuxiliaryBuild(viewer, handle) {
    if (!handle || !handle.key || handle.auxBuffersReady === true) return;
    if (viewer.pendingHandleAuxBuilds.has(handle.key)) return;
    const task = (async () => {
        await viewer.afterNextPaint();
        if (!viewer.gl) return;

        handle.lods = buildAuxiliaryFaceLods(viewer, handle);
        handle.lineLods = buildAuxiliaryLineLods(viewer, handle);
        handle.pointLods = buildAuxiliaryPointLods(viewer, handle);
        handle.arrowLods = buildAuxiliaryArrowLods(viewer, handle);
        handle.auxBuffersReady = true;

        if (viewer.currentMeshHandle === handle || viewer.currentMeshHandle?.parts?.includes(handle)) {
            viewer.startRenderLoop();
        }
    })().finally(() => {
        viewer.pendingHandleAuxBuilds.delete(handle.key);
    });
    viewer.pendingHandleAuxBuilds.set(handle.key, task);
}
