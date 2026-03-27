export function onPanelDragStart(viewer, e) {
    if (!viewer.panel || !e || e.button !== 0) return;
    const target = e.target;
    if (target && target.closest &&
        target.closest('button, input, select, textarea, .mesh-viewer-resize-handle')) {
        return;
    }
    const rect = viewer.panel.getBoundingClientRect();
    viewer.panelDragging = true;
    viewer.panelDragOffsetX = e.clientX - rect.left;
    viewer.panelDragOffsetY = e.clientY - rect.top;
    bindPanelMoveHandlers(viewer);
    e.preventDefault();
    e.stopPropagation();
}

export function onPanelResizeStart(viewer, e) {
    if (!viewer.panel || !e || e.button !== 0) return;
    const rect = viewer.panel.getBoundingClientRect();
    viewer.panelResizing = true;
    viewer.panelStartWidth = rect.width;
    viewer.panelStartHeight = rect.height;
    viewer.panelStartX = e.clientX;
    viewer.panelStartY = e.clientY;
    bindPanelMoveHandlers(viewer);
    e.preventDefault();
    e.stopPropagation();
}

export function bindPanelMoveHandlers(viewer) {
    if (viewer.panelMoveHandler || viewer.panelUpHandler) return;
    viewer.panelMoveHandler = (ev) => onPanelMove(viewer, ev);
    viewer.panelUpHandler = () => onPanelUp(viewer);
    window.addEventListener('mousemove', viewer.panelMoveHandler);
    window.addEventListener('mouseup', viewer.panelUpHandler);
}

export function onPanelMove(viewer, e) {
    if (!viewer.panel) return;
    if (viewer.panelDragging) {
        const vw = window.innerWidth || document.documentElement.clientWidth || 1920;
        const vh = window.innerHeight || document.documentElement.clientHeight || 1080;
        const rect = viewer.panel.getBoundingClientRect();
        let left = e.clientX - viewer.panelDragOffsetX;
        let top = e.clientY - viewer.panelDragOffsetY;
        left = Math.max(8, Math.min(vw - rect.width - 8, left));
        top = Math.max(8, Math.min(vh - rect.height - 8, top));
        viewer.panel.style.left = `${left}px`;
        viewer.panel.style.top = `${top}px`;
        viewer.panel.style.right = 'auto';
        return;
    }
    if (viewer.panelResizing) {
        const minW = 520;
        const minH = 360;
        const maxW = Math.max(minW, (window.innerWidth || 1920) - 16);
        const maxH = Math.max(minH, (window.innerHeight || 1080) - 16);
        const nextW = viewer.panelStartWidth + (e.clientX - viewer.panelStartX);
        const nextH = viewer.panelStartHeight + (e.clientY - viewer.panelStartY);
        const width = Math.max(minW, Math.min(maxW, nextW));
        const height = Math.max(minH, Math.min(maxH, nextH));
        viewer.panel.style.width = `${Math.round(width)}px`;
        viewer.panel.style.height = `${Math.round(height)}px`;
        viewer.startRenderLoop();
    }
}

export function onPanelUp(viewer) {
    const wasResizing = viewer.panelResizing;
    viewer.panelDragging = false;
    viewer.panelResizing = false;
    if (viewer.panelMoveHandler) {
        window.removeEventListener('mousemove', viewer.panelMoveHandler);
        viewer.panelMoveHandler = null;
    }
    if (viewer.panelUpHandler) {
        window.removeEventListener('mouseup', viewer.panelUpHandler);
        viewer.panelUpHandler = null;
    }
    if (wasResizing) {
        viewer.startRenderLoop();
    }
}
