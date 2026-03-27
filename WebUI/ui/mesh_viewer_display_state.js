export function getHandleObjectType(viewer, handle) {
    if (handle?.objectType === 'points' || handle?.objectType === 'lines' || handle?.objectType === 'mesh') {
        return handle.objectType;
    }
    const triCount = Array.isArray(handle?.triIndices) ? handle.triIndices.length : 0;
    const lineCount = Array.isArray(handle?.geometry?.lineIndices) ? handle.geometry.lineIndices.length : 0;
    const pointCount = Array.isArray(handle?.geometry?.pointIndices) ? handle.geometry.pointIndices.length : 0;
    if (triCount > 0) return 'mesh';
    if (lineCount > 0) return 'lines';
    if (pointCount > 0) return 'points';
    return 'mesh';
}

export function getAllowedColorModes(viewer, handle) {
    const type = getHandleObjectType(viewer, handle);
    if (type === 'points' || type === 'lines') {
        return ['lit', 'colormap'];
    }
    return ['lit', 'colormap', 'texture'];
}

export function getHandleColorMode(viewer, handle) {
    const allowed = getAllowedColorModes(viewer, handle);
    const mode = viewer.objectColorModes.get(handle.key);
    if (typeof mode === 'string' && allowed.includes(mode)) {
        return mode;
    }
    return 'lit';
}

export function setActiveTargetColorMode(viewer, mode) {
    const handle = viewer.getHandleByKey(viewer.activeColorbarTarget);
    if (!handle) return;
    const allowed = getAllowedColorModes(viewer, handle);
    if (!allowed.includes(mode)) return;
    viewer.objectColorModes.set(handle.key, mode);
    viewer.updateModeButtons();
    viewer.emitInteraction('viewer_object_color_mode', {
        target: handle.key,
        mode
    });
    viewer.startRenderLoop();
}

export function getDefaultDisplayFlagsForHandle(viewer, handle) {
    const type = getHandleObjectType(viewer, handle);
    const hasFaces = Array.isArray(handle?.triIndices) && handle.triIndices.length > 0;
    const hasLines = Array.isArray(handle?.geometry?.lineIndices) && handle.geometry.lineIndices.length > 0;
    const hasPoints = Array.isArray(handle?.geometry?.pointIndices) && handle.geometry.pointIndices.length > 0;
    if (type === 'points') {
        return { faces: false, lines: false, points: hasPoints };
    }
    if (type === 'lines') {
        return { faces: false, lines: hasLines, points: hasPoints };
    }
    return {
        faces: hasFaces,
        lines: hasLines || hasFaces,
        points: hasPoints
    };
}

export function getAllowedDisplayFlags(viewer, handle) {
    const type = getHandleObjectType(viewer, handle);
    if (type === 'points') {
        return { points: true, lines: false, faces: false };
    }
    if (type === 'lines') {
        return { points: true, lines: true, faces: false };
    }
    return { points: true, lines: true, faces: true };
}

export function getObjectDisplayFlags(viewer, handle) {
    const fallback = getDefaultDisplayFlagsForHandle(viewer, handle);
    const fromMap = viewer.objectDisplayModes.get(handle.key);
    const allowed = getAllowedDisplayFlags(viewer, handle);
    if (!fromMap || typeof fromMap !== 'object') {
        return {
            faces: fallback.faces && allowed.faces,
            lines: fallback.lines && allowed.lines,
            points: fallback.points && allowed.points
        };
    }
    return {
        faces: ((typeof fromMap.faces === 'boolean') ? fromMap.faces : fallback.faces) && allowed.faces,
        lines: ((typeof fromMap.lines === 'boolean') ? fromMap.lines : fallback.lines) && allowed.lines,
        points: ((typeof fromMap.points === 'boolean') ? fromMap.points : fallback.points) && allowed.points
    };
}

export async function toggleObjectDisplayFlag(viewer, handle, displayFlags, flag) {
    const allowedDisplayFlags = getAllowedDisplayFlags(viewer, handle);
    if (!allowedDisplayFlags[flag]) return;
    displayFlags[flag] = !displayFlags[flag];
    viewer.objectDisplayModes.set(handle.key, { ...displayFlags });
    viewer.emitInteraction('viewer_object_display_flags', {
        target: handle.key,
        points: !!displayFlags.points,
        lines: !!displayFlags.lines,
        faces: !!displayFlags.faces
    });
    if (displayFlags[flag]) {
        await viewer.ensureFieldsForDisplay(handle, displayFlags);
    }
    viewer.startRenderLoop();
}

export function applyObjectColorMode(viewer, handle, mode) {
    const allowedColorModes = getAllowedColorModes(viewer, handle);
    if (!allowedColorModes.includes(mode)) return;
    viewer.objectColorModes.set(handle.key, mode);
    viewer.emitInteraction('viewer_object_color_mode', {
        target: handle.key,
        mode
    });
    if (viewer.activeColorbarTarget === handle.key) {
        viewer.updateModeButtons();
    }
    viewer.refreshObjectListUI();
    viewer.startRenderLoop();
}
