export function chooseLodIndex(viewer) {
    const handle = viewer.currentMeshHandle?.parts?.[0] || viewer.currentMeshHandle;
    const fullTri = (handle?.lods?.[0]?.indexCount || 0) / 3;
    if (fullTri < 20000) return 0;
    if (viewer.cameraDistance > 5.0) return 2;
    if (viewer.cameraDistance > 2.5) return 1;
    return 0;
}

function clampAvailableLodIndex(maxIndex, lodIndex) {
    if (maxIndex < 0) return 0;
    return Math.min(Math.max(0, lodIndex), maxIndex);
}

export function chooseLineLodIndex(viewer, handle, faceLodIndex) {
    const maxIndex = Math.max(
        Array.isArray(handle?.lineLods) ? handle.lineLods.length - 1 : -1,
        Array.isArray(handle?.edgeLods) ? handle.edgeLods.length - 1 : -1
    );
    const baseLodIndex = Number.isFinite(faceLodIndex) ? faceLodIndex : 0;
    return clampAvailableLodIndex(maxIndex, baseLodIndex);
}

export function choosePointLodIndex(viewer, handle, faceLodIndex) {
    const maxIndex = Array.isArray(handle?.pointLods) ? handle.pointLods.length - 1 : -1;
    const baseLodIndex = Number.isFinite(faceLodIndex) ? faceLodIndex : 0;
    return clampAvailableLodIndex(maxIndex, baseLodIndex);
}
