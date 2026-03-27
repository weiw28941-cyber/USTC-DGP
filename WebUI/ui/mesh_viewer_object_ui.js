import {
    applyObjectColorMode,
    toggleObjectDisplayFlag
} from './mesh_viewer_display_state.js';

export function updateModeButtons(viewer) {
    if (!viewer.panel) return;
    const activeHandle = viewer.getHandleByKey(viewer.activeColorbarTarget);
    const allowed = activeHandle ? viewer.getAllowedColorModes(activeHandle) : ['lit', 'colormap', 'texture'];
    const activeMode = activeHandle ? viewer.getHandleColorMode(activeHandle) : 'lit';
    viewer.panel.querySelectorAll('[data-color]').forEach((btn) => {
        const mode = btn.dataset.color || 'lit';
        btn.classList.toggle('active', mode === activeMode);
        btn.disabled = !allowed.includes(mode);
    });
    const showColorbar = activeMode === 'colormap';
    if (viewer.colorbar) {
        viewer.colorbar.setVisible(showColorbar);
    }
    if (viewer.objectSelect) {
        viewer.objectSelect.style.display = showColorbar ? 'block' : 'none';
    }
    if (viewer.colorbarSaveBtn) {
        viewer.colorbarSaveBtn.style.display = showColorbar ? 'inline-block' : 'none';
    }
    if (viewer.colorbarLoadBtn) {
        viewer.colorbarLoadBtn.style.display = showColorbar ? 'inline-block' : 'none';
    }
}

export function syncColorbarEditorToActiveTarget(viewer) {
    if (!viewer.colorbar) return;
    const stops = viewer.objectColorbars.get(viewer.activeColorbarTarget) || viewer.getDefaultColorbarStops();
    viewer.ignoreColorbarChange = true;
    viewer.colorbar.setStops(stops);
    viewer.ignoreColorbarChange = false;
}

export function refreshObjectFilterCounts(viewer) {
    if (!viewer.panel || !viewer.currentMeshHandle) return;
    const handles = viewer.currentMeshHandle.parts || [viewer.currentMeshHandle];
    let meshCount = 0;
    let lineCount = 0;
    let pointCount = 0;
    for (const handle of handles) {
        const type = viewer.getHandleObjectType(handle);
        if (type === 'mesh') meshCount += 1;
        else if (type === 'lines') lineCount += 1;
        else if (type === 'points') pointCount += 1;
    }
    const allCount = handles.length;
    viewer.panel.querySelectorAll('[data-object-filter]').forEach((btn) => {
        const filter = btn.dataset.objectFilter || 'all';
        if (filter === 'all') btn.textContent = `All(${allCount})`;
        else if (filter === 'mesh') btn.textContent = `Mesh(${meshCount})`;
        else if (filter === 'lines') btn.textContent = `Lines(${lineCount})`;
        else if (filter === 'points') btn.textContent = `Points(${pointCount})`;
    });
}

export function isHandleVisibleByFilter(viewer, handle) {
    const filter = viewer.objectTypeFilter || 'all';
    if (filter === 'all') return true;
    return viewer.getHandleObjectType(handle) === filter;
}

export function applyObjectBulkVisibility(viewer, visible) {
    if (!viewer.currentMeshHandle) return;
    const handles = viewer.currentMeshHandle.parts || [viewer.currentMeshHandle];
    for (const handle of handles) {
        if (!isHandleVisibleByFilter(viewer, handle)) continue;
        viewer.objectVisibility.set(handle.key, !!visible);
    }
    viewer.emitInteraction('viewer_object_visibility_batch', {
        filter: viewer.objectTypeFilter || 'all',
        visible: !!visible
    });
    refreshObjectListUI(viewer);
    viewer.startRenderLoop();
}

export function refreshObjectListUI(viewer) {
    if (!viewer.objectListContainer || !viewer.currentMeshHandle) return;
    const handles = viewer.currentMeshHandle.parts || [viewer.currentMeshHandle];
    viewer.objectListContainer.innerHTML = '';
    for (const handle of handles) {
        if (!isHandleVisibleByFilter(viewer, handle)) {
            continue;
        }
        const row = document.createElement('div');
        row.className = 'mesh-viewer-object-row';

        const visibleToggle = document.createElement('input');
        visibleToggle.type = 'checkbox';
        visibleToggle.checked = viewer.objectVisibility.get(handle.key) !== false;
        visibleToggle.title = 'Visible';
        visibleToggle.addEventListener('change', () => {
            viewer.objectVisibility.set(handle.key, !!visibleToggle.checked);
            viewer.emitInteraction('viewer_object_visibility', {
                target: handle.key,
                visible: !!visibleToggle.checked
            });
            viewer.startRenderLoop();
        });

        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'mesh-viewer-object-label';
        const type = viewer.getHandleObjectType(handle);
        label.textContent = `[${type}] ${handle.label || handle.key}`;
        label.addEventListener('click', () => {
            viewer.activeColorbarTarget = handle.key;
            if (viewer.objectSelect) {
                viewer.objectSelect.value = handle.key;
            }
            syncColorbarEditorToActiveTarget(viewer);
            updateModeButtons(viewer);
            viewer.startRenderLoop();
        });

        const displayFlags = viewer.getObjectDisplayFlags(handle);
        const allowedDisplayFlags = viewer.getAllowedDisplayFlags(handle);
        const displayGroup = document.createElement('div');
        displayGroup.className = 'mesh-viewer-object-display-group';
        const makeFlagBtn = (flag, icon, tooltip) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mesh-viewer-mode-btn mesh-viewer-object-flag-btn mesh-viewer-shape-btn';
            btn.dataset.shape = icon === 'P' ? 'point' : (icon === 'L' ? 'line' : 'triangle');
            btn.setAttribute('aria-label', tooltip);
            btn.title = tooltip;
            btn.disabled = !allowedDisplayFlags[flag];
            const sync = () => btn.classList.toggle('active', !!displayFlags[flag]);
            sync();
            btn.addEventListener('click', async () => {
                const wasEnabled = !!displayFlags[flag];
                await toggleObjectDisplayFlag(viewer, handle, displayFlags, flag);
                if (wasEnabled !== !!displayFlags[flag]) {
                    sync();
                }
            });
            return btn;
        };
        displayGroup.appendChild(makeFlagBtn('points', 'P', 'Points'));
        displayGroup.appendChild(makeFlagBtn('lines', 'L', 'Lines'));
        displayGroup.appendChild(makeFlagBtn('faces', 'F', 'Faces'));

        const allowedColorModes = viewer.getAllowedColorModes(handle);
        const colorMode = viewer.getHandleColorMode(handle);
        const colorGroup = document.createElement('div');
        colorGroup.className = 'mesh-viewer-object-display-group mesh-viewer-object-color-group';
        const makeColorBtn = (mode, text, tooltip) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mesh-viewer-mode-btn mesh-viewer-object-flag-btn mesh-viewer-object-color-btn';
            btn.dataset.colorIcon = mode;
            btn.setAttribute('aria-label', text);
            btn.title = tooltip;
            btn.disabled = !allowedColorModes.includes(mode);
            btn.classList.toggle('active', colorMode === mode);
            btn.addEventListener('click', () => applyObjectColorMode(viewer, handle, mode));
            return btn;
        };
        colorGroup.appendChild(makeColorBtn('lit', 'Lit', 'Lit shading'));
        colorGroup.appendChild(makeColorBtn('colormap', 'Map', 'Colormap'));
        colorGroup.appendChild(makeColorBtn('texture', 'Tex', 'Texture'));

        const textureInput = document.createElement('input');
        textureInput.type = 'text';
        textureInput.className = 'mesh-viewer-object-texture';
        textureInput.placeholder = 'Texture path / builtin://checkerboard';
        textureInput.value = viewer.objectTextureOverrides.get(handle.key) || handle.texturePath || '';
        textureInput.disabled = !allowedColorModes.includes('texture');
        textureInput.addEventListener('change', () => {
            if (!allowedColorModes.includes('texture')) return;
            const raw = String(textureInput.value || '').trim();
            const nextPath = raw || 'builtin://checkerboard';
            viewer.objectTextureOverrides.set(handle.key, nextPath);
            viewer.startRenderLoop();
        });

        row.appendChild(visibleToggle);
        row.appendChild(label);
        row.appendChild(displayGroup);
        row.appendChild(colorGroup);
        row.appendChild(textureInput);
        viewer.objectListContainer.appendChild(row);
    }
    if (!viewer.objectListContainer.firstChild) {
        const empty = document.createElement('div');
        empty.className = 'mesh-viewer-object-empty';
        empty.textContent = 'No objects for current type filter.';
        viewer.objectListContainer.appendChild(empty);
    }
}

export function updateColorbarTargets(viewer) {
    if (!viewer.objectSelect || !viewer.currentMeshHandle) return;
    const scope = `${viewer.currentMeshHandle.key || 'mesh'}@${String(viewer.currentMeshHandle.version || 0)}`;
    if (scope !== viewer.textureOverrideScope) {
        viewer.objectTextureOverrides.clear();
        viewer.objectDisplayModes.clear();
        viewer.objectColorModes.clear();
        viewer.textureOverrideScope = scope;
    }
    const handles = viewer.currentMeshHandle.parts || [viewer.currentMeshHandle];
    const options = [];
    for (const handle of handles) {
        options.push({ value: handle.key, label: handle.label || handle.key });
        if (!viewer.objectColorbars.has(handle.key)) {
            viewer.objectColorbars.set(handle.key, viewer.getDefaultColorbarStops());
        }
        if (!viewer.objectVisibility.has(handle.key)) {
            viewer.objectVisibility.set(handle.key, true);
        }
        if (!viewer.objectTextureOverrides.has(handle.key)) {
            viewer.objectTextureOverrides.set(handle.key, handle.texturePath || 'builtin://checkerboard');
        }
        if (!viewer.objectColorModes.has(handle.key)) {
            const allowed = viewer.getAllowedColorModes(handle);
            viewer.objectColorModes.set(handle.key, allowed.includes('lit') ? 'lit' : allowed[0]);
        }
        if (!viewer.objectDisplayModes.has(handle.key)) {
            viewer.objectDisplayModes.set(handle.key, viewer.getDefaultDisplayFlagsForHandle(handle));
        }
    }
    viewer.objectSelect.innerHTML = '';
    for (const opt of options) {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.label;
        viewer.objectSelect.appendChild(el);
    }
    if (!viewer.activeColorbarTarget || !options.some((opt) => opt.value === viewer.activeColorbarTarget)) {
        viewer.activeColorbarTarget = options.length > 0 ? options[0].value : '';
    }
    viewer.objectSelect.value = viewer.activeColorbarTarget;
    syncColorbarEditorToActiveTarget(viewer);
    updateModeButtons(viewer);
    refreshObjectFilterCounts(viewer);
    refreshObjectListUI(viewer);
}
