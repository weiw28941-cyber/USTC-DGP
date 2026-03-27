import { Node } from './node.js';
import { NodeGroup } from './node_group.js';
import { CommentBox } from './comment_box.js';
import { Connection } from './connection.js';
import { ContextMenu } from '../ui/context_menu.js';
import { SearchMenu } from '../ui/search_menu.js';
import { PreviewPanel } from '../ui/preview_panel.js';
import { MeshViewerPanel } from '../ui/mesh_viewer_panel.js';
import { TemplateLibraryPanel } from '../ui/template_library_panel.js';
import { historyMixin } from './history.js';
import { rendererMixin } from './renderer.js';
import { interactionMixin } from './interaction.js';
import {
    coalescePatchBatch,
    patchBatchContainsConnectionChanges,
    patchBatchTriggersAutoExecute
} from './graph_execution_rules.js';
import { GraphPatchQueue } from './patch_queue.js';
import { ExecutionSessionClient } from './execution_session_client.js';
import { ExecutionResultApplier } from './execution_result_applier.js';
import { QueuedExecutionOptionsAccumulator } from './queued_execution_options.js';
import { PreviewRefreshScheduler } from './preview_refresh_scheduler.js';
import {
    buildIncrementalExecutionOptions,
    getPreferredPreviewSocketId
} from './execution_request_builder.js';
import { syncLocalPreview } from './preview_output_state.js';
import { applyOperationNodeEdit, syncOperationDependentNodeState } from './node_operation_updates.js';
import { applyPreviewTrackedNodeEdit } from './graph_change_execution.js';
import { applyNodePreviewContracts } from './node_preview_contracts.js';
import {
    DEFAULT_PAGED_PREVIEW_ITEMS,
    isGeometryViewerPayload
} from './output_transport.js';

class NodeEditor {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nodes = [];
        this.connections = [];
        this.groups = []; // 节点组
        this.comments = []; // 注释框
        this.selectedNodes = new Set(); // 多选支持
        this.dragOffset = {x: 0, y: 0};
        this.connectingFrom = null;
        this.tempConnection = null;
        this.redirectingConnection = null;
        this.nodeIdCounter = 0;
        this.contextMenu = new ContextMenu(this);
        this.searchMenu = new SearchMenu(this);
        this.previewPanel = new PreviewPanel(this);
        this.meshViewerPanel = new MeshViewerPanel();
        this.meshViewerPanel.setInteractionHandler((evt) => this.enqueueViewerInteractionEvent(evt));
        this.pendingViewerInteractionEvent = null;
        this.viewerInteractionFrameHandle = null;
        this.previewHoldNode = null;
        this.autoExecuteEnabled = true;
        this.executeTimeout = null;
        this.nodeTypes = [];
        this.nodeTypeMap = {};
        this.nodeEditors = {};
        this.sessionClient = new ExecutionSessionClient();
        this.patchFlushDelayMs = 16;
        this.patchQueue = new GraphPatchQueue({
            coalescePatchBatch,
            defaultDelayMs: this.patchFlushDelayMs
        });
        this.resultApplier = new ExecutionResultApplier(this);
        this.previewRefreshScheduler = new PreviewRefreshScheduler(this);
        this.interactionFocusNodeIds = new Set();
        this.lastInteractionStateOutputs = null;
        this.lastPreviewTrace = null;
        this.queuedExecutionOptions = new QueuedExecutionOptionsAccumulator(
            (base, override) => this.mergeExecutionOptions(base, override)
        );

        // 快捷键配置
        this.shortcutConfigDefault = this.getDefaultShortcutConfig();
        this.shortcutConfig = this.cloneShortcutConfig(this.shortcutConfigDefault);
        this.shortcutOverrides = {};
        this.shortcutActions = [];
        this.shortcutHandlers = this.createShortcutHandlers();
        this.applyShortcutOverrides();
        this.loadShortcuts();

        // 视图变换
        this.viewOffset = {x: 0, y: 0};
        this.viewScale = 1.0;
        this.minScale = 0.1;
        this.maxScale = 3.0;

        // 框选
        this.isBoxSelecting = false;
        this.boxSelectStart = null;
        this.boxSelectEnd = null;

        // 平移
        this.isPanning = false;
        this.panStart = null;

        // 组拖拽和调整大小
        this.draggingGroup = null;
        this.draggingGroupStart = null;
        this.resizingGroup = null;
        this.resizeStart = null;
        this.resizeOriginal = null;
        this.resizeNodePositions = null; // 保存调整大小时节点的原始位置

        // 注释框拖拽和调整大小
        this.draggingComment = null;
        this.resizingComment = null;
        this.selectedComment = null;

        // 复制粘贴
        this.clipboard = null;

        // 撤销/重做
        this.history = [];
        this.historyIndex = -1;
        this.maxHistorySize = 50;
        this.isPerformingHistoryAction = false;

        // 网格吸附
        this.gridSnap = true;
        this.gridSize = 50;

        // 节点预览
        this.showPreview = true;

        // 工具提示
        this.tooltip = null;
        this.tooltipTimeout = null;

        // 性能优化
        this.needsRender = true; // 标记是否需要重新渲染
        this.showPerformanceMetrics = false; // 是否显示性能指标
        this.performanceMetrics = {
            fps: 0,
            renderTime: 0,
            visibleNodes: 0,
            visibleConnections: 0,
            totalNodes: 0,
            totalConnections: 0
        };
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.fpsUpdateInterval = 500; // 每500ms更新一次FPS
        this.lastFpsUpdate = performance.now();

        // 模板库
        this.templates = []; // 存储的模板
        this.templateLibraryPanel = null; // 模板库面板
        this.loadTemplates(); // 从 localStorage 加载模板

        this.loadNodeTypes().then(() => {
            this.resize();
            window.addEventListener('resize', () => this.resize());

            // 鼠标事件
            this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
            this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
            this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
            this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
            this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));
            this.canvas.addEventListener('wheel', (e) => this.onWheel(e), {passive: false});

            // 键盘事件
            window.addEventListener('keydown', (e) => this.onKeyDown(e));
            window.addEventListener('keyup', (e) => this.onKeyUp(e));

            this.requestRender();
            this.showWelcomeMessage();

            // 保存初始状态
            this.saveHistory('Initial State');

            // 启动渲染循环
            this.startRenderLoop();
        });
    }

    enqueueViewerInteractionEvent(evt) {
        if (!evt || !Number.isFinite(evt.nodeId) || !evt.key) return;
        const phase = (typeof evt.phase === 'string' && evt.phase) ? evt.phase : 'update';
        if (phase !== 'update') {
            this.flushQueuedViewerInteractionEvent();
            this.processViewerInteractionEvent(evt);
            return;
        }
        this.pendingViewerInteractionEvent = evt;
        if (this.viewerInteractionFrameHandle !== null) return;
        const schedule = (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
            ? window.requestAnimationFrame.bind(window)
            : (cb) => setTimeout(cb, 16);
        this.viewerInteractionFrameHandle = schedule(() => {
            this.viewerInteractionFrameHandle = null;
            this.flushQueuedViewerInteractionEvent();
        });
    }

    flushQueuedViewerInteractionEvent() {
        if (!this.pendingViewerInteractionEvent) return;
        const evt = this.pendingViewerInteractionEvent;
        this.pendingViewerInteractionEvent = null;
        this.processViewerInteractionEvent(evt);
    }

    buildInteractionEvent(evt, targetNodeId) {
        const nowMs = Date.now();
        return {
            channel: typeof evt.channel === 'string' && evt.channel ? evt.channel : 'viewer',
            phase: typeof evt.phase === 'string' && evt.phase ? evt.phase : 'update',
            sourceNodeId: targetNodeId,
            targetNodeId,
            version: Number.isFinite(evt.version) ? Math.max(0, Math.floor(evt.version)) : nowMs,
            timestampMs: nowMs,
            source: 'webui',
            payload: {
                sourceViewerNodeId: evt.nodeId,
                action: evt.key,
                value: evt.value
            }
        };
    }

    validateInteractionEvent(event) {
        if (!event || typeof event !== 'object') return false;
        const validPhase = event.phase === 'begin' || event.phase === 'update' ||
            event.phase === 'commit' || event.phase === 'cancel';
        if (!validPhase) return false;
        if (!Number.isFinite(event.sourceNodeId) || event.sourceNodeId < 0) return false;
        if (!Number.isFinite(event.targetNodeId) || event.targetNodeId < 0) return false;
        if (!Number.isFinite(event.version) || event.version < 0) return false;
        if (!Number.isFinite(event.timestampMs) || event.timestampMs < 0) return false;
        if (typeof event.channel !== 'string' || event.channel.length === 0) return false;
        if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return false;
        return true;
    }

    isCameraOnlyInteractionEvent(event) {
        return !!event &&
            typeof event === 'object' &&
            event.channel === 'camera' &&
            event.payload &&
            typeof event.payload === 'object' &&
            event.payload.action === 'viewer_camera_state';
    }

    processViewerInteractionEvent(evt) {
        if (!evt || !Number.isFinite(evt.nodeId) || !evt.key) return;
        const targetNodeId = Number(evt.nodeId);
        const sourceNode = this.nodes.find(n => n.id === targetNodeId) || null;
        const connected = this.hasInteractionConnection(targetNodeId);
        this.meshViewerPanel.setInteractionLinkStatus(connected);
        this.interactionFocusNodeIds.add(targetNodeId);
        const consumers = this.getInteractionConnectionTargets(targetNodeId);
        for (const cid of consumers) {
            this.interactionFocusNodeIds.add(cid);
        }

        const interactionEvent = this.buildInteractionEvent(evt, targetNodeId);
        if (!this.validateInteractionEvent(interactionEvent)) {
            return;
        }
        const isCameraOnly = this.isCameraOnlyInteractionEvent(interactionEvent);
        if (sourceNode) {
            sourceNode[evt.key] = evt.value;
            if (isCameraOnly) {
                sourceNode.viewer_camera_state = evt.value;
            } else {
                sourceNode.interaction_event = interactionEvent;
            }
        }
        if (isCameraOnly) {
            if (this.previewPanel && this.previewPanel.node &&
                Number(this.previewPanel.node.id) === targetNodeId) {
                this.previewPanel.refresh(sourceNode);
            }
            return;
        }
        for (const cid of consumers) {
            const consumerNode = this.nodes.find(n => n.id === cid);
            if (!consumerNode) continue;
            consumerNode.interaction_event = interactionEvent;
            if (!consumerNode.interaction_state || typeof consumerNode.interaction_state !== 'object') {
                consumerNode.interaction_state = {};
            }
        }

        this.enqueueGraphPatches(
            [
                {
                    op: 'viewer_interaction',
                    nodeId: targetNodeId,
                    key: 'interaction_event',
                    value: interactionEvent
                }
            ],
            {
                execute: false,
                debounceMs: 120
            }
        );

        const phase = interactionEvent.phase;
        if (phase === 'commit' || phase === 'cancel') {
            // Use full execute path so deltas are parsed and previews update immediately.
            this.requestExecutionRefresh({ immediate: true });
        } else {
            this.scheduleAutoExecute();
        }
    }

    createNodeEditors() {
        const editors = {};
        const buildPromptEditor = (nodeType, key, prop) => {
            const label = prop?.label || key;
            const propertyType = String(prop?.type || 'string');
            return {
                kind: 'prompt',
                prompt: prop?.description || `Enter ${label}:`,
                history: `Edit ${nodeType.name} ${label}`,
                patchOp: 'set_node_property',
                patchKey: key,
                get: (node) => node[key] ?? '',
                parse: (input) => {
                    if (propertyType === 'number') {
                        const parsed = parseFloat(input);
                        return Number.isFinite(parsed) ? parsed : 0;
                    }
                    return input;
                },
                set: (node, value) => {
                    node[key] = value;
                }
            };
        };
        const buildOperationEditor = (nodeType, prop) => {
            const options = Array.isArray(prop?.options) ? prop.options : [];
            if (options.length === 0) return null;
            const isTypeSwitch = options.includes('number') && options.includes('string');
            const history = isTypeSwitch
                ? `Change ${nodeType.name} Type`
                : `Change ${nodeType.name} Operation`;
            return {
                kind: 'cycle',
                history,
                patchOp: 'set_node_property',
                patchKey: 'operation',
                values: options,
                description: prop?.description || '',
                get: (node) => node.operation,
                set: (node, value) => syncOperationDependentNodeState(this, node, value)
            };
        };

        const nodeTypes = Array.isArray(this.nodeTypes) ? this.nodeTypes : [];
        for (const nodeType of nodeTypes) {
            const properties = nodeType?.properties || {};
            const editableEntries = Object.entries(properties)
                .filter(([, prop]) => prop?.editable !== false);
            if (editableEntries.length === 0) continue;

            if (properties.operation?.editable !== false && Array.isArray(properties.operation?.options)) {
                const opEditor = buildOperationEditor(nodeType, properties.operation);
                if (opEditor) {
                    editors[nodeType.id] = opEditor;
                    continue;
                }
            }

            const hasEditableValue = properties.value && properties.value.editable !== false;
            const hasEditableText = properties.text && properties.text.editable !== false;
            const preferredKey = hasEditableValue
                ? 'value'
                : (hasEditableText ? 'text' : editableEntries[0][0]);
            const prop = properties[preferredKey];
            editors[nodeType.id] = buildPromptEditor(nodeType, preferredKey, prop);
        }

        return editors;
    }

    ensureNodeValues(node) {
        const opOptions = node?.config?.properties?.operation?.options;
        if (Array.isArray(opOptions) && opOptions.length > 0) {
            const currentOp = String(node.operation ?? '');
            if (!opOptions.includes(currentOp)) {
                node.operation = opOptions[0];
            }
        }

        if (node.type === 'vector') {
            if (node.operation !== 'number' && node.operation !== 'string') {
                node.operation = 'number';
            }
            if (!Array.isArray(node.values)) {
                node.values = [];
            }
            this.syncVectorInputs(node);
        } else if (node.type === 'list') {
            if (node.operation !== 'number' && node.operation !== 'string') {
                node.operation = 'number';
            }
            if (!Array.isArray(node.values)) {
                node.values = [];
            }
            this.syncListInputs(node, true);
        } else if (node.type === 'geometry') {
            if (!Array.isArray(node.values) || node.values.length < 3) {
                const seed = Array.isArray(node.values) ? node.values.slice(0, 3) : [];
                while (seed.length < 3) {
                    seed.push(1);
                }
                node.values = seed.map(v => {
                    const n = Number.parseInt(v, 10);
                    return Number.isFinite(n) ? Math.max(0, n) : 1;
                });
            }
            this.syncGeometryInputs(node);
        }
    }

    syncVectorInputs(node) {
        const values = Array.isArray(node.values) ? node.values : [];
        const existing = new Map();
        node.inputs.forEach(input => {
            existing.set(input.id, input);
        });

        const newInputs = [];
        for (let i = 0; i < values.length; i++) {
            const id = i === 0 ? 'x' : i === 1 ? 'y' : i === 2 ? 'z' : `v${i}`;
            const label = i === 0 ? 'X' : i === 1 ? 'Y' : i === 2 ? 'Z' : `V${i}`;
            const socket = existing.get(id) || {
                id,
                label,
                x: 0,
                y: 0,
                connection: null
            };
            socket.id = id;
            socket.label = label;
            socket.type = node.operation === 'string' ? 'string' : 'number';
            socket.customType = '';
            socket.x = 0;
            socket.y = 40 + i * 40;
            newInputs.push(socket);
        }

        for (const input of node.inputs) {
            if (!newInputs.includes(input) && input.connection) {
                this.removeConnection(input.connection);
            }
        }

        node.inputs = newInputs;
        node.updateAutoSize();
    }

    syncListInputs(node, preserveConnections = false) {
        const values = Array.isArray(node.values) ? node.values : [];
        const existing = new Map();
        node.inputs.forEach(input => {
            existing.set(input.id, input);
        });

        const newInputs = [];
        for (let i = 0; i < values.length; i++) {
            const id = `e${i}`;
            const label = `E${i}`;
            const socket = existing.get(id) || {
                id,
                label,
                x: 0,
                y: 0,
                connection: null
            };
            socket.id = id;
            socket.label = label;
            socket.type = node.operation === 'string' ? 'string' : 'number';
            socket.customType = '';
            socket.x = 0;
            socket.y = 40 + i * 40;
            newInputs.push(socket);
        }

        if (!preserveConnections) {
            for (const input of node.inputs) {
                if (!newInputs.includes(input) && input.connection) {
                    this.removeConnection(input.connection);
                }
            }
        }

        node.inputs = newInputs;
        if (preserveConnections) {
            this.rebindListConnections(node);
        }
        node.updateAutoSize();
    }

    syncGeometryInputs(node) {
        const counts = Array.isArray(node.values) ? node.values.slice(0, 3) : [1, 1, 1];
        while (counts.length < 3) counts.push(1);
        const pointsCount = Math.max(0, Number.parseInt(counts[0], 10) || 0);
        const linesCount = Math.max(0, Number.parseInt(counts[1], 10) || 0);
        const meshCount = Math.max(0, Number.parseInt(counts[2], 10) || 0);
        node.values = [pointsCount, linesCount, meshCount];

        const existing = new Map();
        node.inputs.forEach(input => existing.set(input.id, input));

        const nextInputs = [];
        const baseGeometry = existing.get('geometry') || {
            id: 'geometry',
            label: 'Geometry',
            x: 0,
            y: 0,
            connection: null
        };
        baseGeometry.id = 'geometry';
        baseGeometry.label = 'Geometry';
        baseGeometry.x = 0;
        baseGeometry.y = 40;
        nextInputs.push(baseGeometry);

        let row = 1;
        const appendGroup = (prefix, label, count) => {
            for (let i = 0; i < count; i++) {
                const id = i === 0 ? prefix : `${prefix}${i}`;
                const legacyId = `${prefix}${i}`;
                const socket = existing.get(id) || existing.get(legacyId) || {
                    id,
                    label: `${label} ${i}`,
                    x: 0,
                    y: 0,
                    connection: null
                };
                socket.id = id;
                socket.label = i === 0 ? label : `${label} ${i}`;
                socket.x = 0;
                socket.y = 40 + row * 40;
                row += 1;
                nextInputs.push(socket);
            }
        };

        appendGroup('points', 'Points', pointsCount);
        appendGroup('lines', 'Lines', linesCount);
        appendGroup('mesh', 'Mesh', meshCount);

        for (const input of node.inputs) {
            if (!nextInputs.includes(input) && input.connection) {
                this.removeConnection(input.connection);
            }
        }

        node.inputs = nextInputs;
        node.updateAutoSize();
    }

    rebindListConnections(node) {
        const inputMap = new Map();
        node.inputs.forEach(input => inputMap.set(input.id, input));
        const toRemove = [];
        for (const conn of this.connections) {
            if (conn.toNode !== node) continue;
            const nextSocket = inputMap.get(conn.toSocket.id);
            if (!nextSocket) {
                toRemove.push(conn);
                continue;
            }
            conn.toSocket.connection = null;
            conn.toSocket = nextSocket;
            nextSocket.connection = conn;
        }
        if (toRemove.length > 0) {
            this.connections = this.connections.filter(c => !toRemove.includes(c));
        }
    }

    parseListIndex(id) {
        if (!id || id[0] !== 'e') return null;
        const raw = id.slice(1);
        const idx = Number.parseInt(raw, 10);
        return Number.isFinite(idx) ? idx : null;
    }

    shiftListConnections(node, startIndex, delta) {
        const toRemove = [];
        for (const conn of this.connections) {
            if (conn.toNode !== node) continue;
            const idx = this.parseListIndex(conn.toSocket.id);
            if (idx === null) continue;
            if (delta < 0 && idx === startIndex) {
                toRemove.push(conn);
                continue;
            }
            if (idx >= startIndex) {
                const nextIndex = idx + delta;
                conn.toSocket.id = `e${nextIndex}`;
            }
        }
        if (toRemove.length > 0) {
            this.connections = this.connections.filter(c => !toRemove.includes(c));
        }
    }

    removeConnection(connection) {
        this.connections = this.connections.filter(c => c !== connection);
        if (connection.toSocket) {
            connection.toSocket.connection = null;
        }
    }

    applyNodeEdit(historyLabel, updateFn, syncSpec = null, options = {}) {
        updateFn();
        if (typeof options.afterUpdate === 'function') {
            options.afterUpdate();
        }
        this.saveHistory(historyLabel);
        this.syncSessionAfterNodeEdit(syncSpec, options);
        this.requestRender();
        if (options.immediatePatchExecute !== true) {
            // Property edits should reflect in preview as soon as possible.
            this.scheduleAutoExecute(0);
        }
    }

    syncSessionAfterNodeEdit(syncSpec, options = {}) {
        const resolvedSpec = typeof syncSpec === 'function'
            ? syncSpec()
            : syncSpec;
        const resolvedValue = typeof resolvedSpec?.value === 'function'
            ? resolvedSpec.value()
            : resolvedSpec?.value;
        if (resolvedSpec && Number.isFinite(resolvedSpec.nodeId) && resolvedSpec.key) {
            const executionOptions = options.executionOptions || null;
            if (!executionOptions) {
                throw new Error(
                    `Missing executionOptions for node edit patch ${resolvedSpec.op || 'set_node_property'}:${resolvedSpec.nodeId}:${resolvedSpec.key}. ` +
                    'Use applyPreviewTrackedNodeEdit(...) for property/socket changes.'
                );
            }
            this.enqueueGraphPatches([{
                op: resolvedSpec.op || 'set_node_property',
                nodeId: resolvedSpec.nodeId,
                key: resolvedSpec.key,
                value: resolvedValue
            }], {
                execute: options.immediatePatchExecute === true,
                executionOptions,
                fullResults: false,
                debounceMs: options.immediatePatchExecute === true ? 0 : undefined
            });
            return;
        }
        if (!this.sessionClient.hasSession()) return;
        this.syncGraphSession();
    }

    enqueueIncrementalExecutionPatches(patches, options = {}) {
        const list = Array.isArray(patches) ? patches : [];
        if (list.length === 0) return;
        if (patchBatchContainsConnectionChanges(list) && !options.executionOptions) {
            throw new Error(
                'Missing executionOptions for connection graph change. ' +
                'Use enqueueConnectionGraphChange(...) for connection changes.'
            );
        }
        this.enqueueGraphPatches(list, {
            execute: false,
            debounceMs: options.debounceMs,
            executionOptions: options.executionOptions || null
        });
        this.scheduleAutoExecute(options.delayMs ?? null);
    }

    enqueueSessionOnlyPatches(patches, options = {}) {
        const list = Array.isArray(patches) ? patches : [];
        if (list.length === 0) return;
        this.enqueueGraphPatches(list, {
            execute: false,
            debounceMs: options.debounceMs
        });
    }

    requestSessionSnapshotSync() {
        if (!this.sessionClient.hasSession()) return;
        this.syncGraphSession().catch(() => {});
    }

    getNodeSchemaEditInfo(node) {
        const properties = node?.config?.properties || {};
        const entries = Object.entries(properties);
        const editableEntries = entries.filter(([, prop]) => prop?.editable !== false);
        const readonlyEntries = entries.filter(([, prop]) => prop?.editable === false);
        return {
            editableEntries,
            readonlyEntries,
            primaryEntry: editableEntries.find(([key]) => key === 'operation')
                || editableEntries.find(([key]) => key === 'value')
                || editableEntries.find(([key]) => key === 'text')
                || editableEntries[0]
                || null
        };
    }

    describeNodeReadOnlyState(node) {
        const info = this.getNodeSchemaEditInfo(node);
        const nodeName = node?.config?.name || node?.type || 'Unknown';
        if (info.editableEntries.length > 0) {
            return `Node "${nodeName}" can be edited through: ${info.editableEntries.map(([key]) => key).join(', ')}`;
        }
        if (info.readonlyEntries.length > 0) {
            return `Node "${nodeName}" has no editable properties.\nRead-only fields: ${info.readonlyEntries.map(([key]) => key).join(', ')}`;
        }
        return `Node "${nodeName}" has no schema-editable fields.`;
    }

    editNode(node) {
        const info = this.getNodeSchemaEditInfo(node);
        if (info.editableEntries.length === 0) {
            const output = document.getElementById('output');
            if (output) {
                output.textContent = this.describeNodeReadOnlyState(node);
            }
            return false;
        }
        const editor = this.nodeEditors[node.type];
        if (!editor) {
            const output = document.getElementById('output');
            if (output) {
                output.textContent = this.describeNodeReadOnlyState(node);
            }
            return false;
        }

        if (editor.kind === 'prompt') {
            const current = editor.get(node);
            const input = prompt(editor.prompt, current);
            if (input === null) return false;
            const nextValue = editor.parse ? editor.parse(input) : input;
            const previewSocketId = this.getPreferredPreviewSocketId(node);
            applyPreviewTrackedNodeEdit(
                this,
                editor.history,
                node,
                () => editor.set(node, nextValue),
                editor.patchKey
                    ? { op: editor.patchOp, nodeId: node.id, key: editor.patchKey, value: nextValue }
                    : null,
                {
                    previewSocketId,
                    afterUpdate: () => {
                        if (previewSocketId && editor.patchKey === previewSocketId) {
                            syncLocalPreview(this, node, previewSocketId, nextValue);
                        }
                    }
                }
            );
            return true;
        }

        if (editor.kind === 'cycle') {
            return this.cycleNodeOperation(node);
        }

        return false;
    }

    cycleNodeOperation(node) {
        const editor = this.nodeEditors[node?.type];
        return applyOperationNodeEdit(this, node, editor);
    }

    canDoubleClickEditNode(node) {
        const editor = this.nodeEditors[node?.type];
        if (!editor || editor.kind !== 'prompt') {
            return false;
        }
        return node?.type === 'value' || node?.type === 'string';
    }

    shouldProgressivelyLoadFullPreview(node) {
        if (!node || !node.previewMeta || node.previewMeta.outputsTruncated !== true) {
            return false;
        }
        return isGeometryViewerPayload(node.previewValue);
    }

    async fetchFullPreviewForNode(node, options = {}) {
        if (!node || !Number.isFinite(node.id)) return false;
        const socketId = options.socketId || node?.previewMeta?.socketId || this.getPreferredPreviewSocketId(node);
        if (!socketId) return false;
        if (!this.fullPreviewFetches) {
            this.fullPreviewFetches = new Map();
        }
        const fetchKey = `${Number(node.id)}:${String(socketId)}`;
        if (this.fullPreviewFetches.has(fetchKey)) {
            return this.fullPreviewFetches.get(fetchKey);
        }
        const task = (async () => {
            const resp = await this.sessionClient.fetchNodeOutputs(node.id, [socketId], {
                graphData: this.collectGraphData(),
                executionOptions: {
                    omitOutputs: false,
                    maxPreviewItems: 0,
                    outputNodeIds: [node.id],
                    outputSockets: { [String(node.id)]: [socketId] }
                }
            });
            if (!resp || !resp.ok) return false;
            const payload = await resp.json();
            if (payload) {
                this.applyExecutionResult(payload, { silent: options.silent === true });
            }
            return true;
        })().finally(() => {
            this.fullPreviewFetches.delete(fetchKey);
        });
        this.fullPreviewFetches.set(fetchKey, task);
        return task;
    }

    async fetchPreviewDescriptorForNode(node, options = {}) {
        if (!node || !Number.isFinite(node.id)) return false;
        const socketId = options.socketId || this.getPreferredPreviewSocketId(node);
        if (!socketId) return false;
        const graphData = this.collectGraphData();
        const syncResp = await this.sessionClient.executeGraph(graphData, { execute: false });
        if (!syncResp || !syncResp.ok) return false;
        const resp = await this.sessionClient.fetchNodeOutputs(node.id, [socketId], {
            graphData,
            executionOptions: {
                omitOutputs: false,
                maxPreviewItems: DEFAULT_PAGED_PREVIEW_ITEMS,
                outputNodeIds: [node.id],
                outputSockets: { [String(node.id)]: [socketId] }
            }
        });
        if (!resp || !resp.ok) return false;
        const payload = await resp.json();
        if (payload) {
            this.applyExecutionResult(payload, { silent: options.silent === true });
        }
        return true;
    }

    isFullPreviewFetchInFlight(node, socketId = null) {
        if (!node || !Number.isFinite(node.id) || !this.fullPreviewFetches) {
            return false;
        }
        const resolvedSocketId = socketId || node?.previewMeta?.socketId || this.getPreferredPreviewSocketId(node);
        if (!resolvedSocketId) return false;
        return this.fullPreviewFetches.has(`${Number(node.id)}:${String(resolvedSocketId)}`);
    }

    async fetchPreviewPageForNode(node, options = {}) {
        if (!node || !Number.isFinite(node.id)) return false;
        const socketId = options.socketId || node?.previewMeta?.socketId || this.getPreferredPreviewSocketId(node);
        if (!socketId) return false;
        if (!this.previewPageFetches) {
            this.previewPageFetches = new Map();
        }
        const requestEpoch = Number(node?.previewMeta?.previewEpoch || 0);
        const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset)) : 0;
        const limit = Number.isFinite(options.limit)
            ? Math.max(1, Math.floor(options.limit))
            : DEFAULT_PAGED_PREVIEW_ITEMS;
        const fetchKey = `${Number(node.id)}:${String(socketId)}:${requestEpoch}:${offset}:${limit}`;
        if (this.previewPageFetches.has(fetchKey)) {
            return this.previewPageFetches.get(fetchKey);
        }

        const task = (async () => {
            this.lastPreviewTrace = {
                stage: 'output_page_request',
                nodeId: Number(node.id),
                socketId: String(socketId),
                requestEpoch,
                offset,
                limit,
                previewPanelNodeId: Number.isFinite(this.previewPanel?.node?.id) ? Number(this.previewPanel.node.id) : null
            };
            const resp = await this.sessionClient.fetchNodeOutputPage(node.id, socketId, {
                graphData: this.collectGraphData(),
                offset,
                limit
            });
            if (!resp || !resp.ok) return false;
            const payload = await resp.json();
            const page = payload?.result;
            if (!page || page.success !== true) return false;
            if (Number(node?.previewMeta?.previewEpoch || 0) !== requestEpoch) {
                this.lastPreviewTrace = {
                    ...this.lastPreviewTrace,
                    stage: 'output_page_stale',
                    responseVersion: Number.isFinite(payload?.version) ? Number(payload.version) : null,
                    pageOutput: page?.output ?? null
                };
                return false;
            }
            this.lastPreviewTrace = {
                ...this.lastPreviewTrace,
                stage: 'output_page_applied',
                responseVersion: Number.isFinite(payload?.version) ? Number(payload.version) : null,
                pageOutput: page?.output ?? null,
                pageCount: Number.isFinite(page?.count) ? Number(page.count) : null,
                pageTotalCount: Number.isFinite(page?.totalCount) ? Number(page.totalCount) : null,
                pageHasMore: page?.hasMore === true
            };

            if (Array.isArray(page.output)) {
                if (offset > 0 && Array.isArray(node.previewValue)) {
                    node.previewValue = node.previewValue.concat(page.output);
                } else {
                    node.previewValue = page.output;
                }
            } else {
                node.previewValue = page.output ?? null;
            }

            const existingMeta = (node.previewMeta && typeof node.previewMeta === 'object')
                ? node.previewMeta
                : {};
            node.previewMeta = {
                ...existingMeta,
                socketId,
                totalCount: Number.isFinite(page.totalCount) ? Number(page.totalCount) : existingMeta.totalCount ?? null,
                loadedCount: Array.isArray(node.previewValue) ? node.previewValue.length : null,
                hasMorePages: page.hasMore === true,
                outputsTruncated: page.hasMore === true,
                maxPreviewItems: existingMeta.maxPreviewItems ?? null,
                pageSize: existingMeta.pageSize ?? null,
                rows: existingMeta.rows ?? null,
                cols: existingMeta.cols ?? null,
                pageUnit: existingMeta.pageUnit ?? null,
                previewEpoch: existingMeta.previewEpoch ?? 0
            };

            if (page.hasMore === true &&
                Array.isArray(page.output) &&
                page.output.length > 0 &&
                this.sessionClient &&
                typeof this.sessionClient.prefetchNodeOutputPage === 'function') {
                const nextOffset = offset + page.output.length;
                const totalCount = Number.isFinite(page.totalCount) ? Number(page.totalCount) : null;
                if (totalCount === null || nextOffset < totalCount) {
                    this.sessionClient.prefetchNodeOutputPage(node.id, socketId, {
                        graphData: this.collectGraphData(),
                        offset: nextOffset,
                        limit
                    }).catch(() => {});
                }
            }

            if (this.previewPanel && this.previewPanel.node &&
                Number(this.previewPanel.node.id) === Number(node.id)) {
                this.previewPanel.refresh(node);
            }
            this.requestRender();
            return true;
        })().finally(() => {
            this.previewPageFetches.delete(fetchKey);
        });

        this.previewPageFetches.set(fetchKey, task);
        return task;
    }

    isPreviewPageFetchInFlight(node, socketId = null) {
        if (!node || !Number.isFinite(node.id) || !this.previewPageFetches) {
            return false;
        }
        const resolvedSocketId = socketId || node?.previewMeta?.socketId || this.getPreferredPreviewSocketId(node);
        if (!resolvedSocketId) return false;
        const requestEpoch = Number(node?.previewMeta?.previewEpoch || 0);
        const prefix = `${Number(node.id)}:${String(resolvedSocketId)}:${requestEpoch}:`;
        for (const key of this.previewPageFetches.keys()) {
            if (key.startsWith(prefix)) return true;
        }
        return false;
    }

    isLikelyTruncatedViewerPayload(payload) {
        if (!isGeometryViewerPayload(payload)) {
            return false;
        }
        const positions = Array.isArray(payload.positions) ? payload.positions : null;
        const previewBudget = DEFAULT_PAGED_PREVIEW_ITEMS;
        if (!positions || !Number.isFinite(previewBudget) || previewBudget <= 0) {
            return false;
        }
        if (payload.outputs_truncated === true) {
            return true;
        }
        const vertexCount = Number.isFinite(payload.vertexCount) ? payload.vertexCount : null;
        if (vertexCount !== null && vertexCount * 3 > positions.length) {
            return true;
        }
        return positions.length === previewBudget;
    }

    openMeshViewer(node) {
        if (!node || node.type !== 'geometry_viewer') {
            return false;
        }
        this.meshViewerPanel.show(node, node.previewValue);
        this.meshViewerPanel.setInteractionLinkStatus(
            this.hasInteractionConnection(node.id)
        );
        if (this.isLikelyTruncatedViewerPayload(node.previewValue)) {
            this.meshViewerPanel.setPreviewStatus('Streaming full geometry...');
            this.fetchFullPreviewForNode(node, { socketId: 'view', silent: true }).catch(() => {});
        } else {
            this.meshViewerPanel.setPreviewStatus('Full geometry loaded');
        }
        return true;
    }

    extractConnectionEndpoints(conn) {
        if (!conn) return null;
        const fromNodeId = Number(conn?.fromNode?.id ?? conn?.from_node);
        const toNodeId = Number(conn?.toNode?.id ?? conn?.to_node);
        const fromSocketId = String(conn?.fromSocket?.id ?? conn?.from_socket ?? '');
        if (!Number.isFinite(fromNodeId) || !Number.isFinite(toNodeId)) return null;
        return { fromNodeId, toNodeId, fromSocketId };
    }

    collectInteractionTargetsFromConnections(nodeId, connections) {
        const sid = Number(nodeId);
        if (!Number.isFinite(sid) || !Array.isArray(connections)) return [];
        const out = new Set();
        for (const conn of connections) {
            const endpoint = this.extractConnectionEndpoints(conn);
            if (!endpoint) continue;
            if (endpoint.fromNodeId !== sid) continue;
            if (endpoint.fromSocketId !== 'interaction') continue;
            out.add(endpoint.toNodeId);
        }
        return [...out];
    }

    hasInteractionConnection(nodeId) {
        return this.getInteractionConnectionTargets(nodeId).length > 0;
    }

    getInteractionConnectionTargets(nodeId) {
        let targets = this.collectInteractionTargetsFromConnections(nodeId, this.connections);
        if (targets.length > 0 || typeof this.collectGraphData !== 'function') {
            return targets;
        }
        const graph = this.collectGraphData();
        const conns = Array.isArray(graph?.connections) ? graph.connections : [];
        targets = this.collectInteractionTargetsFromConnections(nodeId, conns);
        return targets;
    }

    async refreshInteractionStatePreview(node, x, y) {
        // Check if the node has interaction_event in properties but previewValue is empty/outdated
        const hasInteractionEvent = node.interaction_event &&
                                    typeof node.interaction_event === 'object' &&
                                    Object.keys(node.interaction_event).length > 0;

        const hasEmptyPreview = !node.previewValue ||
                               !node.previewValue.payload ||
                               (typeof node.previewValue.payload === 'object' &&
                                Object.keys(node.previewValue.payload).length === 0);

        // If there's interaction data but preview is empty, build preview from properties
        if (hasInteractionEvent && hasEmptyPreview) {
            // Build previewValue directly from the interaction_event in properties
            const event = node.interaction_event;
            const state = (node.interaction_state && typeof node.interaction_state === 'object')
                ? node.interaction_state
                : {};
            node.previewValue = {
                channel: event.channel || '',
                phase: event.phase || '',
                target: event.targetNodeId || node.id,
                version: event.version || 0,
                sourceNodeId: event.sourceNodeId || event.sourceViewerNodeId || -1,
                timestampMs: event.timestampMs || Date.now(),
                event: event,
                payload: event.payload || {},
                committed: {},
                transient: event.payload || {},
                channel_state: {},
                state: state,
                channels: state.channels || {},
                phaseMatched: 1.0
            };

            // Also trigger execution in background to update the actual outputs
            this.flushQueuedGraphPatches(true).catch(err => {
                console.warn('Failed to refresh interaction state:', err);
            });
        }

        // Now show the preview panel
        this.previewPanel.show(node, x, y);
    }

    // 渲染循环（用于性能优化）


    getDefaultShortcutConfig() {
        return {
            version: 1,
            sections: [
                {
                    title: 'Basic Operations',
                    items: [
                        { id: 'open_search', desc: 'Open search menu to add nodes', keys: ['Shift+A'], display: 'Right-click / Shift+A', editable: true },
                        { id: 'edit_node', desc: 'Edit node values', display: 'Double-click node', editable: false },
                        { id: 'drag', desc: 'Connect nodes, move nodes', display: 'Drag', editable: false },
                        { id: 'pan', desc: 'Pan view', display: 'Middle-click drag', editable: false },
                        { id: 'zoom', desc: 'Zoom in/out', display: 'Mouse wheel', editable: false }
                    ]
                },
                {
                    title: 'Selection',
                    items: [
                        { id: 'select_add', desc: 'Add to selection', display: 'Shift+Click', editable: false },
                        { id: 'select_toggle', desc: 'Toggle selection', display: 'Ctrl+Click', editable: false },
                        { id: 'box_select', desc: 'Box select', display: 'Drag empty space', editable: false },
                        { id: 'select_all', desc: 'Select all', keys: ['A'], editable: true },
                        { id: 'deselect_all', desc: 'Deselect all', keys: ['Escape'], editable: true },
                        { id: 'invert_selection', desc: 'Invert selection', keys: ['Ctrl+I'], editable: true }
                    ]
                },
                {
                    title: 'Editing',
                    items: [
                        { id: 'delete_selected', desc: 'Delete selected nodes', keys: ['Delete', 'X'], editable: true },
                        { id: 'copy', desc: 'Copy', keys: ['Ctrl+C'], editable: true },
                        { id: 'cut', desc: 'Cut', keys: ['Ctrl+X'], editable: true },
                        { id: 'paste', desc: 'Paste', keys: ['Ctrl+V'], editable: true },
                        { id: 'duplicate', desc: 'Duplicate (Blender style)', keys: ['Shift+D'], editable: true },
                        { id: 'undo', desc: 'Undo', keys: ['Ctrl+Z'], editable: true },
                        { id: 'redo', desc: 'Redo', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], editable: true }
                    ]
                },
                {
                    title: 'View',
                    items: [
                        { id: 'frame_all', desc: 'Frame all nodes', keys: ['Home'], editable: true },
                        { id: 'frame_selected', desc: 'Frame selected node', keys: ['F'], editable: true },
                        { id: 'reset_view', desc: 'Reset view', keys: ['R'], editable: true },
                        { id: 'toggle_grid', desc: 'Toggle grid snap', keys: ['G'], editable: true },
                        { id: 'toggle_preview', desc: 'Toggle node preview', keys: ['P'], editable: true }
                    ]
                },
                {
                    title: 'Alignment',
                    items: [
                        { id: 'align_left', desc: 'Align left', keys: ['Shift+ArrowLeft'], editable: true },
                        { id: 'align_right', desc: 'Align right', keys: ['Shift+ArrowRight'], editable: true },
                        { id: 'align_top', desc: 'Align top', keys: ['Shift+ArrowUp'], editable: true },
                        { id: 'align_bottom', desc: 'Align bottom', keys: ['Shift+ArrowDown'], editable: true },
                        { id: 'align_center_h', desc: 'Horizontal center align', keys: ['Alt+H'], editable: true },
                        { id: 'align_center_v', desc: 'Vertical center align', keys: ['Alt+V'], editable: true },
                        { id: 'distribute_h', desc: 'Distribute horizontally', keys: ['Alt+D'], editable: true },
                        { id: 'distribute_v', desc: 'Distribute vertically', keys: ['Alt+E'], editable: true }
                    ]
                },
                {
                    title: 'Node Groups',
                    items: [
                        { id: 'create_group', desc: 'Create node group', keys: ['Ctrl+Shift+G'], editable: true },
                        { id: 'ungroup', desc: 'Ungroup nodes', keys: ['Alt+G'], editable: true },
                        { id: 'collapse_group', desc: 'Collapse/expand group', display: 'Double-click group title', editable: false },
                        { id: 'rename_group', desc: 'Rename group', display: 'Ctrl+Click group title', editable: false }
                    ]
                },
                {
                    title: 'Comments',
                    items: [
                        { id: 'add_comment', desc: 'Create comment box', keys: ['Shift+C'], editable: true },
                        { id: 'edit_comment', desc: 'Edit comment text', display: 'Ctrl+Click comment', editable: false }
                    ]
                },
                {
                    title: 'Template Library',
                    items: [
                        { id: 'save_template', desc: 'Save selected nodes as template', keys: ['Ctrl+M'], editable: true },
                        { id: 'open_template_library', desc: 'Open template library', keys: ['Alt+M'], editable: true }
                    ]
                },
                {
                    title: 'Performance',
                    items: [
                        { id: 'toggle_performance', desc: 'Toggle performance metrics', keys: ['Ctrl+Shift+P'], editable: true }
                    ]
                },
                {
                    title: 'Connections',
                    items: [
                        { id: 'redirect_connection', desc: 'Redirect connection', display: 'Click input socket', editable: false },
                        { id: 'disconnect_connection', desc: 'Disconnect', display: 'Alt+Click connection', editable: false }
                    ]
                }
            ]
        };
    }

    cloneShortcutConfig(config) {
        return JSON.parse(JSON.stringify(config));
    }

    getShortcutConfig() {
        return this.shortcutConfig;
    }

    formatShortcutKeys(keys) {
        if (!Array.isArray(keys) || keys.length === 0) return '';
        return keys.join(' / ');
    }

    parseShortcutInput(value) {
        if (!value) return [];
        return value.split(/[,/]/)
            .map(item => item.trim())
            .filter(item => item.length > 0);
    }

    createShortcutHandlers() {
        return {
            undo: () => this.undo(),
            redo: () => this.redo(),
            copy: () => this.copySelected(),
            cut: () => this.cutSelected(),
            paste: () => this.paste(),
            duplicate: () => this.duplicateSelected(),
            delete_selected: () => {
                if (this.selectedComment) {
                    this.deleteComment(this.selectedComment);
                    this.selectedComment = null;
                } else {
                    this.deleteSelected();
                }
            },
            frame_all: () => this.frameAll(),
            frame_selected: () => {
                if (this.selectedNode) {
                    this.frameSelected();
                }
            },
            reset_view: () => this.resetView(),
            toggle_grid: () => this.toggleGridSnap(),
            toggle_preview: () => this.togglePreview(),
            create_group: () => this.createGroup(),
            ungroup: () => this.ungroupSelected(),
            add_comment: () => {
                const centerX = (this.canvas.width / 2 - this.viewOffset.x) / this.viewScale;
                const centerY = (this.canvas.height / 2 - this.viewOffset.y) / this.viewScale;
                this.addComment(centerX - 125, centerY - 50);
            },
            open_search: () => {
                const centerX = this.canvas.width / 2;
                const centerY = this.canvas.height / 2;
                this.searchMenu.show(centerX, centerY);
            },
            select_all: () => this.selectAll(),
            deselect_all: () => this.deselectAll(),
            invert_selection: () => this.invertSelection(),
            align_left: () => this.alignNodes('left'),
            align_right: () => this.alignNodes('right'),
            align_top: () => this.alignNodes('top'),
            align_bottom: () => this.alignNodes('bottom'),
            align_center_h: () => this.alignNodes('center-h'),
            align_center_v: () => this.alignNodes('center-v'),
            distribute_h: () => this.alignNodes('distribute-h'),
            distribute_v: () => this.alignNodes('distribute-v'),
            toggle_performance: () => {
                this.togglePerformanceMetrics();
                document.getElementById('output').textContent =
                    `Performance Metrics: ${this.showPerformanceMetrics ? 'ON' : 'OFF'}\n\n` +
                    'Press Ctrl+Shift+P to toggle performance metrics display.\n' +
                    'Metrics include FPS, render time, and viewport culling statistics.';
            },
            save_template: () => this.saveAsTemplate(),
            open_template_library: () => this.openTemplateLibrary()
        };
    }

    getPreviewBudget() {
        return DEFAULT_PAGED_PREVIEW_ITEMS;
    }

    async loadShortcuts() {
        try {
            const response = await fetch('/shortcuts');
            if (response.ok) {
                const data = await response.json();
                if (data && Array.isArray(data.sections)) {
                    this.shortcutConfigDefault = data;
                    this.shortcutConfig = this.cloneShortcutConfig(data);
                    this.shortcutOverrides = this.buildOverridesFromConfig(data);
                    this.saveShortcutOverrides();
                    this.applyShortcutOverrides();
                    return;
                }
            }
        } catch (error) {
            console.warn('Failed to load shortcuts.json:', error);
        }

        this.loadShortcutOverrides();
        this.applyShortcutOverrides();
    }

    loadShortcutOverrides() {
        try {
            const raw = localStorage.getItem('nodeEditorShortcutOverrides');
            if (raw) {
                this.shortcutOverrides = JSON.parse(raw);
            }
        } catch (error) {
            console.warn('Failed to load shortcut overrides:', error);
            this.shortcutOverrides = {};
        }
    }

    saveShortcutOverrides() {
        try {
            localStorage.setItem(
                'nodeEditorShortcutOverrides',
                JSON.stringify(this.shortcutOverrides)
            );
        } catch (error) {
            console.warn('Failed to save shortcut overrides:', error);
        }
    }

    applyShortcutUpdates(updates) {
        this.shortcutOverrides = {
            ...this.shortcutOverrides,
            ...updates
        };
        this.saveShortcutOverrides();
        this.applyShortcutOverrides();
    }

    resetShortcutsToDefault() {
        this.shortcutOverrides = {};
        this.saveShortcutOverrides();
        this.shortcutConfig = this.cloneShortcutConfig(this.shortcutConfigDefault);
        this.applyShortcutOverrides();
    }

    applyShortcutOverrides() {
        const config = this.cloneShortcutConfig(this.shortcutConfigDefault);
        for (const section of config.sections) {
            for (const item of section.items) {
                if (!item.id) continue;
                if (this.shortcutOverrides[item.id]) {
                    item.keys = this.shortcutOverrides[item.id];
                    if (item.editable) {
                        item.display = this.formatShortcutKeys(item.keys);
                    }
                }
            }
        }
        this.shortcutConfig = config;
        this.buildShortcutActionList();
    }

    buildOverridesFromConfig(config) {
        const overrides = {};
        for (const section of config.sections || []) {
            for (const item of section.items || []) {
                if (!item.id || !Array.isArray(item.keys)) continue;
                overrides[item.id] = item.keys;
            }
        }
        return overrides;
    }

    async saveShortcutsToServer() {
        try {
            const response = await fetch('/shortcuts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.shortcutConfig)
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            document.getElementById('output').textContent =
                'Shortcuts saved to json/config/shortcuts.json and localStorage.';
        } catch (error) {
            console.warn('Failed to save shortcuts.json:', error);
            document.getElementById('output').textContent =
                'Saved to localStorage only (server write failed).';
        }
    }

    buildShortcutActionList() {
        this.shortcutActions = [];
        for (const section of this.shortcutConfig.sections || []) {
            for (const item of section.items || []) {
                if (!item.id || !Array.isArray(item.keys)) continue;
                const normalized = item.keys
                    .map(key => this.normalizeCombo(key))
                    .filter(key => key);
                if (normalized.length === 0) continue;
                if (!this.shortcutHandlers[item.id]) continue;
                this.shortcutActions.push({
                    id: item.id,
                    keys: normalized
                });
            }
        }
    }

    matchShortcutEvent(e) {
        const combo = this.eventToCombo(e);
        if (!combo) return null;
        for (const action of this.shortcutActions) {
            if (action.keys.includes(combo)) {
                return action.id;
            }
        }
        return null;
    }

    normalizeCombo(combo) {
        if (!combo) return null;
        const raw = combo.split('+').map(part => part.trim()).filter(Boolean);
        const mods = [];
        let key = null;
        for (const part of raw) {
            const upper = part.toLowerCase();
            if (upper === 'ctrl' || upper === 'control') {
                mods.push('Ctrl');
            } else if (upper === 'shift') {
                mods.push('Shift');
            } else if (upper === 'alt') {
                mods.push('Alt');
            } else if (upper === 'meta' || upper === 'cmd' || upper === 'command') {
                mods.push('Meta');
            } else {
                key = this.normalizeKeyName(part);
            }
        }
        if (!key) return null;
        const ordered = [];
        if (mods.includes('Ctrl')) ordered.push('Ctrl');
        if (mods.includes('Shift')) ordered.push('Shift');
        if (mods.includes('Alt')) ordered.push('Alt');
        if (mods.includes('Meta')) ordered.push('Meta');
        ordered.push(key);
        return ordered.join('+');
    }

    normalizeKeyName(key) {
        if (!key) return null;
        const name = key === ' ' ? 'Space' : key;
        if (name.length === 1) {
            return name.toUpperCase();
        }
        const lower = name.toLowerCase();
        if (lower === 'esc') return 'Escape';
        if (lower === 'del') return 'Delete';
        if (lower === 'left') return 'ArrowLeft';
        if (lower === 'right') return 'ArrowRight';
        if (lower === 'up') return 'ArrowUp';
        if (lower === 'down') return 'ArrowDown';
        if (lower === 'arrowleft') return 'ArrowLeft';
        if (lower === 'arrowright') return 'ArrowRight';
        if (lower === 'arrowup') return 'ArrowUp';
        if (lower === 'arrowdown') return 'ArrowDown';
        if (lower === 'home') return 'Home';
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    eventToCombo(e) {
        const key = this.normalizeKeyName(e.key);
        if (!key) return null;
        if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
            return null;
        }
        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');
        if (e.metaKey) parts.push('Meta');
        parts.push(key);
        return parts.join('+');
    }

    async loadNodeTypes() {
        try {
            const response = await fetch('/json/generated/node_types.json');
            const data = await response.json();
            this.nodeTypes = applyNodePreviewContracts(data.nodeTypes);

            // Create lookup map
            for (const nodeType of this.nodeTypes) {
                this.nodeTypeMap[nodeType.id] = nodeType;
            }
            this.nodeEditors = this.createNodeEditors();

            console.log('Loaded node types:', this.nodeTypes.map(t => t.name).join(', '));
        } catch (error) {
            console.error('Failed to load node types:', error);
            document.getElementById('output').textContent =
                'Error: Could not load node types configuration.\n' +
                'Make sure json/generated/node_types.json exists.';
        }
    }

    showWelcomeMessage() {
        document.getElementById('output').textContent =
            'Welcome to Node Graph Processor v2.0!\n\n' +
            'Instructions:\n' +
            '- Right-click or Shift+A: Open search menu to add nodes\n' +
            '- Type to filter nodes, use arrow keys to navigate\n' +
            '- Double-click nodes to edit values\n' +
            '- Drag from output (green) to input (blue) to connect\n' +
            '- Click input socket to redirect existing connection\n' +
            '- Alt+Click connection to disconnect\n' +
            '- Middle-click to pan view\n' +
            '- Mouse wheel to zoom in/out\n' +
            '- Drag on empty space to box select\n' +
            '- G: Toggle grid snap (currently ON)\n' +
            '- Shift+Click: Add to selection\n' +
            '- Ctrl+Click: Toggle selection\n' +
            '- A: Select all\n' +
            '- Escape: Deselect all\n' +
            '- Ctrl+I: Invert selection\n' +
            '- Delete or X: Delete selected nodes\n' +
            '- Ctrl+C: Copy selected nodes\n' +
            '- Ctrl+X: Cut selected nodes\n' +
            '- Ctrl+V: Paste nodes\n' +
            '- Shift+D: Duplicate selected nodes\n' +
            '- Ctrl+Z: Undo\n' +
            '- Ctrl+Shift+Z or Ctrl+Y: Redo\n' +
            '- Home: Frame all nodes\n' +
            '- F: Frame selected node\n' +
            '- R: Reset view\n' +
            '- Ctrl+Shift+P: Toggle performance metrics\n' +
            '- Ctrl+M: Save selected nodes as template\n' +
            '- Alt+M: Open template library\n' +
            '- Graph executes automatically after changes\n' +
            '- Node/connection colors indicate success (blue) or error (red)\n\n' +
            'Ready to start!';
    }

    resize() {
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
        this.requestRender();
    }

    addNode(type, x, y) {
        const config = this.nodeTypeMap[type];
        if (!config) {
            console.error('Unknown node type:', type);
            return null;
        }

        // Guard against stale counter after load/undo/session mismatch.
        // A duplicate id would make backend treat add_node as existing node,
        // which can trigger unexpected downstream recomputation.
        let maxExistingId = -1;
        for (const n of this.nodes) {
            if (Number.isFinite(n?.id) && n.id > maxExistingId) {
                maxExistingId = n.id;
            }
        }
        if (!Number.isFinite(this.nodeIdCounter) || this.nodeIdCounter <= maxExistingId) {
            this.nodeIdCounter = maxExistingId + 1;
        }

        const rect = this.canvas.getBoundingClientRect();
        const canvasX = x - rect.left;
        const canvasY = y - rect.top;

        // 转换为世界坐标
        let worldX = (canvasX - this.viewOffset.x) / this.viewScale;
        let worldY = (canvasY - this.viewOffset.y) / this.viewScale;

        // 应用网格吸附
        if (this.gridSnap) {
            worldX = this.snapToGrid(worldX);
            worldY = this.snapToGrid(worldY);
        }

        const node = new Node(this.nodeIdCounter++, type, worldX, worldY, config);
        this.ensureNodeValues(node);
        this.nodes.push(node);
        this.selectedNodes.clear();
        this.selectedNodes.add(node);
        this.selectedNode = node;
        this.saveHistory(`Add ${config.name} Node`);
        this.requestRender();
        if (!this.sessionClient.hasSession()) {
            this.executeGraphOnSession(this.collectGraphData(), { execute: true })
                .then(async (resp) => {
                    if (!resp) {
                        return;
                    }
                    let payload = null;
                    try {
                        payload = await resp.json();
                    } catch (_) {
                        return;
                    }
                    if (!resp.ok) {
                        const details = payload?.message || payload?.error || 'Unknown error';
                        document.getElementById('output').textContent =
                            `Execution errors:\n\nAdd node failed: ${details}`;
                        return;
                    }
                    this.applyExecutionResult(payload);
                })
                .catch((error) => {
                    document.getElementById('output').textContent =
                        `Execution errors:\n\nAdd node request failed: ${error?.message || String(error)}`;
                });
            return node;
        }
        const previewSocketId = this.getPreferredPreviewSocketId(node);
        this.dispatchGraphPatches([{
            op: 'add_node',
            node: this.serializeNodeForPatch(node)
        }], {
            // Execute incrementally so the new node gets status/preview immediately.
            // With add_node affected set, backend should compute only this node.
            execute: true,
            fullResults: false,
            silentResult: false,
            executionOptions: {
                omitOutputs: false,
                outputNodeIds: [node.id],
                outputSockets: previewSocketId
                    ? { [String(node.id)]: [previewSocketId] }
                    : {}
            }
        }).then(async (resp) => {
            if (!resp) {
                return;
            }
            let payload = null;
            try {
                payload = await resp.json();
            } catch (_) {
                return;
            }
            if (!resp.ok) {
                const details = payload?.message || payload?.error || 'Unknown error';
                document.getElementById('output').textContent =
                    `Execution errors:\n\nAdd node failed: ${details}`;
                return;
            }
            const deltaIds = Array.isArray(payload?.deltas)
                ? payload.deltas.map((d) => Number(d?.id)).filter(Number.isFinite)
                : [];
            if (!deltaIds.includes(node.id)) {
                // Fallback: if incremental add_node did not return this node, force
                // one regular execution so the UI cannot get stuck in a no-op state.
                this.requestExecutionRefresh({ immediate: true });
            }
        }).catch((error) => {
            document.getElementById('output').textContent =
                `Execution errors:\n\nAdd node request failed: ${error?.message || String(error)}`;
        });
        return node;
    }

    scheduleAutoExecute(delayMs = null) {
        if (!this.autoExecuteEnabled) return;
        const pendingPatches = this.patchQueue.getPendingPatches();
        if (!this.patchBatchTriggersAutoExecute(pendingPatches)) return;

        this.patchQueue.cancelScheduledFlush();

        if (this.executeTimeout) {
            clearTimeout(this.executeTimeout);
        }

        const delay = Number.isFinite(delayMs)
            ? Math.max(0, Number(delayMs))
            : 180;
        this.executeTimeout = setTimeout(() => {
            this.flushQueuedGraphPatches(true).catch(() => {});
        }, delay);
    }

    requestExecutionRefresh(options = {}) {
        const immediate = options.immediate === true;
        const delayMs = Number.isFinite(options.delayMs) ? Number(options.delayMs) : null;
        if (immediate) {
            this.executeGraph(options).catch(() => {});
            return;
        }
        if (this.patchBatchTriggersAutoExecute(this.patchQueue.getPendingPatches())) {
            this.scheduleAutoExecute(delayMs);
            return;
        }
        this.executeGraph(options).catch(() => {});
    }

    onContextMenu(e) {
        e.preventDefault();
        this.searchMenu.show(e.clientX, e.clientY);
    }

    // 显示工具提示
    showTooltip(x, y, text) {
        this.hideTooltip();

        this.tooltip = document.createElement('div');
        this.tooltip.className = 'tooltip';
        this.tooltip.textContent = text;
        this.tooltip.style.left = x + 'px';
        this.tooltip.style.top = (y + 20) + 'px';
        document.body.appendChild(this.tooltip);
    }

    // 隐藏工具提示
    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }
        if (this.tooltipTimeout) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
    }

    // 网格吸附
    snapToGrid(value) {
        if (!this.gridSnap) return value;
        return Math.round(value / this.gridSize) * this.gridSize;
    }

    // 切换网格吸附
    toggleGridSnap() {
        this.gridSnap = !this.gridSnap;
        document.getElementById('output').textContent =
            `Grid snap: ${this.gridSnap ? 'ON' : 'OFF'}\n` +
            `Grid size: ${this.gridSize}px`;
        this.requestRender(); // 立即刷新界面
    }

    togglePreview() {
        this.showPreview = !this.showPreview;
        // 更新所有节点的预览显示状态
        this.nodes.forEach(node => {
            node.showPreview = this.showPreview;
        });
        document.getElementById('output').textContent =
            `Node preview: ${this.showPreview ? 'ON' : 'OFF'}`;
        this.requestRender();
    }

    // 对齐选中的节点
    alignNodes(type) {
        if (this.selectedNodes.size < 2) {
            document.getElementById('output').textContent =
                'Please select at least 2 nodes to align';
            return;
        }

        this.saveHistory();

        const nodes = Array.from(this.selectedNodes);

        switch(type) {
            case 'left':
                // 对齐到最左边的节点
                const minX = Math.min(...nodes.map(n => n.x));
                nodes.forEach(n => n.x = minX);
                break;

            case 'right':
                // 对齐到最右边的节点
                const maxRight = Math.max(...nodes.map(n => n.x + n.width));
                nodes.forEach(n => n.x = maxRight - n.width);
                break;

            case 'top':
                // 对齐到最上边的节点
                const minY = Math.min(...nodes.map(n => n.y));
                nodes.forEach(n => n.y = minY);
                break;

            case 'bottom':
                // 对齐到最下边的节点
                const maxBottom = Math.max(...nodes.map(n => n.y + n.height));
                nodes.forEach(n => n.y = maxBottom - n.height);
                break;

            case 'center-h':
                // 水平居中对齐
                const avgX = nodes.reduce((sum, n) => sum + n.x + n.width/2, 0) / nodes.length;
                nodes.forEach(n => n.x = avgX - n.width/2);
                break;

            case 'center-v':
                // 垂直居中对齐
                const avgY = nodes.reduce((sum, n) => sum + n.y + n.height/2, 0) / nodes.length;
                nodes.forEach(n => n.y = avgY - n.height/2);
                break;

            case 'distribute-h':
                // 水平均匀分布
                if (nodes.length < 3) {
                    document.getElementById('output').textContent =
                        'Need at least 3 nodes to distribute';
                    return;
                }
                nodes.sort((a, b) => a.x - b.x);
                const leftmost = nodes[0].x;
                const rightmost = nodes[nodes.length - 1].x + nodes[nodes.length - 1].width;
                const totalWidth = nodes.reduce((sum, n) => sum + n.width, 0);
                const spacing = (rightmost - leftmost - totalWidth) / (nodes.length - 1);
                let currentX = leftmost;
                nodes.forEach(n => {
                    n.x = currentX;
                    currentX += n.width + spacing;
                });
                break;

            case 'distribute-v':
                // 垂直均匀分布
                if (nodes.length < 3) {
                    document.getElementById('output').textContent =
                        'Need at least 3 nodes to distribute';
                    return;
                }
                nodes.sort((a, b) => a.y - b.y);
                const topmost = nodes[0].y;
                const bottommost = nodes[nodes.length - 1].y + nodes[nodes.length - 1].height;
                const totalHeight = nodes.reduce((sum, n) => sum + n.height, 0);
                const vspacing = (bottommost - topmost - totalHeight) / (nodes.length - 1);
                let currentY = topmost;
                nodes.forEach(n => {
                    n.y = currentY;
                    currentY += n.height + vspacing;
                });
                break;
        }

        // 应用网格吸附
        if (this.gridSnap) {
            nodes.forEach(n => {
                n.x = Math.round(n.x / this.gridSize) * this.gridSize;
                n.y = Math.round(n.y / this.gridSize) * this.gridSize;
            });
        }

        document.getElementById('output').textContent =
            `Aligned ${nodes.length} nodes: ${type}`;
        this.requestRender();
    }

    // 创建节点组
    createGroup() {
        if (this.selectedNodes.size === 0) {
            document.getElementById('output').textContent =
                'Please select nodes to create a group';
            return;
        }

        // 只允许未属于任何组的节点创建新组
        for (let node of this.selectedNodes) {
            if (node.group) {
                document.getElementById('output').textContent =
                    'Only ungrouped nodes can be grouped';
                return;
            }
        }

        this.saveHistory();

        const group = new NodeGroup(0, 0, 200, 150, `Group ${this.groups.length + 1}`);

        // 添加选中的节点到组
        for (let node of this.selectedNodes) {
            group.addNode(node);
        }

        // 更新组边界
        group.updateBounds();

        this.groups.push(group);

        document.getElementById('output').textContent =
            `Created group with ${group.nodes.size} nodes`;
        this.requestRender();
    }

    // 解散组
    ungroupSelected() {
        const groupsToRemove = [];

        // 找到选中节点所属的组
        for (let node of this.selectedNodes) {
            if (node.group && !groupsToRemove.includes(node.group)) {
                groupsToRemove.push(node.group);
            }
        }

        if (groupsToRemove.length === 0) {
            document.getElementById('output').textContent =
                'No groups to ungroup';
            return;
        }

        this.saveHistory();

        // 移除组
        for (let group of groupsToRemove) {
            // 恢复节点可见性
            for (let node of group.nodes) {
                node.visible = true;
                node.group = null;
            }
            this.groups = this.groups.filter(g => g !== group);
        }

        document.getElementById('output').textContent =
            `Ungrouped ${groupsToRemove.length} group(s)`;
        this.requestRender();
    }

    // 添加注释框
    addComment(x, y) {
        const comment = new CommentBox(x, y, 'Add your comment here...', 250, 100);
        this.comments.push(comment);
        this.saveHistory('Add Comment');
        this.requestRender();

        // 立即打开编辑对话框
        setTimeout(() => {
            const newText = prompt('Enter comment text:', comment.text);
            if (newText !== null) {
                comment.text = newText;
                this.requestRender();
            }
        }, 100);
    }

    // 删除注释框
    deleteComment(comment) {
        this.comments = this.comments.filter(c => c !== comment);
        this.saveHistory('Delete Comment');
        this.requestRender();
    }

    // 检查点是否在连接线附近





    // 更新工具提示




    // 保存当前状态到历史记录


    // 从历史记录恢复状态


    // 撤销


    // 重做


    clear() {
        this.nodes = [];
        this.connections = [];
        this.groups = [];
        this.comments = [];
        this.selectedNode = null;
        this.selectedNodes.clear();
        this.selectedComment = null;
        this.saveHistory('Clear All');
        this.requestRender();
        this.showWelcomeMessage();
    }

    // 请求重新渲染（用于性能优化）


    // 检查节点是否在视口内（用于视口剔除）


    // 检查连接线是否在视口内


    // 切换性能指标显示






    updateNodeFromExecution(node, nodeResult, errorLines) {
        return this.resultApplier.updateNodeFromExecution(node, nodeResult, errorLines);
    }

    applyExecutionResult(result, options = {}) {
        return this.resultApplier.applyExecutionResult(result, options);
    }

    async executeGraph(options = {}) {
        if (this.nodes.length === 0) return;

        try {
            let response = null;
            if (this.patchQueue.hasPendingPatches()) {
                const pendingPatches = this.patchQueue.getPendingPatches();
                const shouldExecuteIncrementally =
                    this.patchBatchTriggersAutoExecute(pendingPatches);
                response = await this.flushQueuedGraphPatches(shouldExecuteIncrementally);
                if (!shouldExecuteIncrementally) {
                    const graphData = this.collectGraphData();
                    response = await this.executeGraphOnSession(graphData);
                }
            }
            if (!response) {
                const graphData = this.collectGraphData();
                response = await this.executeGraphOnSession(graphData);
            }

            const result = await response.json();

            if (result) {
                this.applyExecutionResult(result, { silent: options.silentResult === true });
            }
        } catch (error) {
            document.getElementById('output').textContent =
                'Connection Error!\n\n' +
                'Could not connect to server at http://localhost:3000\n\n' +
                'Please make sure the server is running:\n' +
                '  cd Server\n' +
                '  npm start';
        }
    }

    cloneJsonValue(value) {
        if (value === undefined) return undefined;
        if (value === null) return null;
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
            return value;
        }
        if (Array.isArray(value)) {
            return value.map(item => this.cloneJsonValue(item));
        }
        if (typeof value === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(value)) {
                const cloned = this.cloneJsonValue(v);
                if (cloned !== undefined) out[k] = cloned;
            }
            return out;
        }
        return String(value);
    }

    serializeNodeForPatch(node) {
        const properties = {};
        const propertyDefs = node?.config?.properties || {};
        for (const key of Object.keys(propertyDefs)) {
            const value = this.cloneJsonValue(node[key]);
            if (value !== undefined) {
                properties[key] = value;
            }
        }
        return {
            id: node.id,
            type: node.type,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            properties,
            // Legacy compatibility fields.
            value: this.cloneJsonValue(node.value),
            operation: this.cloneJsonValue(node.operation),
            label: this.cloneJsonValue(node.label),
            text: this.cloneJsonValue(node.text),
            values: this.cloneJsonValue(node.values)
        };
    }

    collectGraphData() {
        return {
            schemaVersion: 2,
            meta: {
                savedAt: new Date().toISOString(),
                nodeIdCounter: this.nodeIdCounter
            },
            view: {
                offsetX: this.viewOffset.x,
                offsetY: this.viewOffset.y,
                scale: this.viewScale
            },
            nodes: this.nodes.map(node => {
                const properties = {};
                const propertyDefs = node.config?.properties || {};
                for (const key of Object.keys(propertyDefs)) {
                    const value = this.cloneJsonValue(node[key]);
                    if (value !== undefined) {
                        properties[key] = value;
                    }
                }
                return {
                    id: node.id,
                    type: node.type,
                    x: node.x,
                    y: node.y,
                    width: node.width,
                    height: node.height,
                    properties,
                    // Legacy fields for backward compatibility with old loader/processor format.
                    value: this.cloneJsonValue(node.value),
                    operation: this.cloneJsonValue(node.operation),
                    label: this.cloneJsonValue(node.label),
                    text: this.cloneJsonValue(node.text),
                    values: this.cloneJsonValue(node.values)
                };
            }),
            groups: this.groups.map(group => ({
                title: group.title,
                x: group.x,
                y: group.y,
                width: group.width,
                height: group.height,
                color: group.color,
                collapsed: group.collapsed,
                expandedWidth: group.expandedWidth,
                expandedHeight: group.expandedHeight,
                collapsedWidth: group.collapsedWidth,
                collapsedHeight: group.collapsedHeight,
                nodeIds: Array.from(group.nodes).map(node => node.id)
            })),
            comments: this.comments.map(comment => ({
                x: comment.x,
                y: comment.y,
                width: comment.width,
                height: comment.height,
                text: comment.text,
                color: comment.color,
                fontSize: comment.fontSize
            })),
            connections: this.connections.map(conn => ({
                from_node: conn.fromNode.id,
                from_socket: conn.fromSocket.id,
                to_node: conn.toNode.id,
                to_socket: conn.toSocket.id
            }))
        };
    }

    applyGraphData(graphData, options = {}) {
        const safeGraph = graphData && typeof graphData === 'object' ? graphData : {};
        if (options.resetSession !== false) {
            this.resetGraphSession();
        } else {
            this.patchQueue.clear();
            this.queuedExecutionOptions.clear();
        }
        this.clear();

        const nodeMap = new Map();
        let hasAllPositions = true;
        const nodes = Array.isArray(safeGraph.nodes) ? safeGraph.nodes : [];
        for (const nodeData of nodes) {
            const config = this.nodeTypeMap[nodeData.type];
            if (!config) continue;

            const hasPos = Number.isFinite(nodeData.x) && Number.isFinite(nodeData.y);
            const node = new Node(
                nodeData.id,
                nodeData.type,
                hasPos ? nodeData.x : 100,
                hasPos ? nodeData.y : 100,
                config
            );

            const propertyDefs = config.properties || {};
            for (const key of Object.keys(propertyDefs)) {
                if (nodeData.properties && Object.prototype.hasOwnProperty.call(nodeData.properties, key)) {
                    node[key] = nodeData.properties[key];
                } else if (Object.prototype.hasOwnProperty.call(nodeData, key)) {
                    node[key] = nodeData[key];
                }
            }
            this.ensureNodeValues(node);

            if (Number.isFinite(nodeData.width)) node.width = nodeData.width;
            if (Number.isFinite(nodeData.height)) node.height = nodeData.height;
            this.nodes.push(node);
            nodeMap.set(nodeData.id, node);
            if (nodeData.id >= this.nodeIdCounter) {
                this.nodeIdCounter = nodeData.id + 1;
            }
            if (!hasPos) {
                hasAllPositions = false;
            }
        }

        if (!hasAllPositions) {
            let x = 100, y = 100;
            for (const node of this.nodes) {
                node.x = x;
                node.y = y;
                x += 250;
                if (x > 800) {
                    x = 100;
                    y += 200;
                }
            }
        }

        if (Array.isArray(safeGraph.groups)) {
            for (const groupData of safeGraph.groups) {
                const group = new NodeGroup(
                    groupData.x ?? 0,
                    groupData.y ?? 0,
                    groupData.width ?? 200,
                    groupData.height ?? 150,
                    groupData.title ?? 'Group'
                );
                group.color = groupData.color || group.color;
                group.collapsed = !!groupData.collapsed;
                group.expandedWidth = groupData.expandedWidth ?? group.expandedWidth;
                group.expandedHeight = groupData.expandedHeight ?? group.expandedHeight;
                group.collapsedWidth = groupData.collapsedWidth ?? group.collapsedWidth;
                group.collapsedHeight = groupData.collapsedHeight ?? group.collapsedHeight;

                if (Array.isArray(groupData.nodeIds)) {
                    for (const nodeId of groupData.nodeIds) {
                        const node = nodeMap.get(nodeId);
                        if (!node) continue;
                        group.addNode(node);
                        if (group.collapsed) {
                            node.visible = false;
                            group.savedNodePositions.set(node, {
                                offsetX: node.x - group.x,
                                offsetY: node.y - group.y
                            });
                        }
                    }
                }
                this.groups.push(group);
            }
        }

        if (Array.isArray(safeGraph.comments)) {
            for (const c of safeGraph.comments) {
                const comment = new CommentBox(
                    Number.isFinite(c.x) ? c.x : 100,
                    Number.isFinite(c.y) ? c.y : 100,
                    typeof c.text === 'string' ? c.text : 'Comment',
                    Number.isFinite(c.width) ? c.width : 250,
                    Number.isFinite(c.height) ? c.height : 100
                );
                if (typeof c.color === 'string') comment.color = c.color;
                if (Number.isFinite(c.fontSize)) comment.fontSize = c.fontSize;
                this.comments.push(comment);
            }
        }

        const connections = Array.isArray(safeGraph.connections) ? safeGraph.connections : [];
        for (const connData of connections) {
            const fromNode = nodeMap.get(connData.from_node);
            const toNode = nodeMap.get(connData.to_node);
            if (!fromNode || !toNode) continue;
            const fromSocket = fromNode.outputs.find(s => s.id === connData.from_socket);
            const toSocket = toNode.inputs.find(s => s.id === connData.to_socket);
            if (!fromSocket || !toSocket) continue;
            const conn = new Connection(fromNode, fromSocket, toNode, toSocket);
            this.connections.push(conn);
            toSocket.connection = conn;
        }

        if (safeGraph.view && typeof safeGraph.view === 'object') {
            if (Number.isFinite(safeGraph.view.offsetX)) this.viewOffset.x = safeGraph.view.offsetX;
            if (Number.isFinite(safeGraph.view.offsetY)) this.viewOffset.y = safeGraph.view.offsetY;
            if (Number.isFinite(safeGraph.view.scale)) {
                this.viewScale = Math.max(this.minScale, Math.min(this.maxScale, safeGraph.view.scale));
            }
        }

        const metaCounter = safeGraph.meta?.nodeIdCounter;
        if (Number.isFinite(metaCounter)) {
            this.nodeIdCounter = Math.max(this.nodeIdCounter, metaCounter);
        }

    }

    resetGraphSession() {
        this.sessionClient.resetSession();
        this.patchQueue.clear();
        this.queuedExecutionOptions.clear();
    }

    async executeGraphOnSession(graphData, options = {}) {
        return this.sessionClient.executeGraph(graphData, options);
    }

    async syncGraphSession() {
        if (!this.sessionClient.hasSession()) return null;
        return this.executeGraphOnSession(this.collectGraphData(), { execute: false });
    }

    coalescePatchBatch(patches) {
        return coalescePatchBatch(patches);
    }

    patchBatchTriggersAutoExecute(patches) {
        return patchBatchTriggersAutoExecute(patches);
    }

    enqueueGraphPatches(patches, options = {}) {
        const list = Array.isArray(patches) ? patches : [];
        if (list.length === 0) return;
        const execute = options.execute === true;
        if (execute) {
            this.dispatchGraphPatches(this.coalescePatchBatch(list), options);
            return;
        }
        this.queuedExecutionOptions.queue(options.executionOptions || null);
        this.patchQueue.enqueue(list, {
            debounceMs: options.debounceMs,
            flushExecute: options.flushExecute === true,
            onFlush: (flushExecute) => {
                this.flushQueuedGraphPatches(flushExecute);
            }
        });
    }

    async flushQueuedGraphPatches(execute = false) {
        const batch = this.patchQueue.consumePending();
        const executionOptions = this.queuedExecutionOptions.consume();
        if (!Array.isArray(batch) || batch.length === 0) {
            return null;
        }
        return this.dispatchGraphPatches(batch, {
            execute: !!execute,
            executionOptions
        });
    }

    async dispatchGraphPatches(patches, options = {}) {
        const list = Array.isArray(patches) ? patches : [];
        if (list.length === 0) return null;
        const execute = options.execute !== false &&
            (options.forceExecute === true || this.patchBatchTriggersAutoExecute(list));
        const fullResults = options.fullResults === true;
        const executionOptions = this.mergeExecutionOptions(
            this.getIncrementalExecutionOptions(),
            options.executionOptions || null
        );
        this.lastPreviewTrace = {
            stage: 'patch_dispatch',
            patches: list.map((patch) => ({
                op: patch?.op || '',
                nodeId: Number.isFinite(patch?.nodeId) ? Number(patch.nodeId) : null,
                key: typeof patch?.key === 'string' ? patch.key : null
            })),
            execute,
            previewPanelNodeId: Number.isFinite(this.previewPanel?.node?.id) ? Number(this.previewPanel.node.id) : null,
            selectedNodeId: Number.isFinite(this.selectedNode?.id) ? Number(this.selectedNode.id) : null,
            outputNodeIds: Array.isArray(executionOptions.outputNodeIds) ? executionOptions.outputNodeIds.slice() : [],
            outputSockets: executionOptions.outputSockets || {}
        };
        const resp = await this.sessionClient.dispatchGraphPatches(list, {
            graphData: this.collectGraphData(),
            execute,
            fullResults,
            executionOptions,
            retry: options.retry
        });

        if (resp.ok) {
            try {
                const payload = await resp.clone().json();
                this.lastPreviewTrace = {
                    ...this.lastPreviewTrace,
                    stage: 'patch_response',
                    responseVersion: Number.isFinite(payload?.version) ? Number(payload.version) : null,
                    deltaNodeIds: Array.isArray(payload?.deltas)
                        ? payload.deltas.map((d) => Number(d?.id)).filter(Number.isFinite)
                        : [],
                    previewNodeDelta: Array.isArray(payload?.deltas)
                        ? payload.deltas.find((d) => Number(d?.id) === Number(this.previewPanel?.node?.id))
                        : null
                };
                if (execute) {
                    this.applyExecutionResult(payload, { silent: options.silentResult === true });
                }
            } catch (_) {
            }
        }
        return resp;
    }

    mergeExecutionOptions(baseOptions, overrideOptions) {
        const base = (baseOptions && typeof baseOptions === 'object') ? baseOptions : {};
        const override = (overrideOptions && typeof overrideOptions === 'object') ? overrideOptions : null;

        const mergedOutputNodeIds = new Set(
            Array.isArray(base.outputNodeIds) ? base.outputNodeIds : []
        );
        const mergedOutputSockets = {};
        const mergeSockets = (source) => {
            if (!source || typeof source !== 'object') return;
            for (const [key, value] of Object.entries(source)) {
                if (!Array.isArray(value)) continue;
                if (!Array.isArray(mergedOutputSockets[key])) {
                    mergedOutputSockets[key] = [];
                }
                for (const socketId of value) {
                    if (typeof socketId !== 'string' || socketId.length === 0) continue;
                    if (!mergedOutputSockets[key].includes(socketId)) {
                        mergedOutputSockets[key].push(socketId);
                    }
                }
            }
        };
        mergeSockets(base.outputSockets);

        if (!override) {
            return {
                ...base,
                outputNodeIds: [...mergedOutputNodeIds],
                outputSockets: mergedOutputSockets
            };
        }

        for (const id of Array.isArray(override.outputNodeIds) ? override.outputNodeIds : []) {
            if (Number.isFinite(id)) {
                mergedOutputNodeIds.add(Number(id));
            }
        }
        mergeSockets(override.outputSockets);

        return {
            ...base,
            ...override,
            outputNodeIds: [...mergedOutputNodeIds],
            outputSockets: mergedOutputSockets,
            omitOutputs: override.omitOutputs === true
                ? true
                : (mergedOutputNodeIds.size === 0 && base.omitOutputs === true)
        };
    }

    getIncrementalExecutionOptions() {
        return buildIncrementalExecutionOptions(this);
    }

    getPreferredPreviewSocketId(node) {
        return getPreferredPreviewSocketId(node);
    }

    async saveGraph() {
        const graphData = this.collectGraphData();
        const dataStr = JSON.stringify(graphData, null, 2);

        try {
            if (typeof window.showSaveFilePicker === 'function') {
                const handle = await window.showSaveFilePicker({
                    suggestedName: 'graph_input.json',
                    types: [{
                        description: 'JSON Files',
                        accept: { 'application/json': ['.json'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(dataStr);
                await writable.close();
                document.getElementById('output').textContent = 'Graph saved successfully.';
                return;
            }
        } catch (error) {
            if (error && error.name === 'AbortError') {
                return;
            }
            console.warn('showSaveFilePicker failed, fallback to download:', error);
        }

        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'graph_input.json';
        a.click();
        URL.revokeObjectURL(url);
        document.getElementById('output').textContent = 'Graph saved as downloaded file graph_input.json.';
    }

    async loadGraph() {
        const parseAndApply = async (text) => {
            const graphData = JSON.parse(text);
            this.applyGraphData(graphData);
            this.requestRender();
            this.saveHistory('Load Graph');
            document.getElementById('output').textContent = 'Graph loaded successfully!';
            this.requestExecutionRefresh({ immediate: true });
        };

        try {
            if (typeof window.showOpenFilePicker === 'function') {
                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{
                        description: 'JSON Files',
                        accept: { 'application/json': ['.json'] }
                    }]
                });
                if (!handle) return;
                const file = await handle.getFile();
                const text = await file.text();
                await parseAndApply(text);
                return;
            }
        } catch (error) {
            if (error && error.name === 'AbortError') {
                return;
            }
            console.warn('showOpenFilePicker failed, fallback to file input:', error);
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                await parseAndApply(text);
            } catch (error) {
                document.getElementById('output').textContent = 'Error loading graph: ' + error.message;
            }
        };
        input.click();
    }

    onKeyDown(e) {
        if (this.isEditingShortcuts) {
            return;
        }

        if (this.searchMenu && this.searchMenu.menu) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.searchMenu.hide();
            }
            return;
        }

        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
            return;
        }

        const actionId = this.matchShortcutEvent(e);
        if (!actionId) {
            return;
        }

        const handler = this.shortcutHandlers[actionId];
        if (handler) {
            e.preventDefault();
            handler(e);
        }
    }

    onKeyUp(e) {
        // 预留给其他快捷键
    }

    // 全选
    selectAll() {
        this.selectedNodes.clear();
        for (let node of this.nodes) {
            this.selectedNodes.add(node);
        }
        this.selectedNode = this.nodes.length > 0 ? this.nodes[0] : null;
        this.requestRender();
    }

    // 取消选择
    deselectAll() {
        this.selectedNodes.clear();
        this.selectedNode = null;
        this.requestRender();
    }

    // 反选
    invertSelection() {
        const newSelection = new Set();
        for (let node of this.nodes) {
            if (!this.selectedNodes.has(node)) {
                newSelection.add(node);
            }
        }
        this.selectedNodes = newSelection;
        this.selectedNode = this.selectedNodes.size > 0 ?
            Array.from(this.selectedNodes)[0] : null;
        this.requestRender();
    }

    // 删除选中的节点
    deleteSelected() {
        if (this.selectedNodes.size === 0) return;

        this.saveHistory(`Delete ${this.selectedNodes.size} Node(s)`);
        const selectedNodeIds = new Set(
            Array.from(this.selectedNodes)
                .map(node => Number(node?.id))
                .filter(Number.isFinite)
        );
        const patches = [];
        for (const conn of this.connections) {
            const fromSelected = selectedNodeIds.has(Number(conn.fromNode?.id));
            const toSelected = selectedNodeIds.has(Number(conn.toNode?.id));
            if (!fromSelected && !toSelected) continue;
            patches.push({
                op: 'remove_connection',
                from_node: conn.fromNode.id,
                from_socket: conn.fromSocket.id,
                to_node: conn.toNode.id,
                to_socket: conn.toSocket.id
            });
        }
        for (const node of this.selectedNodes) {
            const downstreamNodeIds = this.connections
                .filter(conn => Number(conn.fromNode?.id) === Number(node.id) &&
                    Number(conn.toNode?.id) !== Number(node.id))
                .map(conn => Number(conn.toNode.id))
                .filter(Number.isFinite);
            patches.push({
                op: 'remove_node',
                nodeId: node.id,
                downstreamNodeIds: [...new Set(downstreamNodeIds)]
            });
        }

        // 收集受影响的节点组
        const affectedGroups = new Set();
        for (let node of this.selectedNodes) {
            if (node.group) {
                affectedGroups.add(node.group);
            }
        }

        // 删除与选中节点相关的连接
        this.connections = this.connections.filter(conn => {
            return !this.selectedNodes.has(conn.fromNode) &&
                   !this.selectedNodes.has(conn.toNode);
        });

        // 从节点组中移除被删除的节点
        for (let node of this.selectedNodes) {
            if (node.group) {
                node.group.removeNode(node);
            }
        }

        // 删除选中的节点
        this.nodes = this.nodes.filter(node => !this.selectedNodes.has(node));

        // 处理受影响的节点组
        for (let group of affectedGroups) {
            if (group.nodes.size === 0) {
                // 如果节点组内没有节点了，删除该节点组
                const groupIndex = this.groups.indexOf(group);
                if (groupIndex !== -1) {
                    this.groups.splice(groupIndex, 1);
                }
            } else {
                // 如果节点组还有节点，更新节点组边界
                group.updateBounds();
            }
        }

        // 清除选择
        this.selectedNodes.clear();
        this.selectedNode = null;

        this.requestRender();
        if (!this.sessionClient.hasSession()) {
            this.requestExecutionRefresh({ immediate: true });
        } else if (patches.length > 0) {
            this.dispatchGraphPatches(patches, {
                execute: true,
                fullResults: false,
                silentResult: false
            }).then(() => {
                this.requestSessionSnapshotSync();
            }).catch((error) => {
                document.getElementById('output').textContent =
                    `Execution errors:\n\nDelete request failed: ${error?.message || String(error)}`;
            });
        } else {
            this.requestSessionSnapshotSync();
        }

        document.getElementById('output').textContent =
            'Deleted selected nodes.\n' +
            'Press Ctrl+Z to undo.';
    }

    // 复制选中的节点
    copySelected() {
        if (this.selectedNodes.size === 0) {
            document.getElementById('output').textContent = 'No nodes selected to copy.';
            return;
        }

        // 创建节点ID映射
        const nodeIdMap = new Map();
        const selectedArray = Array.from(this.selectedNodes);

        // 复制节点数据
        this.clipboard = {
            nodes: selectedArray.map(node => ({
                type: node.type,
                x: node.x,
                y: node.y,
                properties: (() => {
                    const properties = {};
                    const propertyDefs = node?.config?.properties || {};
                    for (const key of Object.keys(propertyDefs)) {
                        const value = this.cloneJsonValue(node[key]);
                        if (value !== undefined) {
                            properties[key] = value;
                        }
                    }
                    return properties;
                })(),
                width: node.width,
                height: node.height,
                originalId: node.id
            })),
            connections: []
        };

        // 为每个节点创建ID映射
        selectedArray.forEach(node => {
            nodeIdMap.set(node.id, node);
        });

        // 复制选中节点之间的连接
        for (let conn of this.connections) {
            if (this.selectedNodes.has(conn.fromNode) &&
                this.selectedNodes.has(conn.toNode)) {
                this.clipboard.connections.push({
                    fromNodeOriginalId: conn.fromNode.id,
                    fromSocketId: conn.fromSocket.id,
                    toNodeOriginalId: conn.toNode.id,
                    toSocketId: conn.toSocket.id
                });
            }
        }

        document.getElementById('output').textContent =
            `Copied ${this.clipboard.nodes.length} node(s) to clipboard.\n` +
            'Press Ctrl+V to paste.';
    }

    // 剪切选中的节点
    cutSelected() {
        if (this.selectedNodes.size === 0) {
            document.getElementById('output').textContent = 'No nodes selected to cut.';
            return;
        }

        this.copySelected();
        this.deleteSelected();

        document.getElementById('output').textContent =
            `Cut ${this.clipboard.nodes.length} node(s) to clipboard.\n` +
            'Press Ctrl+V to paste.';
    }

    // 粘贴剪贴板中的节点
    paste() {
        if (!this.clipboard || this.clipboard.nodes.length === 0) {
            document.getElementById('output').textContent = 'Clipboard is empty.';
            return;
        }

        this.saveHistory(`Paste ${this.clipboard.nodes.length} Node(s)`);

        // 计算粘贴偏移量（避免完全重叠）
        const offset = 30;

        // 创建新节点ID映射
        const oldToNewIdMap = new Map();
        const patches = [];

        // 清除当前选择
        this.selectedNodes.clear();

        // 粘贴节点
        for (let nodeData of this.clipboard.nodes) {
            const config = this.nodeTypeMap[nodeData.type];
            if (!config) continue;

            const newNode = new Node(
                this.nodeIdCounter++,
                nodeData.type,
                nodeData.x + offset,
                nodeData.y + offset,
                config
            );
            const propertyDefs = newNode?.config?.properties || {};
            const copiedProps = (nodeData?.properties && typeof nodeData.properties === 'object')
                ? nodeData.properties
                : {};
            for (const key of Object.keys(propertyDefs)) {
                if (!Object.prototype.hasOwnProperty.call(copiedProps, key)) {
                    continue;
                }
                newNode[key] = this.cloneJsonValue(copiedProps[key]);
            }
            this.ensureNodeValues(newNode);
            newNode.width = nodeData.width;
            newNode.height = nodeData.height;

            this.nodes.push(newNode);
            oldToNewIdMap.set(nodeData.originalId, newNode);
            patches.push({
                op: 'add_node',
                node: this.serializeNodeForPatch(newNode)
            });

            // 选中新粘贴的节点
            this.selectedNodes.add(newNode);
        }

        // 粘贴连接
        for (let connData of this.clipboard.connections) {
            const fromNode = oldToNewIdMap.get(connData.fromNodeOriginalId);
            const toNode = oldToNewIdMap.get(connData.toNodeOriginalId);

            if (fromNode && toNode) {
                const fromSocket = fromNode.outputs.find(s => s.id === connData.fromSocketId);
                const toSocket = toNode.inputs.find(s => s.id === connData.toSocketId);

                if (fromSocket && toSocket) {
                    const conn = new Connection(fromNode, fromSocket, toNode, toSocket);
                    this.connections.push(conn);
                    toSocket.connection = conn;
                    patches.push({
                        op: 'add_connection',
                        from_node: fromNode.id,
                        from_socket: fromSocket.id,
                        to_node: toNode.id,
                        to_socket: toSocket.id
                    });
                }
            }
        }

        this.selectedNode = this.selectedNodes.size > 0 ?
            Array.from(this.selectedNodes)[0] : null;

        this.requestRender();
        if (!this.sessionClient.hasSession()) {
            this.requestExecutionRefresh({ immediate: true });
        } else if (patches.length > 0) {
            this.dispatchGraphPatches(patches, {
                execute: true,
                fullResults: false,
                silentResult: false
            }).catch((error) => {
                document.getElementById('output').textContent =
                    `Execution errors:\n\nPaste request failed: ${error?.message || String(error)}`;
            });
        }

        document.getElementById('output').textContent =
            `Pasted ${this.clipboard.nodes.length} node(s).\n` +
            'New nodes are selected and offset by 30 pixels.';
    }

    // 复制节点（Shift+D风格）
    duplicateSelected() {
        if (this.selectedNodes.size === 0) {
            document.getElementById('output').textContent = 'No nodes selected to duplicate.';
            return;
        }

        this.copySelected();
        this.paste();

        document.getElementById('output').textContent =
            `Duplicated ${this.clipboard.nodes.length} node(s).\n` +
            'New nodes are selected and ready to move.';
    }

    // 框架所有节点
    frameAll() {
        if (this.nodes.length === 0) return;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const node of this.nodes) {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
        }

        const padding = 50;
        const contentWidth = maxX - minX + padding * 2;
        const contentHeight = maxY - minY + padding * 2;

        const scaleX = this.canvas.width / contentWidth;
        const scaleY = this.canvas.height / contentHeight;
        this.viewScale = Math.min(scaleX, scaleY, 1.0);

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        this.viewOffset.x = this.canvas.width / 2 - centerX * this.viewScale;
        this.viewOffset.y = this.canvas.height / 2 - centerY * this.viewScale;

        this.requestRender();
    }

    // 框架选中节点
    frameSelected() {
        if (!this.selectedNode) return;

        const node = this.selectedNode;
        const padding = 100;

        this.viewScale = 1.0;

        this.viewOffset.x = this.canvas.width / 2 - (node.x + node.width / 2) * this.viewScale;
        this.viewOffset.y = this.canvas.height / 2 - (node.y + node.height / 2) * this.viewScale;

        this.requestRender();
    }

    // 重置视图
    resetView() {
        this.viewOffset = {x: 0, y: 0};
        this.viewScale = 1.0;
        this.requestRender();
    }

    // ==================== 模板库功能 ====================

    // 从 localStorage 加载模板
    loadTemplates() {
        try {
            const saved = localStorage.getItem('nodeTemplates');
            if (saved) {
                this.templates = JSON.parse(saved);
                console.log(`Loaded ${this.templates.length} templates from storage`);
            }
        } catch (error) {
            console.error('Failed to load templates:', error);
            this.templates = [];
        }
    }

    // 保存模板到 localStorage
    saveTemplates() {
        try {
            localStorage.setItem('nodeTemplates', JSON.stringify(this.templates));
            console.log(`Saved ${this.templates.length} templates to storage`);
        } catch (error) {
            console.error('Failed to save templates:', error);
        }
    }

    // 保存选中的节点为模板
    saveAsTemplate() {
        if (this.selectedNodes.size === 0) {
            document.getElementById('output').textContent =
                'No nodes selected!\n\n' +
                'Select one or more nodes to save as a template.';
            return;
        }

        // 提示用户输入模板名称
        const templateName = prompt('Enter template name:', 'My Template');
        if (!templateName) return;

        // 计算选中节点的边界框
        let minX = Infinity, minY = Infinity;
        for (let node of this.selectedNodes) {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
        }

        // 保存节点数据（相对于边界框左上角的位置）
        const templateNodes = [];
        const nodeIdMap = new Map(); // 旧ID -> 新索引的映射

        let index = 0;
        for (let node of this.selectedNodes) {
            nodeIdMap.set(node.id, index);
            templateNodes.push({
                type: node.type,
                x: node.x - minX,
                y: node.y - minY,
                value: node.value,
                operation: node.operation,
                label: node.label,
                text: node.text,
                values: node.values
            });
            index++;
        }

        // 保存连接（只保存选中节点之间的连接）
        const templateConnections = [];
        for (let conn of this.connections) {
            if (this.selectedNodes.has(conn.fromNode) && this.selectedNodes.has(conn.toNode)) {
                templateConnections.push({
                    fromNode: nodeIdMap.get(conn.fromNode.id),
                    fromSocket: conn.fromSocket.id,
                    toNode: nodeIdMap.get(conn.toNode.id),
                    toSocket: conn.toSocket.id
                });
            }
        }

        // 创建模板对象
        const template = {
            id: Date.now(),
            name: templateName,
            nodes: templateNodes,
            connections: templateConnections,
            createdAt: new Date().toISOString()
        };

        this.templates.push(template);
        this.saveTemplates();

        document.getElementById('output').textContent =
            `Template "${templateName}" saved!\n\n` +
            `Nodes: ${templateNodes.length}\n` +
            `Connections: ${templateConnections.length}\n\n` +
            'Press Alt+M to open template library.';
    }

    // 从模板插入节点
    insertTemplate(template) {
        if (!template) return;

        // 计算插入位置（视口中心）
        const insertX = (-this.viewOffset.x + this.canvas.width / 2) / this.viewScale;
        const insertY = (-this.viewOffset.y + this.canvas.height / 2) / this.viewScale;

        // 应用网格吸附
        const baseX = this.gridSnap ? this.snapToGrid(insertX) : insertX;
        const baseY = this.gridSnap ? this.snapToGrid(insertY) : insertY;

        this.saveHistory(`Insert Template: ${template.name}`);

        // 创建节点
        const newNodes = [];
        const patches = [];
        const nodeIdMap = new Map(); // 模板索引 -> 新节点的映射

        for (let i = 0; i < template.nodes.length; i++) {
            const templateNode = template.nodes[i];
            const config = this.nodeTypeMap[templateNode.type];
            if (!config) {
                console.error('Unknown node type:', templateNode.type);
                continue;
            }

            const node = new Node(
                this.nodeIdCounter++,
                templateNode.type,
                baseX + templateNode.x,
                baseY + templateNode.y,
                config
            );

            const propertyDefs = node?.config?.properties || {};
            for (const key of Object.keys(propertyDefs)) {
                if (Object.prototype.hasOwnProperty.call(templateNode, key)) {
                    node[key] = this.cloneJsonValue(templateNode[key]);
                }
            }
            this.ensureNodeValues(node);

            this.nodes.push(node);
            newNodes.push(node);
            nodeIdMap.set(i, node);
            patches.push({
                op: 'add_node',
                node: this.serializeNodeForPatch(node)
            });
        }

        // 创建连接
        for (let connData of template.connections) {
            const fromNode = nodeIdMap.get(connData.fromNode);
            const toNode = nodeIdMap.get(connData.toNode);

            if (fromNode && toNode) {
                const fromSocket = fromNode.outputs.find(s => s.id === connData.fromSocket);
                const toSocket = toNode.inputs.find(s => s.id === connData.toSocket);

                if (fromSocket && toSocket) {
                    const conn = new Connection(fromNode, fromSocket, toNode, toSocket);
                    this.connections.push(conn);
                    toSocket.connection = conn;
                    patches.push({
                        op: 'add_connection',
                        from_node: fromNode.id,
                        from_socket: fromSocket.id,
                        to_node: toNode.id,
                        to_socket: toSocket.id
                    });
                }
            }
        }

        // 选中新插入的节点
        this.selectedNodes.clear();
        for (let node of newNodes) {
            this.selectedNodes.add(node);
        }
        this.selectedNode = newNodes.length > 0 ? newNodes[0] : null;

        this.requestRender();
        if (!this.sessionClient.hasSession()) {
            this.requestExecutionRefresh({ immediate: true });
        } else if (patches.length > 0) {
            this.dispatchGraphPatches(patches, {
                execute: true,
                fullResults: false,
                silentResult: false
            }).catch((error) => {
                document.getElementById('output').textContent =
                    `Execution errors:\n\nInsert template failed: ${error?.message || String(error)}`;
            });
        }

        document.getElementById('output').textContent =
            `Template "${template.name}" inserted!\n\n` +
            `Nodes: ${newNodes.length}\n` +
            `Connections: ${template.connections.length}`;
    }

    // 删除模板
    deleteTemplate(templateId) {
        const index = this.templates.findIndex(t => t.id === templateId);
        if (index !== -1) {
            const templateName = this.templates[index].name;
            this.templates.splice(index, 1);
            this.saveTemplates();

            document.getElementById('output').textContent =
                `Template "${templateName}" deleted!`;

            // 刷新模板库面板
            if (this.templateLibraryPanel) {
                this.templateLibraryPanel.refresh();
            }
        }
    }

    // 重命名模板
    renameTemplate(templateId) {
        const template = this.templates.find(t => t.id === templateId);
        if (!template) return;

        const newName = prompt('Enter new template name:', template.name);
        if (!newName || newName === template.name) return;

        template.name = newName;
        this.saveTemplates();

        document.getElementById('output').textContent =
            `Template renamed to "${newName}"!`;

        // 刷新模板库面板
        if (this.templateLibraryPanel) {
            this.templateLibraryPanel.refresh();
        }
    }

    // 打开模板库面板
    openTemplateLibrary() {
        if (this.templateLibraryPanel) {
            this.templateLibraryPanel.close();
        }
        this.templateLibraryPanel = new TemplateLibraryPanel(this);
        this.templateLibraryPanel.show();
    }
}

Object.assign(NodeEditor.prototype, historyMixin, rendererMixin, interactionMixin);

export { NodeEditor };
