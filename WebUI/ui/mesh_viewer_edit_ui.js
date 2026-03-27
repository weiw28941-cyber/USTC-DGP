import { setMetaSummaryMessage } from './mesh_viewer_runtime.js';

function buildSelectionDescriptor(viewer) {
    if (viewer.selectionMode === 'vertex') {
        const handles = [];
        for (const vid of viewer.selectedVertices) {
            const pos = viewer.vertexPositions.get(vid);
            if (pos) {
                handles.push({ id: vid, position: [...pos] });
            }
        }
        return {
            count: viewer.selectedVertices.size,
            countLabel: `${viewer.selectedVertices.size} vertex(es)`,
            action: 'mesh_edit_handles',
            value: { handles },
            description: `${handles.length} vertex(es) edited`,
            hasDetails: viewer.selectedVertices.size > 0,
            renderDetailRows(target) {
                const sortedVids = Array.from(viewer.selectedVertices).sort((a, b) => a - b);
                for (const vid of sortedVids) {
                    const pos = viewer.vertexPositions.get(vid) || [0, 0, 0];
                    const row = document.createElement('div');
                    row.className = 'mesh-edit-vertex-row';
                    row.innerHTML = `
                        <span class="mesh-edit-vertex-id">V${vid}:</span>
                        <input type="number" step="0.01" value="${pos[0].toFixed(3)}" data-vid="${vid}" data-axis="0" />
                        <input type="number" step="0.01" value="${pos[1].toFixed(3)}" data-vid="${vid}" data-axis="1" />
                        <input type="number" step="0.01" value="${pos[2].toFixed(3)}" data-vid="${vid}" data-axis="2" />
                    `;
                    target.appendChild(row);
                    row.querySelectorAll('input').forEach((input) => {
                        input.addEventListener('change', (e) => {
                            const field = e.target;
                            const editVid = parseInt(field.dataset.vid);
                            const axis = parseInt(field.dataset.axis);
                            const value = parseFloat(field.value) || 0;
                            const nextPos = viewer.vertexPositions.get(editVid);
                            if (nextPos) {
                                nextPos[axis] = value;
                            }
                        });
                    });
                }
            }
        };
    }

    if (viewer.selectionMode === 'edge') {
        const edges = Array.from(viewer.selectedEdges).map((edgeStr) => {
            const [v1, v2] = edgeStr.split('-').map(Number);
            return { v1, v2 };
        });
        return {
            count: viewer.selectedEdges.size,
            countLabel: `${viewer.selectedEdges.size} edge(s)`,
            action: 'mesh_edit_edges',
            value: { edges },
            description: `${edges.length} edge(s) selected`,
            hasDetails: false,
            renderDetailRows() {}
        };
    }

    if (viewer.selectionMode === 'face') {
        const faces = Array.from(viewer.selectedFaces).map((faceId) => {
            const face = viewer.faceList[faceId];
            return face ? { v1: face[0], v2: face[1], v3: face[2] } : null;
        }).filter((face) => face !== null);
        return {
            count: viewer.selectedFaces.size,
            countLabel: `${viewer.selectedFaces.size} face(s)`,
            action: 'mesh_edit_faces',
            value: { faces },
            description: `${faces.length} face(s) selected`,
            hasDetails: false,
            renderDetailRows() {}
        };
    }

    return {
        count: 0,
        countLabel: '0 selected',
        action: null,
        value: null,
        description: '',
        hasDetails: false,
        renderDetailRows() {}
    };
}

export function clearAllSelections(viewer, silent = false) {
    viewer.selectedVertices.clear();
    viewer.selectedEdges.clear();
    viewer.selectedFaces.clear();
    if (!silent) {
        emitSelectionInteraction(viewer);
    }
}

export function getSelectionData(viewer) {
    const descriptor = buildSelectionDescriptor(viewer);
    if (!descriptor.action || descriptor.count <= 0) {
        return null;
    }
    return {
        action: descriptor.action,
        value: descriptor.value,
        description: descriptor.description
    };
}

export function updateEditUI(viewer) {
    if (!viewer.panel) return;
    const clearBtn = viewer.panel.querySelector('.mesh-edit-clear');
    const selectionCount = viewer.panel.querySelector('.mesh-edit-selection-count');
    const beginBtn = viewer.panel.querySelector('.mesh-edit-begin');
    const updateBtn = viewer.panel.querySelector('.mesh-edit-update');
    const commitBtn = viewer.panel.querySelector('.mesh-edit-commit');
    const cancelBtn = viewer.panel.querySelector('.mesh-edit-cancel');
    const detailsPanel = viewer.panel.querySelector('.mesh-viewer-edit-details');
    const vertexList = viewer.panel.querySelector('.mesh-edit-vertex-list');

    const descriptor = buildSelectionDescriptor(viewer);
    const count = descriptor.count;
    const countLabel = descriptor.countLabel;

    const hasSelection = count > 0;
    if (selectionCount) {
        selectionCount.textContent = `${countLabel} selected`;
    }
    if (clearBtn) clearBtn.disabled = !hasSelection;
    if (beginBtn) beginBtn.disabled = !hasSelection;
    if (updateBtn) updateBtn.disabled = !hasSelection;
    if (commitBtn) commitBtn.disabled = !hasSelection;
    if (cancelBtn) cancelBtn.disabled = !hasSelection;

    if (!vertexList || !detailsPanel) return;
    if (!(hasSelection && descriptor.hasDetails)) {
        detailsPanel.style.display = 'none';
        return;
    }

    detailsPanel.style.display = 'block';
    vertexList.innerHTML = '';
    descriptor.renderDetailRows(vertexList);
}

export function emitSelectionInteraction(viewer) {
    const descriptor = buildSelectionDescriptor(viewer);
    if (descriptor.action && descriptor.value) {
        viewer.emitInteraction(descriptor.action, descriptor.value, { channel: 'selection', phase: 'update' });
    }
}

export function initMeshEditControls(viewer) {
    if (!viewer.panel) return;
    const toggleBtn = viewer.panel.querySelector('.mesh-edit-toggle');
    const selectionModeGroup = viewer.panel.querySelector('.mesh-viewer-selection-mode-group');
    const selectionModeBtns = viewer.panel.querySelectorAll('.mesh-selection-mode');
    const clearBtn = viewer.panel.querySelector('.mesh-edit-clear');
    const selectionCount = viewer.panel.querySelector('.mesh-edit-selection-count');
    const beginBtn = viewer.panel.querySelector('.mesh-edit-begin');
    const updateBtn = viewer.panel.querySelector('.mesh-edit-update');
    const commitBtn = viewer.panel.querySelector('.mesh-edit-commit');
    const cancelBtn = viewer.panel.querySelector('.mesh-edit-cancel');
    const detailsPanel = viewer.panel.querySelector('.mesh-viewer-edit-details');
    const vertexList = viewer.panel.querySelector('.mesh-edit-vertex-list');
    if (!toggleBtn || !selectionModeGroup || !clearBtn || !selectionCount || !beginBtn ||
        !updateBtn || !commitBtn || !cancelBtn || !detailsPanel || !vertexList) {
        return;
    }

    toggleBtn.addEventListener('click', () => {
        viewer.editMode = !viewer.editMode;
        toggleBtn.textContent = viewer.editMode ? 'Edit On' : 'Edit';
        toggleBtn.classList.toggle('active', viewer.editMode);
        selectionModeGroup.style.display = viewer.editMode ? 'flex' : 'none';
        if (!viewer.editMode) {
            clearAllSelections(viewer);
            updateEditUI(viewer);
        }
        if (viewer.editMode) {
            viewer.ensureInteractionGeometryReady(viewer.currentMeshHandle);
            const crosshairSvg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><line x1='12' y1='0' x2='12' y2='24' stroke='black' stroke-width='1'/><line x1='0' y1='12' x2='24' y2='12' stroke='black' stroke-width='1'/></svg>`;
            viewer.canvas.style.cursor = `url("${crosshairSvg}") 12 12, crosshair`;
        } else {
            viewer.canvas.style.cursor = 'default';
        }
    });

    selectionModeBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (mode && ['vertex', 'edge', 'face'].includes(mode)) {
                viewer.selectionMode = mode;
                selectionModeBtns.forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
            }
        });
    });

    clearBtn.addEventListener('click', () => {
        clearAllSelections(viewer);
        updateEditUI(viewer);
        viewer.startRenderLoop();
    });

    const sendEdit = (phase) => {
        const selectionData = getSelectionData(viewer);
        if (!selectionData) return;
        viewer.meshEditVersion += 1;
        viewer.emitInteraction(selectionData.action, selectionData.value, {
            channel: 'mesh_edit',
            phase,
            version: viewer.meshEditVersion
        });
        setMetaSummaryMessage(viewer, `mesh_edit ${phase} | ${selectionData.description}`);
        if (phase === 'begin') {
            viewer.originalVertexPositions.clear();
            for (const vid of viewer.selectedVertices) {
                const pos = viewer.vertexPositions.get(vid);
                if (pos) {
                    viewer.originalVertexPositions.set(vid, [...pos]);
                }
            }
        } else if (phase === 'commit') {
            viewer.originalVertexPositions.clear();
            clearAllSelections(viewer, true);
            updateEditUI(viewer);
        } else if (phase === 'cancel') {
            for (const [vid, pos] of viewer.originalVertexPositions) {
                viewer.vertexPositions.set(vid, [...pos]);
            }
            viewer.originalVertexPositions.clear();
            clearAllSelections(viewer, true);
            updateEditUI(viewer);
        }
    };

    beginBtn.addEventListener('click', () => sendEdit('begin'));
    updateBtn.addEventListener('click', () => sendEdit('update'));
    commitBtn.addEventListener('click', () => sendEdit('commit'));
    cancelBtn.addEventListener('click', () => sendEdit('cancel'));
}
