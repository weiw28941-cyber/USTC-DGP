export function buildEdgeLods(viewer, handle) {
    if (!viewer.gl || !handle) return null;
    if (handle.edgeLods) return handle.edgeLods;

    const buildFromTriIndices = (triIndices) => {
        const edges = [];
        const seen = new Set();
        for (let i = 0; i + 2 < triIndices.length; i += 3) {
            const a = triIndices[i] | 0;
            const b = triIndices[i + 1] | 0;
            const c = triIndices[i + 2] | 0;
            const pairs = [[a, b], [b, c], [c, a]];
            for (const [u0, v0] of pairs) {
                const u = Math.min(u0, v0);
                const v = Math.max(u0, v0);
                const key = `${u}:${v}`;
                if (seen.has(key)) continue;
                seen.add(key);
                edges.push(u, v);
            }
        }
        const typed = new Uint32Array(edges);
        const ebo = viewer.gl.createBuffer();
        viewer.gl.bindBuffer(viewer.gl.ELEMENT_ARRAY_BUFFER, ebo);
        viewer.gl.bufferData(viewer.gl.ELEMENT_ARRAY_BUFFER, typed, viewer.gl.STATIC_DRAW);
        return { ebo, indexCount: typed.length };
    };

    const triIndicesFull = handle.triIndices || [];
    const triIndicesMid = viewer.buildLodIndices(triIndicesFull, 2);
    const triIndicesFar = viewer.buildLodIndices(triIndicesFull, 4);
    const edgeLods = [
        buildFromTriIndices(triIndicesFull),
        buildFromTriIndices(triIndicesMid),
        buildFromTriIndices(triIndicesFar)
    ];

    handle.edgeLods = edgeLods;
    return edgeLods;
}

export function scheduleEdgeLodBuild(viewer, handle) {
    if (!viewer || !handle || !Array.isArray(handle?.triIndices) || handle.triIndices.length === 0) return null;
    if (Array.isArray(handle.edgeLods) && handle.edgeLods.length > 0) return null;
    if (!viewer.pendingEdgeLodBuilds) {
        viewer.pendingEdgeLodBuilds = new Map();
    }
    if (viewer.pendingEdgeLodBuilds.has(handle.key)) {
        return viewer.pendingEdgeLodBuilds.get(handle.key);
    }
    const task = (async () => {
        await viewer.afterNextPaint();
        if (!viewer.gl) return null;
        const edgeLods = buildEdgeLods(viewer, handle);
        if (viewer.currentMeshHandle === handle || viewer.currentMeshHandle?.parts?.includes(handle)) {
            viewer.startRenderLoop();
        }
        return edgeLods;
    })().finally(() => {
        viewer.pendingEdgeLodBuilds.delete(handle.key);
    });
    viewer.pendingEdgeLodBuilds.set(handle.key, task);
    return task;
}

export function ensureLineRenderResources(viewer, handle) {
    if (!handle) return;
    if (typeof viewer.ensureLineRenderBuffers === 'function') {
        viewer.ensureLineRenderBuffers(handle);
    }
    const hasNativeLineLods = Array.isArray(handle.lineLods) && handle.lineLods.some((lod) => lod && lod.indexCount > 0);
    const hasEdgeLods = Array.isArray(handle.edgeLods) && handle.edgeLods.some((lod) => lod && lod.indexCount > 0);
    if (!hasNativeLineLods && !hasEdgeLods && Array.isArray(handle.triIndices) && handle.triIndices.length > 0) {
        const isCurrentHandle = viewer.currentMeshHandle === handle || viewer.currentMeshHandle?.parts?.includes?.(handle);
        if (isCurrentHandle && viewer.gl) {
            buildEdgeLods(viewer, handle);
        } else {
            scheduleEdgeLodBuild(viewer, handle);
        }
    }
}

export function getRenderableLineLod(viewer, handle, lineLodIndex) {
    let lineLod = handle.lineLods[Math.min(lineLodIndex, handle.lineLods.length - 1)];
    if ((!lineLod || lineLod.indexCount === 0) && Array.isArray(handle.edgeLods) && handle.edgeLods.length > 0) {
        lineLod = handle.edgeLods[Math.min(lineLodIndex, handle.edgeLods.length - 1)];
    }
    return lineLod;
}
