export function getPrimaryRuntimeHandle(viewer) {
    return viewer.currentMeshHandle?.parts?.[0] || viewer.currentMeshHandle || null;
}

export function getPrimaryHandleIndexCount(handle) {
    if (!handle) return 0;
    return handle.parts
        ? handle.parts.reduce((sum, part) => sum + (part.lods?.[0]?.indexCount || 0), 0)
        : (handle.lods?.[0]?.indexCount || 0);
}

function collectMetaStats(viewer, payload, indexCount) {
    const vCount = Number.isFinite(payload.vertexCount) ? payload.vertexCount : (payload.vertices?.length || 0);
    const tCount = Number.isFinite(payload.triangleCount) ? payload.triangleCount : (payload.triangles?.length || 0);
    const lCount = Number.isFinite(payload.lineCount) ? payload.lineCount : 0;
    const pCount = Number.isFinite(payload.pointCount) ? payload.pointCount : 0;
    return { vCount, tCount, lCount, pCount, indexCount };
}

export function buildMetaText(viewer, payload, indexCount) {
    const { vCount, tCount, lCount, pCount } = collectMetaStats(viewer, payload, indexCount);
    const prefix = viewer.previewStatusText ? `${viewer.previewStatusText} | ` : '';
    return `${prefix}geomId: ${payload.meshId} | version: ${String(payload.version)} | vertices: ${vCount} | triangles: ${tCount} | lines: ${lCount} | points: ${pCount} | indices: ${indexCount}`;
}

export function buildMetaDebugText(viewer, payload, indexCount) {
    const { vCount, tCount, lCount, pCount } = collectMetaStats(viewer, payload, indexCount);
    const activeHandle = getPrimaryRuntimeHandle(viewer);
    let runtimeInfo = '';
    if (activeHandle) {
        const flags = typeof viewer.getObjectDisplayFlags === 'function'
            ? viewer.getObjectDisplayFlags(activeHandle)
            : { points: false, lines: false, faces: false };
        const visible = viewer.objectVisibility?.get(activeHandle.key) !== false;
        const colorMode = typeof viewer.getHandleColorMode === 'function'
            ? viewer.getHandleColorMode(activeHandle)
            : 'unknown';
        const geomLineCount = Array.isArray(activeHandle.geometry?.lineIndices) ? activeHandle.geometry.lineIndices.length / 2 : 0;
        const geomPointCount = Array.isArray(activeHandle.geometry?.pointIndices) ? activeHandle.geometry.pointIndices.length : 0;
        const lineLodCount = Array.isArray(activeHandle.lineLods) && activeHandle.lineLods[0] ? activeHandle.lineLods[0].indexCount / 2 : 0;
        const pointLodCount = Array.isArray(activeHandle.pointLods) && activeHandle.pointLods[0] ? activeHandle.pointLods[0].indexCount : 0;
        const edgeLodCount = Array.isArray(activeHandle.edgeLods) && activeHandle.edgeLods[0] ? activeHandle.edgeLods[0].indexCount / 2 : 0;
        const drawFaces = Number(viewer.lastDrawStats?.faces || 0);
        const drawLines = Number(viewer.lastDrawStats?.lines || 0);
        const drawPoints = Number(viewer.lastDrawStats?.points || 0);
        const drawFaceIndices = Number(viewer.lastDrawStats?.faceIndices || 0);
        const drawLineIndices = Number(viewer.lastDrawStats?.lineIndices || 0);
        const drawPointIndices = Number(viewer.lastDrawStats?.pointIndices || 0);
        const stage = viewer.lastRenderStage || 'idle';
        const errorText = viewer.lastRenderError ? ` err:${viewer.lastRenderError}` : '';
        runtimeInfo = `vis:${visible ? 1 : 0} mode:${colorMode} | flags P:${flags.points ? 1 : 0} L:${flags.lines ? 1 : 0} F:${flags.faces ? 1 : 0} | geomLines:${geomLineCount} geomPoints:${geomPointCount} | lodLines:${lineLodCount} lodPoints:${pointLodCount} edgeLines:${edgeLodCount} | draw F:${drawFaces}/${drawFaceIndices} L:${drawLines}/${drawLineIndices} P:${drawPoints}/${drawPointIndices} | stage:${stage}${errorText}`;
    }
    return [
        `geomId: ${payload.meshId}`,
        `version: ${String(payload.version)}`,
        `vertices: ${vCount}`,
        `triangles: ${tCount}`,
        `lines: ${lCount}`,
        `points: ${pCount}`,
        `indices: ${indexCount}`,
        runtimeInfo,
        'LMB rotate | RMB/Shift+drag pan | wheel zoom | dblclick reset'
    ].filter(Boolean).join(' | ');
}

export function setMetaSummaryMessage(viewer, text) {
    const summary = viewer.panel?.querySelector('.mesh-viewer-meta-summary');
    if (!summary) return;
    summary.textContent = typeof text === 'string' ? text : '';
}

export function updateMeta(viewer, payload, indexCount) {
    const meta = viewer.panel?.querySelector('.mesh-viewer-meta');
    if (!meta) return;
    const summary = meta.querySelector('.mesh-viewer-meta-summary');
    const detail = meta.querySelector('.mesh-viewer-meta-debug-content');
    const toggle = meta.querySelector('.mesh-viewer-meta-debug-toggle');
    if (summary) {
        summary.textContent = buildMetaText(viewer, payload, indexCount);
    }
    const hasDebug = Boolean(viewer.lastRenderError || viewer.lastRenderStage || viewer.lastDrawStats);
    if (detail) {
        detail.textContent = buildMetaDebugText(viewer, payload, indexCount);
    }
    if (toggle) {
        toggle.hidden = !hasDebug;
        toggle.textContent = viewer.metaDebugOpen ? 'Hide Debug' : (viewer.lastRenderError ? 'Show Error' : 'Show Debug');
        toggle.classList.toggle('has-error', Boolean(viewer.lastRenderError));
    }
    meta.classList.toggle('has-error', Boolean(viewer.lastRenderError));
    const debugPanel = meta.querySelector('.mesh-viewer-meta-debug');
    if (debugPanel) {
        debugPanel.hidden = !viewer.metaDebugOpen;
    }
}

export function startRenderLoop(viewer) {
    if (viewer.animationFrame) return;
    const render = () => {
        viewer.animationFrame = null;
        if (!viewer.panel || viewer.panel.style.display === 'none') {
            return;
        }
        try {
            viewer.lastRenderError = '';
            viewer.renderFrame();
        } catch (error) {
            viewer.lastRenderError = error?.message || String(error);
            console.error('Mesh viewer render loop failed:', error);
            try {
                if (viewer.currentPayload) {
                    const indexCount = getPrimaryHandleIndexCount(viewer.currentMeshHandle);
                    updateMeta(viewer, viewer.currentPayload, indexCount);
                }
            } catch {}
            return;
        }
        viewer.animationFrame = requestAnimationFrame(render);
    };
    viewer.animationFrame = requestAnimationFrame(render);
}
