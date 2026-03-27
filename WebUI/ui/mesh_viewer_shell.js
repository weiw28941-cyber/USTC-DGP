import { ColorbarEditor } from './colorbar.js';
import { getPrimaryHandleIndexCount } from './mesh_viewer_runtime.js';

function buildPanelMarkup() {
    return `
        <div class="mesh-viewer-header">
            <span class="mesh-viewer-title-text">Mesh Viewer</span>
            <div class="mesh-viewer-edit-inline">
                <button class="mesh-viewer-mode-btn mesh-edit-toggle" type="button">Edit</button>
                <div class="mesh-viewer-selection-mode-group" style="display:none;">
                    <button class="mesh-viewer-mode-btn mesh-selection-mode mesh-viewer-shape-btn active" type="button" data-mode="vertex" data-shape="point" aria-label="Select vertices" title="Select vertices"></button>
                    <button class="mesh-viewer-mode-btn mesh-selection-mode mesh-viewer-shape-btn" type="button" data-mode="edge" data-shape="line" aria-label="Select edges" title="Select edges"></button>
                    <button class="mesh-viewer-mode-btn mesh-selection-mode mesh-viewer-shape-btn" type="button" data-mode="face" data-shape="triangle" aria-label="Select faces" title="Select faces"></button>
                </div>
                <span class="mesh-edit-selection-count">0 selected</span>
                <button class="mesh-viewer-mode-btn mesh-edit-clear" type="button" disabled>Clear</button>
                <button class="mesh-viewer-mode-btn mesh-edit-begin" type="button" disabled>Begin</button>
                <button class="mesh-viewer-mode-btn mesh-edit-update" type="button" disabled>Update</button>
                <button class="mesh-viewer-mode-btn mesh-edit-commit" type="button" disabled>Commit</button>
                <button class="mesh-viewer-mode-btn mesh-edit-cancel" type="button" disabled>Cancel</button>
            </div>
            <button class="mesh-viewer-close" type="button" aria-label="Close"></button>
        </div>
        <canvas class="mesh-viewer-canvas" width="960" height="640"></canvas>
        <div class="mesh-viewer-colorbar-slot"></div>
        <div class="mesh-viewer-object-tools">
            <div class="mesh-viewer-object-filter-group">
                <button class="mesh-viewer-mode-btn active" type="button" data-object-filter="all">All</button>
                <button class="mesh-viewer-mode-btn" type="button" data-object-filter="points">Points</button>
                <button class="mesh-viewer-mode-btn" type="button" data-object-filter="lines">Lines</button>
                <button class="mesh-viewer-mode-btn" type="button" data-object-filter="mesh">Mesh</button>
            </div>
            <div class="mesh-viewer-object-bulk-group">
                <button class="mesh-viewer-mode-btn" type="button" data-object-bulk="show">Show</button>
                <button class="mesh-viewer-mode-btn" type="button" data-object-bulk="hide">Hide</button>
            </div>
        </div>
        <div class="mesh-viewer-object-list"></div>
        <div class="mesh-viewer-edit-details" style="display:none;">
            <div class="mesh-edit-vertex-list"></div>
        </div>
        <div class="mesh-viewer-warning" style="display:none;"></div>
        <div class="mesh-viewer-meta">
            <div class="mesh-viewer-meta-row">
                <span class="mesh-viewer-meta-summary"></span>
                <button class="mesh-viewer-meta-debug-toggle" type="button" hidden>Show Debug</button>
            </div>
            <div class="mesh-viewer-meta-debug" hidden>
                <pre class="mesh-viewer-meta-debug-content"></pre>
            </div>
        </div>
        <div class="mesh-viewer-resize-handle" title="Resize"></div>
    `;
}

function attachStaticPanelHandlers(viewer) {
    viewer.canvas = viewer.panel.querySelector('.mesh-viewer-canvas');
    viewer.panel.querySelector('.mesh-viewer-close').addEventListener('click', () => viewer.hide());
    const header = viewer.panel.querySelector('.mesh-viewer-header');
    if (header) {
        header.addEventListener('mousedown', (e) => viewer.onPanelDragStart(e));
    }
    const resizeHandle = viewer.panel.querySelector('.mesh-viewer-resize-handle');
    if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', (e) => viewer.onPanelResizeStart(e));
    }
    const debugToggle = viewer.panel.querySelector('.mesh-viewer-meta-debug-toggle');
    if (debugToggle) {
        debugToggle.addEventListener('click', () => {
            viewer.metaDebugOpen = !viewer.metaDebugOpen;
            if (viewer.currentPayload) {
                const indexCount = getPrimaryHandleIndexCount(viewer.currentMeshHandle);
                viewer.updateMeta(viewer.currentPayload, indexCount);
            } else {
                const debugPanel = viewer.panel.querySelector('.mesh-viewer-meta-debug');
                if (debugPanel) {
                    debugPanel.hidden = !viewer.metaDebugOpen;
                }
                debugToggle.textContent = viewer.metaDebugOpen ? 'Hide Debug' : 'Show Debug';
            }
        });
    }
    viewer.panel.querySelectorAll('[data-object-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
            viewer.objectTypeFilter = btn.dataset.objectFilter || 'all';
            viewer.panel.querySelectorAll('[data-object-filter]').forEach((b) => {
                b.classList.toggle('active', b === btn);
            });
            viewer.refreshObjectListUI();
        });
    });
    viewer.panel.querySelectorAll('[data-object-bulk]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const bulk = btn.dataset.objectBulk;
            viewer.applyObjectBulkVisibility(bulk === 'show');
        });
    });
}

function attachColorbarControls(viewer) {
    const colorbarSlot = viewer.panel.querySelector('.mesh-viewer-colorbar-slot');
    viewer.objectListContainer = viewer.panel.querySelector('.mesh-viewer-object-list');

    const objectSelect = document.createElement('select');
    objectSelect.className = 'mesh-viewer-object-select';
    objectSelect.addEventListener('change', () => {
        viewer.activeColorbarTarget = objectSelect.value || '';
        viewer.syncColorbarEditorToActiveTarget();
        viewer.updateModeButtons();
        viewer.startRenderLoop();
        viewer.emitInteraction('viewer_active_colorbar_target', viewer.activeColorbarTarget);
    });
    colorbarSlot.appendChild(objectSelect);
    viewer.objectSelect = objectSelect;

    const ioRow = document.createElement('div');
    ioRow.className = 'mesh-viewer-colorbar-io';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'mesh-viewer-mode-btn';
    saveBtn.textContent = 'Save Colorbar';
    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'mesh-viewer-mode-btn';
    loadBtn.textContent = 'Load Colorbar';
    const loadInput = document.createElement('input');
    loadInput.type = 'file';
    loadInput.accept = '.json,application/json';
    loadInput.style.display = 'none';
    ioRow.appendChild(saveBtn);
    ioRow.appendChild(loadBtn);
    ioRow.appendChild(loadInput);
    colorbarSlot.appendChild(ioRow);
    viewer.colorbarSaveBtn = saveBtn;
    viewer.colorbarLoadBtn = loadBtn;
    viewer.colorbarLoadInput = loadInput;

    viewer.colorbar = new ColorbarEditor({
        onChange: () => {
            if (viewer.ignoreColorbarChange) return;
            if (viewer.activeColorbarTarget) {
                const stops = viewer.colorbar.getStops();
                viewer.objectColorbars.set(viewer.activeColorbarTarget, stops);
                viewer.emitInteraction('viewer_colorbar_stops', {
                    target: viewer.activeColorbarTarget,
                    stops
                });
            }
            viewer.updateColorbarTexture();
            viewer.startRenderLoop();
        }
    });
    colorbarSlot.appendChild(viewer.colorbar.getElement());
    viewer.colorbar.setVisible(false);
    saveBtn.addEventListener('click', () => viewer.saveActiveColorbar());
    loadBtn.addEventListener('click', () => loadInput.click());
    loadInput.addEventListener('change', (e) => viewer.loadActiveColorbar(e));
}

export function ensurePanel(viewer) {
    if (viewer.panel) return;

    viewer.panel = document.createElement('div');
    viewer.panel.className = 'mesh-viewer-panel';
    viewer.panel.innerHTML = buildPanelMarkup();
    document.body.appendChild(viewer.panel);

    attachStaticPanelHandlers(viewer);
    viewer.initMouseControls();
    attachColorbarControls(viewer);
    viewer.initMeshEditControls();

    viewer.gl = viewer.canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: false });
    if (!viewer.gl) {
        const summary = viewer.panel.querySelector('.mesh-viewer-meta-summary');
        if (summary) {
            summary.textContent = 'WebGL2 unavailable';
        }
        return;
    }
    viewer.initProgram();
    viewer.updateColorbarTexture();
    viewer.updateModeButtons();
}
