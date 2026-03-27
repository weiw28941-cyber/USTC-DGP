import {
    isGeometryViewerPayload
} from '../core/output_transport.js';
import {
    getAllowedColorModes,
    getAllowedDisplayFlags,
    getDefaultDisplayFlagsForHandle,
    getHandleColorMode,
    getHandleObjectType,
    getObjectDisplayFlags,
    setActiveTargetColorMode,
    toggleObjectDisplayFlag
} from './mesh_viewer_display_state.js';
import {
    bindMesh,
    ensureHandleRenderResources,
    ensureLineRenderBuffers,
    ensurePointRenderResources,
    hydrateHandleForPayload,
    getOrCreateHandleForPayload
} from './mesh_viewer_handles.js';
import {
    ensureColorbarTexture,
    updateColorbarTexture
} from './mesh_viewer_colorbar_gl.js';
import {
    computeVertexNormals,
    createHandleFromGeometry,
    releaseArrowLodBuffers,
    releaseHandleGpuResources,
    releaseIndexedLodBuffers
} from './mesh_viewer_handle_resources.js';
import {
    buildDirectedArrowLod,
    buildLineLodIndices,
    buildLodIndices,
    buildPointLodIndices
} from './mesh_viewer_handle_builders.js';
import {
    rebuildHandleBuffers,
    rebuildPartBuffers,
    updateMeshGeometry
} from './mesh_viewer_geometry_updates.js';
import {
    buildEdgeLods,
    ensureLineRenderResources,
    getRenderableLineLod
} from './mesh_viewer_lines.js';
import {
    chooseLodIndex,
    chooseLineLodIndex,
    choosePointLodIndex
} from './mesh_viewer_lod.js';
import {
    prewarmPayload,
    runDeferredShowPipeline,
    scheduleHandleAuxiliaryBuild,
    scheduleRuntimeWarmup
} from './mesh_viewer_prewarm.js';
import {
    ensureFieldsForDisplay,
    ensureStreamFields,
    fetchStreamPayload,
    getAvailableStreamFields,
    getInitialStreamFields,
    getLoadedStreamFields,
    getPrimaryStreamFields,
    getRequiredFieldsForDisplay,
    mergeStreamPayloadData,
    resolvePayload
} from './mesh_viewer_streaming.js';
import {
    extractGeometry
} from './mesh_viewer_geometry.js';
import {
    bindPanelMoveHandlers,
    onPanelDragStart,
    onPanelMove,
    onPanelResizeStart,
    onPanelUp
} from './mesh_viewer_windowing.js';
import {
    getTexture,
    resolveTextureUrl
} from './mesh_viewer_textures.js';
import {
    computeFrameViewState,
    drawHandle
} from './mesh_viewer_rendering.js';
import {
    getPrimaryHandleIndexCount,
    setMetaSummaryMessage,
    startRenderLoop,
    updateMeta
} from './mesh_viewer_runtime.js';
import {
    ensurePanel
} from './mesh_viewer_shell.js';
import {
    applyPan,
    applyTurntableRotate,
    identity,
    lookAt,
    multiplyMat4,
    perspective,
    projectArcball,
    quatFromAxisAngle,
    quatFromBallPoints,
    quatIdentity,
    quatMul,
    quatNormalize,
    rotateByQuat,
    updateViewQuatFromOrbit
} from './mesh_viewer_math.js';
import {
    initProgram
} from './mesh_viewer_program.js';
import {
    applyObjectBulkVisibility,
    isHandleVisibleByFilter,
    refreshObjectFilterCounts,
    refreshObjectListUI,
    syncColorbarEditorToActiveTarget,
    updateColorbarTargets,
    updateModeButtons
} from './mesh_viewer_object_ui.js';
import {
    buildBVHRecursive,
    buildEdgeBVH,
    buildEdgesAndFacesFromTriangles,
    buildEdgesFromLines,
    buildFaceBVH,
    buildVertexBVH,
    computeBounds,
    dragVertex,
    ensureInteractionGeometryReady,
    getRayFromNDC,
    initVertexPositions,
    isPointOccluded,
    pickEdge,
    pickFace,
    pickVertex,
    pointToRayDistance,
    prepareInteractionGeometry,
    queryEdgeBVH,
    queryFaceBVH,
    queryVertexBVH,
    rayAABBIntersection,
    rayToSegmentDistance,
    rayTriangleIntersection,
    scheduleInteractionGeometryPrep
} from './mesh_viewer_editing.js';
import {
    clearAllSelections,
    emitSelectionInteraction,
    getSelectionData,
    initMeshEditControls,
    updateEditUI
} from './mesh_viewer_edit_ui.js';
import {
    renderSelectedEdges,
    renderSelectedFaces,
    renderSelectedVertices
} from './mesh_viewer_selection_render.js';

class MeshViewerPanel {
    constructor() {
        this.panel = null;
        this.canvas = null;
        this.gl = null;
        this.program = null;
        this.attribs = null;
        this.uniforms = null;
        this.animationFrame = null;
        this.currentPayload = null;
        this.currentMeshHandle = null;
        this.meshCache = new Map();
        this.textureCache = new Map();
        this.colorbarTexture = null;
        this.streamPayloadCache = new Map();
        this.pendingStreamFetches = new Map();
        this.streamChunkCache = new Map();
        this.pendingStreamChunks = new Map();
        this.pendingStreamFieldHydrations = new Map();
        this.cameraDistance = 3.0;
        this.cameraPan = [0, 0, 0];
        this.orbitYaw = 0.0;
        this.orbitPitch = 0.0;
        this.viewQuat = this.quatIdentity();
        this.dragging = false;
        this.dragMode = 'rotate';
        this.arcballStart = null;
        this.arcballStartQuat = null;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.latestShowToken = 0;
        this.colorbar = null;
        this.objectColorbars = new Map();
        this.objectColorModes = new Map();
        this.objectVisibility = new Map();
        this.objectTextureOverrides = new Map();
        this.objectDisplayModes = new Map();
        this.textureOverrideScope = '';
        this.objectTypeFilter = 'all';
        this.activeColorbarTarget = '';
        this.ignoreColorbarChange = false;
        this.currentNodeId = null;
        this.previewStatusText = '';
        this.interactionHandler = null;
        this.meshEditVersion = 0;
        this.cameraEventVersion = 0;
        this.lastCameraEmitAt = 0;
        this.panelDragging = false;
        this.panelResizing = false;
        this.panelDragOffsetX = 0;
        this.panelDragOffsetY = 0;
        this.panelStartWidth = 0;
        this.panelStartHeight = 0;
        this.panelStartX = 0;
        this.panelStartY = 0;
        this.panelMoveHandler = null;
        this.panelUpHandler = null;
        this.pendingShowTask = null;
        this.pendingHandleAuxBuilds = new Map();
        this.pendingEdgeLodBuilds = new Map();
        this.pendingIdlePrewarms = new Map();
        this.pendingGeometryPrep = new Map();
        this.pendingRuntimeWarmup = null;
        this.pendingViewerUiRefresh = null;
        this.metaDebugOpen = false;

        // Vertex editing state
        this.editMode = false;
        this.selectionMode = 'vertex'; // 'vertex', 'edge', 'face'
        this.selectedVertices = new Set(); // Set of vertex IDs
        this.selectedEdges = new Set(); // Set of edge IDs (stored as "v1-v2" strings)
        this.selectedFaces = new Set(); // Set of face IDs (triangle indices)
        this.vertexDragging = false;
        this.draggedVertexId = null;
        this.vertexPositions = new Map(); // Map<vertexId, [x, y, z]>
        this.originalVertexPositions = new Map(); // For cancel operation
        this.edgeList = []; // Array of [v1, v2] pairs
        this.faceList = []; // Array of [v1, v2, v3] triangles
        this.vertexBVH = null; // BVH for vertex selection
        this.edgeBVH = null; // BVH for edge selection
        this.faceBVH = null; // BVH for face selection
        this.objectListContainer = null;
    }

    static MAX_STREAM_CHUNK_CACHE_ENTRIES = 512;

    setInteractionHandler(handler) {
        this.interactionHandler = typeof handler === 'function' ? handler : null;
    }

    emitInteraction(key, value, meta = null) {
        if (!this.interactionHandler) {
            console.warn('[Emit Interaction] No interaction handler set');
            return;
        }
        if (!Number.isFinite(this.currentNodeId)) {
            console.warn('[Emit Interaction] Invalid node ID:', this.currentNodeId);
            return;
        }
        if (!key) {
            console.warn('[Emit Interaction] No key provided');
            return;
        }

        const channel = (meta && typeof meta.channel === 'string' && meta.channel)
            ? meta.channel
            : 'viewer';
        const phase = (meta && typeof meta.phase === 'string' && meta.phase)
            ? meta.phase
            : 'update';
        const version = Number.isFinite(meta?.version) ? meta.version : Date.now();

        this.interactionHandler({
            nodeId: this.currentNodeId,
            key,
            value,
            channel,
            phase,
            version
        });
    }

    show(node, payload) {
        if (!isGeometryViewerPayload(payload)) return;
        this.currentNodeId = Number.isFinite(node?.id) ? node.id : null;
        this.ensurePanel();
        const token = ++this.latestShowToken;
        this.pendingShowTask = token;
        this.panel.style.display = 'flex';
        this.panel.querySelector('.mesh-viewer-title-text').textContent = `${node.config.name} - Mesh Viewer`;
        this.metaDebugOpen = false;
        setMetaSummaryMessage(this, 'Loading mesh data...');
        const cachedKey = this.getMeshKey(payload);
        const cachedHandle = cachedKey ? this.meshCache.get(cachedKey) : null;
        if (cachedHandle && cachedHandle.version === (payload.version || 0)) {
            this.currentPayload = payload;
            this.bindMesh(payload);
            this.startRenderLoop();
            return;
        }

        this.runDeferredShowPipeline(token, payload);
    }

    updateIfVisible(node, payload) {
        if (!this.panel || this.panel.style.display === 'none') return;
        this.show(node, payload);
    }

    hide() {
        if (!this.panel) return;
        this.onPanelUp();
        this.pendingShowTask = null;
        this.panel.style.display = 'none';
        this.currentNodeId = null;
        this.previewStatusText = '';
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    setPreviewStatus(text) {
        this.previewStatusText = typeof text === 'string' ? text : '';
        if (this.currentPayload) {
            const indexCount = this.currentMeshHandle
                ? getPrimaryHandleIndexCount(this.currentMeshHandle)
                : (Number.isFinite(this.currentPayload.triangleCount) ? this.currentPayload.triangleCount * 3 : 0);
            this.updateMeta(this.currentPayload, indexCount);
        }
    }

    afterNextPaint() {
        return new Promise((resolve) => {
            if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
                window.requestAnimationFrame(() => resolve());
                return;
            }
            setTimeout(resolve, 16);
        });
    }

    runWhenIdle(task) {
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => {
                Promise.resolve().then(task).catch(() => {});
            }, { timeout: 250 });
            return;
        }
        setTimeout(() => {
            Promise.resolve().then(task).catch(() => {});
        }, 32);
    }

    scheduleRuntimeWarmup() {
        return scheduleRuntimeWarmup(this);
    }

    async runDeferredShowPipeline(token, payload) {
        return runDeferredShowPipeline(this, token, payload);
    }

    scheduleHandleAuxiliaryBuild(handle) {
        return scheduleHandleAuxiliaryBuild(this, handle);
    }

    getMeshKey(payload) {
        if (!payload) return null;
        if (!payload.meshId || payload.version === undefined) return null;
        return `${payload.meshId}@${String(payload.version)}`;
    }

    prewarmPayload(node, payload) {
        return prewarmPayload(this, node, payload);
    }

    getStreamChunkKey(endpoint, field, offset, limit, expectedDType) {
        return `${endpoint}|${field}|${offset}|${limit}|${expectedDType}`;
    }

    rememberStreamChunk(key, typed) {
        this.streamChunkCache.delete(key);
        this.streamChunkCache.set(key, typed);
        while (this.streamChunkCache.size > MeshViewerPanel.MAX_STREAM_CHUNK_CACHE_ENTRIES) {
            const oldestKey = this.streamChunkCache.keys().next().value;
            if (!oldestKey) break;
            this.streamChunkCache.delete(oldestKey);
        }
    }

    getAvailableStreamFields(payload) {
        return getAvailableStreamFields(this, payload);
    }

    getLoadedStreamFields(data) {
        return getLoadedStreamFields(this, data);
    }

    getPrimaryStreamFields(payload) {
        return getPrimaryStreamFields(this, payload);
    }

    getInitialStreamFields(payload) {
        return getInitialStreamFields(this, payload);
    }

    getRequiredFieldsForDisplay(payload, displayFlags, handle = null) {
        return getRequiredFieldsForDisplay(this, payload, displayFlags, handle);
    }

    mergeStreamPayloadData(existing, incoming) {
        return mergeStreamPayloadData(this, existing, incoming);
    }

    async ensureStreamFields(payload, requiredFields) {
        return ensureStreamFields(this, payload, requiredFields);
    }

    async ensureFieldsForDisplay(handle, displayFlags) {
        return ensureFieldsForDisplay(this, handle, displayFlags);
    }

    async resolvePayload(payload) {
        return resolvePayload(this, payload);
    }

    async fetchStreamPayload(payload, options = {}) {
        return fetchStreamPayload(this, payload, options);
    }

    ensurePanel() {
        return ensurePanel(this);
    }

    onPanelDragStart(e) {
        return onPanelDragStart(this, e);
    }

    onPanelResizeStart(e) {
        return onPanelResizeStart(this, e);
    }

    bindPanelMoveHandlers() {
        return bindPanelMoveHandlers(this);
    }

    onPanelMove(e) {
        return onPanelMove(this, e);
    }

    onPanelUp() {
        return onPanelUp(this);
    }

    setInteractionLinkStatus(isConnected, message = '') {
        if (!this.panel) return;
        const warning = this.panel.querySelector('.mesh-viewer-warning');
        if (!warning) return;
        if (isConnected) {
            warning.style.display = 'none';
            warning.textContent = '';
            return;
        }
        warning.style.display = 'block';
        warning.textContent = message ||
            'Warning: interaction output is not connected. Events will not reach interaction_state.';
    }

    initMeshEditControls() {
        return initMeshEditControls(this);
    }

    clearAllSelections(silent = false) {
        return clearAllSelections(this, silent);
    }

    getSelectionData() {
        return getSelectionData(this);
    }

    updateEditUI() {
        return updateEditUI(this);
    }

    emitSelectionInteraction() {
        return emitSelectionInteraction(this);
    }

    updateModeButtons() {
        return updateModeButtons(this);
    }

    saveActiveColorbar() {
        if (!this.activeColorbarTarget) return;
        const stops = this.objectColorbars.get(this.activeColorbarTarget) || this.getDefaultColorbarStops();
        const payload = {
            target: this.activeColorbarTarget,
            stops
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safe = this.activeColorbarTarget.replace(/[^a-zA-Z0-9_-]/g, '_');
        a.download = `colorbar_${safe}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    loadActiveColorbar(e) {
        const file = e?.target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result || '{}'));
                const stops = Array.isArray(parsed?.stops) ? parsed.stops : (Array.isArray(parsed) ? parsed : null);
                if (!stops || stops.length < 2 || !this.activeColorbarTarget) return;
                this.objectColorbars.set(this.activeColorbarTarget, stops);
                this.emitInteraction('viewer_colorbar_stops', {
                    target: this.activeColorbarTarget,
                    stops
                });
                this.syncColorbarEditorToActiveTarget();
                this.updateColorbarTexture();
                this.startRenderLoop();
            } catch (_) {
                // Ignore invalid files.
            } finally {
                if (this.colorbarLoadInput) {
                    this.colorbarLoadInput.value = '';
                }
            }
        };
        reader.readAsText(file);
    }

    getDefaultColorbarStops() {
        return [
            { position: 0.0, color: '#2c7bb6' },
            { position: 0.5, color: '#ffffbf' },
            { position: 1.0, color: '#d7191c' }
        ];
    }

    updateColorbarTargets() {
        return updateColorbarTargets(this);
    }

    refreshObjectFilterCounts() {
        return refreshObjectFilterCounts(this);
    }

    getHandleObjectType(handle) {
        return getHandleObjectType(this, handle);
    }

    getAllowedColorModes(handle) {
        return getAllowedColorModes(this, handle);
    }

    getHandleByKey(handleKey) {
        if (!this.currentMeshHandle || !handleKey) return null;
        const handles = this.currentMeshHandle.parts || [this.currentMeshHandle];
        return handles.find((h) => h && h.key === handleKey) || null;
    }

    getHandleColorMode(handle) {
        return getHandleColorMode(this, handle);
    }

    setActiveTargetColorMode(mode) {
        return setActiveTargetColorMode(this, mode);
    }

    getDefaultDisplayFlagsForHandle(handle) {
        return getDefaultDisplayFlagsForHandle(this, handle);
    }

    getAllowedDisplayFlags(handle) {
        return getAllowedDisplayFlags(this, handle);
    }

    getObjectDisplayFlags(handle) {
        return getObjectDisplayFlags(this, handle);
    }

    async toggleObjectDisplayFlag(handle, displayFlags, flag) {
        return toggleObjectDisplayFlag(this, handle, displayFlags, flag);
    }

    isHandleVisibleByFilter(handle) {
        return isHandleVisibleByFilter(this, handle);
    }

    applyObjectBulkVisibility(visible) {
        return applyObjectBulkVisibility(this, visible);
    }

    refreshObjectListUI() {
        return refreshObjectListUI(this);
    }

    syncColorbarEditorToActiveTarget() {
        return syncColorbarEditorToActiveTarget(this);
    }

    initMouseControls() {
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        this.canvas.addEventListener('mousedown', (e) => {
            e.preventDefault();

            // In edit mode, handle vertex/edge/face selection
            if (this.editMode) {
                this.ensureInteractionGeometryReady(this.currentMeshHandle);

                let selectedId = null;
                if (this.selectionMode === 'vertex') {
                    selectedId = this.pickVertex(e.clientX, e.clientY);
                } else if (this.selectionMode === 'edge') {
                    selectedId = this.pickEdge(e.clientX, e.clientY);
                } else if (this.selectionMode === 'face') {
                    selectedId = this.pickFace(e.clientX, e.clientY);
                }

                if (selectedId !== null) {
                    // Handle selection based on mode
                    const targetSet = this.selectionMode === 'vertex' ? this.selectedVertices :
                                     this.selectionMode === 'edge' ? this.selectedEdges :
                                     this.selectedFaces;

                    // Toggle selection with Ctrl/Cmd, otherwise single select
                    if (e.ctrlKey || e.metaKey) {
                        if (targetSet.has(selectedId)) {
                            targetSet.delete(selectedId);
                        } else {
                            targetSet.add(selectedId);
                        }
                    } else {
                        this.clearAllSelections();
                        targetSet.add(selectedId);
                    }

                    this.updateEditUI();
                    this.startRenderLoop();

                    // Emit selection interaction event
                    this.emitSelectionInteraction();

                    // Start dragging if left button and vertex mode
                    if (e.button === 0 && this.selectionMode === 'vertex') {
                        this.vertexDragging = true;
                        this.draggedVertexId = selectedId;
                        this.lastMouseX = e.clientX;
                        this.lastMouseY = e.clientY;
                    }
                    return;
                }
            }

            // Normal camera controls
            this.dragging = true;
            this.dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate';
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            this.emitCameraInteraction('begin', true);
            if (this.dragMode === 'rotate') {
                this.arcballStart = this.projectArcball(e.clientX, e.clientY);
                this.arcballStartQuat = [...this.viewQuat];
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.dragging) {
                this.emitCameraInteraction('commit', true);
            }
            this.dragging = false;
            this.vertexDragging = false;
            this.draggedVertexId = null;
            this.arcballStart = null;
            this.arcballStartQuat = null;
        });

        window.addEventListener('mousemove', (e) => {
            // Vertex dragging
            if (this.vertexDragging && this.draggedVertexId !== null) {
                const dx = e.clientX - this.lastMouseX;
                const dy = e.clientY - this.lastMouseY;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;

                this.dragVertex(this.draggedVertexId, dx, dy);
                this.updateEditUI();
                this.startRenderLoop();
                return;
            }

            // Normal camera controls
            if (!this.dragging) return;
            const dx = e.clientX - this.lastMouseX;
            const dy = e.clientY - this.lastMouseY;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;

            if (this.dragMode === 'pan') {
                this.applyPan(dx, dy);
            } else {
                this.applyTurntableRotate(dx, dy);
            }
            this.startRenderLoop();
            this.emitCameraInteraction('update', false);
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomSpeed = e.deltaY > 0 ? 1.1 : 0.9;
            this.cameraDistance = Math.max(0.05, Math.min(100, this.cameraDistance * zoomSpeed));
            this.startRenderLoop();
            this.emitCameraInteraction('update', true);
        }, { passive: false });

        this.canvas.addEventListener('dblclick', () => {
            this.orbitYaw = 0.0;
            this.orbitPitch = 0.0;
            this.updateViewQuatFromOrbit();
            this.cameraDistance = 3.0;
            this.cameraPan = [0, 0, 0];
            this.startRenderLoop();
            this.emitCameraInteraction('commit', true);
        });
    }

    pickVertex(clientX, clientY) {
        return pickVertex(this, clientX, clientY);
    }

    pickEdge(clientX, clientY) {
        return pickEdge(this, clientX, clientY);
    }

    pickFace(clientX, clientY) {
        return pickFace(this, clientX, clientY);
    }

    rayToSegmentDistance(rayOrigin, rayDir, segStart, segEnd) {
        return rayToSegmentDistance(this, rayOrigin, rayDir, segStart, segEnd);
    }

    rayTriangleIntersection(rayOrigin, rayDir, v0, v1, v2) {
        return rayTriangleIntersection(this, rayOrigin, rayDir, v0, v1, v2);
    }

    getRayFromNDC(ndcX, ndcY) {
        return getRayFromNDC(this, ndcX, ndcY);
    }

    pointToRayDistance(point, rayOrigin, rayDir) {
        return pointToRayDistance(this, point, rayOrigin, rayDir);
    }

    dragVertex(vertexId, dx, dy) {
        return dragVertex(this, vertexId, dx, dy);
    }

    buildCameraInteractionPayload() {
        return {
            cameraDistance: this.cameraDistance,
            cameraPan: [...this.cameraPan],
            viewQuat: [...this.viewQuat],
            dragMode: this.dragMode
        };
    }

    emitCameraInteraction(phase, force) {
        const now = Date.now();
        if (!force && phase === 'update' && (now - this.lastCameraEmitAt) < 50) {
            return;
        }
        this.lastCameraEmitAt = now;
        this.cameraEventVersion += 1;
        this.emitInteraction('viewer_camera_state', this.buildCameraInteractionPayload(), {
            channel: 'camera',
            phase: phase || 'update',
            version: this.cameraEventVersion
        });
    }

    applyPan(dxPixels, dyPixels) {
        return applyPan(this, dxPixels, dyPixels);
    }

    initProgram() {
        return initProgram(this);
    }

    // Runtime and resource delegates

    ensureColorbarTexture() {
        return ensureColorbarTexture(this);
    }

    updateColorbarTexture(stopsOverride = null) {
        return updateColorbarTexture(this, stopsOverride);
    }

    bindMesh(payload) {
        return bindMesh(this, payload);
    }

    scheduleViewerUiRefresh() {
        if (this.pendingViewerUiRefresh) {
            return this.pendingViewerUiRefresh;
        }
        this.pendingViewerUiRefresh = (async () => {
            await this.afterNextPaint();
            if (!this.currentMeshHandle || !this.panel) {
                return;
            }
            this.updateColorbarTargets();
        })().finally(() => {
            this.pendingViewerUiRefresh = null;
        });
        return this.pendingViewerUiRefresh;
    }

    getOrCreateHandleForPayload(payload) {
        return getOrCreateHandleForPayload(this, payload);
    }

    ensurePointRenderResources(handle) {
        return ensurePointRenderResources(this, handle);
    }

    ensureLineRenderBuffers(handle) {
        return ensureLineRenderBuffers(this, handle);
    }

    ensureHandleRenderResources(handle) {
        return ensureHandleRenderResources(this, handle);
    }

    ensureLineRenderResources(handle) {
        return ensureLineRenderResources(this, handle);
    }

    buildEdgeLods(handle) {
        return buildEdgeLods(this, handle);
    }

    getRenderableLineLod(handle, lineLodIndex) {
        return getRenderableLineLod(this, handle, lineLodIndex);
    }

    hydrateHandleForPayload(payload) {
        return hydrateHandleForPayload(this, payload);
    }

    // Editing and interaction geometry delegates

    clearInteractionGeometryCache() {
        this.vertexPositions.clear();
        this.edgeList = [];
        this.faceList = [];
        this.vertexBVH = null;
        this.edgeBVH = null;
        this.faceBVH = null;
    }

    prepareInteractionGeometry(handle) {
        return prepareInteractionGeometry(this, handle);
    }

    scheduleInteractionGeometryPrep(handle) {
        return scheduleInteractionGeometryPrep(this, handle);
    }

    ensureInteractionGeometryReady(handle) {
        return ensureInteractionGeometryReady(this, handle);
    }

    initVertexPositions(handle) {
        return initVertexPositions(this, handle);
    }

    buildEdgesAndFacesFromTriangles(triIndices, vertexOffset) {
        return buildEdgesAndFacesFromTriangles(this, triIndices, vertexOffset);
    }

    buildEdgesFromLines(lineIndices, vertexOffset) {
        return buildEdgesFromLines(this, lineIndices, vertexOffset);
    }

    // Build BVH for vertices
    buildVertexBVH() {
        return buildVertexBVH(this);
    }

    // Build BVH for edges
    buildEdgeBVH() {
        return buildEdgeBVH(this);
    }

    // Build BVH for faces
    buildFaceBVH() {
        return buildFaceBVH(this);
    }

    // Recursive BVH construction using SAH (Surface Area Heuristic)
    buildBVHRecursive(primitives, depth) {
        return buildBVHRecursive(this, primitives, depth);
    }

    computeBounds(primitives) {
        return computeBounds(this, primitives);
    }

    // Ray-AABB intersection test
    rayAABBIntersection(rayOrigin, rayDir, bounds) {
        return rayAABBIntersection(this, rayOrigin, rayDir, bounds);
    }

    // Query BVH for closest edge to ray
    queryEdgeBVH(rayOrigin, rayDir, threshold) {
        return queryEdgeBVH(this, rayOrigin, rayDir, threshold);
    }

    // Query BVH for closest face intersection
    queryFaceBVH(rayOrigin, rayDir) {
        return queryFaceBVH(this, rayOrigin, rayDir);
    }

    // Check if a point is occluded by any face in the mesh
    isPointOccluded(point, rayOrigin) {
        return isPointOccluded(this, point, rayOrigin);
    }

    // Query BVH for closest vertex to ray
    queryVertexBVH(rayOrigin, rayDir, threshold) {
        return queryVertexBVH(this, rayOrigin, rayDir, threshold);
    }

    updateMeshGeometry() {
        return updateMeshGeometry(this);
    }

    rebuildPartBuffers(part) {
        return rebuildPartBuffers(this, part);
    }

    rebuildHandleBuffers(handle) {
        return rebuildHandleBuffers(this, handle);
    }

    computeVertexNormals(vertices, triIndices, vertexCount) {
        return computeVertexNormals(this, vertices, triIndices, vertexCount);
    }

    releaseIndexedLodBuffers(lods) {
        return releaseIndexedLodBuffers(this, lods);
    }

    releaseArrowLodBuffers(lods) {
        return releaseArrowLodBuffers(this, lods);
    }

    releaseHandleGpuResources(handle) {
        return releaseHandleGpuResources(this, handle);
    }

    createHandleFromGeometry(geom, key, version, texturePath, label = '') {
        return createHandleFromGeometry(this, geom, key, version, texturePath, label);
    }

    buildDirectedArrowLod(vertices, vertexColors, lineIndices, lineFlags, step) {
        return buildDirectedArrowLod(this, vertices, vertexColors, lineIndices, lineFlags, step);
    }

    extractGeometry(payload) {
        return extractGeometry(this, payload);
    }

    resolveTextureUrl(path) {
        return resolveTextureUrl(this, path);
    }

    getTexture(path) {
        return getTexture(this, path);
    }

    buildLodIndices(indices, triStep) {
        return buildLodIndices(this, indices, triStep);
    }

    buildLineLodIndices(indices, step) {
        return buildLineLodIndices(this, indices, step);
    }

    buildPointLodIndices(indices, step) {
        return buildPointLodIndices(this, indices, step);
    }

    chooseLodIndex() {
        return chooseLodIndex(this);
    }

    chooseLineLodIndex(handle, faceLodIndex) {
        return chooseLineLodIndex(this, handle, faceLodIndex);
    }

    choosePointLodIndex(handle, faceLodIndex) {
        return choosePointLodIndex(this, handle, faceLodIndex);
    }

    updateMeta(payload, indexCount) {
        return updateMeta(this, payload, indexCount);
    }

    startRenderLoop() {
        return startRenderLoop(this);
    }

    renderFrame() {
        if (!this.gl || !this.program || !this.currentMeshHandle || !this.currentPayload) return;
        const gl = this.gl;
        this.lastDrawStats = { faces: 0, lines: 0, points: 0, faceIndices: 0, lineIndices: 0, pointIndices: 0 };
        this.lastRenderStage = 'frame_start';
        const frameState = computeFrameViewState(this);
        this.lastRenderStage = 'frame_state';
        gl.viewport(0, 0, frameState.canvasWidth, frameState.canvasHeight);
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE); // Ensure back faces are rendered
        gl.clearColor(0.93, 0.94, 0.96, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        this.lastRenderStage = 'program_bind';
        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uniforms.mvp, false, frameState.mvp);
        gl.uniformMatrix4fv(this.uniforms.model, false, frameState.model);
        const light = this.currentPayload.lightDirection || [0.3, 0.5, 0.8];
        const intensity = Number.isFinite(this.currentPayload.lightIntensity)
            ? this.currentPayload.lightIntensity
            : 1.0;
        gl.uniform3f(this.uniforms.light, light[0], light[1], light[2]);
        gl.uniform1f(this.uniforms.lightIntensity, intensity);
        gl.uniform1f(this.uniforms.pointSize, 4.0);
        const colorbarTex = this.ensureColorbarTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, colorbarTex);
        gl.uniform1i(this.uniforms.colorbar, 1);
        const lodIndex = this.chooseLodIndex();
        const handles = this.currentMeshHandle.parts || [this.currentMeshHandle];
        this.lastRenderStage = 'draw_handles';
        for (const handle of handles) {
            drawHandle(this, handle, { lodIndex });
        }

        // Render selected elements
        if (this.editMode) {
            this.lastRenderStage = 'draw_selection';
            if (this.selectionMode === 'vertex' && this.selectedVertices.size > 0) {
                this.renderSelectedVertices(frameState.mvp);
            } else if (this.selectionMode === 'edge' && this.selectedEdges.size > 0) {
                this.renderSelectedEdges(frameState.mvp);
            } else if (this.selectionMode === 'face' && this.selectedFaces.size > 0) {
                this.renderSelectedFaces(frameState.mvp);
            }
        }

        this.lastRenderStage = 'meta_update';
        const indexCount = getPrimaryHandleIndexCount(this.currentMeshHandle);
        this.updateMeta(this.currentPayload, indexCount);
        this.lastRenderStage = 'complete';
    }

    renderSelectedVertices(mvp) {
        return renderSelectedVertices(this, mvp);
    }

    renderSelectedEdges(mvp) {
        return renderSelectedEdges(this, mvp);
    }

    renderSelectedFaces(mvp) {
        return renderSelectedFaces(this, mvp);
    }

    // Math and camera delegates

    projectArcball(clientX, clientY) {
        return projectArcball(this, clientX, clientY);
    }

    quatIdentity() {
        return quatIdentity();
    }

    quatNormalize(q) {
        return quatNormalize(this, q);
    }

    quatMul(a, b) {
        return quatMul(this, a, b);
    }

    quatFromBallPoints(from, to) {
        return quatFromBallPoints(this, from, to);
    }

    quatFromAxisAngle(axis, angle) {
        return quatFromAxisAngle(this, axis, angle);
    }

    updateViewQuatFromOrbit() {
        return updateViewQuatFromOrbit(this);
    }

    applyTurntableRotate(dx, dy) {
        return applyTurntableRotate(this, dx, dy);
    }

    rotateByQuat(v, q) {
        return rotateByQuat(this, v, q);
    }

    identity() {
        return identity();
    }

    perspective(fovy, aspect, near, far) {
        return perspective(this, fovy, aspect, near, far);
    }

    lookAt(eye, center, up) {
        return lookAt(this, eye, center, up);
    }

    multiplyMat4(a, b) {
        return multiplyMat4(this, a, b);
    }
}

export { MeshViewerPanel };
