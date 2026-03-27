const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const {
    DEFAULT_CHUNKED_STREAM_CHUNK_SIZE,
    DEFAULT_CHUNKED_STREAM_MAX_PARALLEL,
    DEFAULT_PAGED_PREVIEW_ITEMS,
    isChunkedGeometryPayload,
    makePagedDescriptor,
    makePagedDescriptorForValue,
    rewriteOutputs
} = require('./output_transport');
const {
    computeAffectedNodes,
    buildNodeDeltas,
    buildConnectionDeltas
} = require('./graph_execution_rules');

const app = express();
const PORT = Number.isFinite(Number(process.env.PORT))
    ? Number(process.env.PORT)
    : 3000;
const MESH_CHUNK_SIZE = DEFAULT_CHUNKED_STREAM_CHUNK_SIZE;
const MESH_STREAM_MAX_PARALLEL = DEFAULT_CHUNKED_STREAM_MAX_PARALLEL;
const MAX_MESH_BLOBS = 128;
const MESH_BLOB_TTL_MS = 10 * 60 * 1000;
const meshBlobStore = new Map();
const graphSessionStore = new Map();
const MAX_GRAPH_SESSIONS = 64;
const GRAPH_SESSION_TTL_MS = 30 * 60 * 1000;
const textureMimeByExt = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
};
const ENABLE_PROCESSOR_WORKER = process.env.PROCESSOR_WORKER !== '0';
let processorWorker = null;
let processorWorkerBuffer = '';
let processorWorkerRequestId = 1;
const processorWorkerPending = new Map();
const processorWorkerState = {
    sessionId: null,
    version: null
};
let legacyViewerInteractionPatchCount = 0;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../WebUI')));
app.use('/json', express.static(path.join(__dirname, '../json')));

function getMeshBlobKey(meshId, version) {
    return `${meshId}@${String(version)}`;
}

function toFloat32Array(values) {
    if (values instanceof Float32Array) {
        return values;
    }
    if (ArrayBuffer.isView(values)) {
        return new Float32Array(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength));
    }
    if (Array.isArray(values)) {
        return Float32Array.from(values);
    }
    return null;
}

function toUint32Array(values) {
    if (values instanceof Uint32Array) {
        return values;
    }
    if (ArrayBuffer.isView(values)) {
        return new Uint32Array(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength));
    }
    if (Array.isArray(values)) {
        return Uint32Array.from(values);
    }
    return null;
}

function pruneMeshBlobStore() {
    const now = Date.now();
    for (const [key, blob] of meshBlobStore.entries()) {
        if (now - blob.lastAccess > MESH_BLOB_TTL_MS) {
            meshBlobStore.delete(key);
        }
    }
    if (meshBlobStore.size <= MAX_MESH_BLOBS) return;
    const ordered = [...meshBlobStore.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    while (meshBlobStore.size > MAX_MESH_BLOBS && ordered.length > 0) {
        const [key] = ordered.shift();
        meshBlobStore.delete(key);
    }
}

function stashMeshPayload(payload) {
    const positions = Array.isArray(payload.positions) ? payload.positions : null;
    const triIndices = Array.isArray(payload.triIndices) ? payload.triIndices : null;
    const lineIndices = Array.isArray(payload.lineIndices) ? payload.lineIndices : null;
    const pointIndices = Array.isArray(payload.pointIndices) ? payload.pointIndices : null;
    const legacyIndices = Array.isArray(payload.indices) ? payload.indices : null;
    const hasIndexPayload = triIndices || lineIndices || pointIndices || legacyIndices;
    if (!positions || !hasIndexPayload || !payload.meshId || payload.version === undefined) {
        return payload;
    }

    const key = getMeshBlobKey(payload.meshId, payload.version);
    const now = Date.now();
    const existing = meshBlobStore.get(key);
    if (!existing) {
        const positionsTyped = toFloat32Array(positions);
        const triIndicesTyped = toUint32Array(triIndices || legacyIndices || []);
        const lineIndicesTyped = toUint32Array(lineIndices || []);
        const pointIndicesTyped = toUint32Array(pointIndices || []);
        if (!positionsTyped || !triIndicesTyped || !lineIndicesTyped || !pointIndicesTyped) {
            return payload;
        }
        meshBlobStore.set(key, {
            meshId: payload.meshId,
            version: payload.version,
            positions: positionsTyped,
            triIndices: triIndicesTyped,
            lineIndices: lineIndicesTyped,
            pointIndices: pointIndicesTyped,
            createdAt: now,
            lastAccess: now
        });
    } else {
        existing.lastAccess = now;
    }
    pruneMeshBlobStore();

    const lightweight = { ...payload };
    if (Array.isArray(payload.objects)) {
        lightweight.objects = payload.objects.map((obj) => ({
            type: obj?.type,
            texturePath: obj?.texturePath,
            colorMap: obj?.colorMap
        }));
    }
    delete lightweight.positions;
    delete lightweight.indices;
    delete lightweight.triIndices;
    delete lightweight.lineIndices;
    delete lightweight.pointIndices;
    delete lightweight.vertices;
    delete lightweight.triangles;
    lightweight.stream = {
        mode: 'chunked',
        endpoint: `/mesh/${encodeURIComponent(payload.meshId)}/${encodeURIComponent(String(payload.version))}`,
        chunkSize: MESH_CHUNK_SIZE,
        maxParallel: MESH_STREAM_MAX_PARALLEL,
        fields: {
            positions: positions.length,
            triIndices: (triIndices || legacyIndices || []).length,
            lineIndices: (lineIndices || []).length,
            pointIndices: (pointIndices || []).length
        }
    };
    return lightweight;
}

function rewriteMeshPayloadsForStreaming(resultJson) {
    rewriteOutputs(resultJson, [
        ({ value }) => {
            if (!isChunkedGeometryPayload(value)) return undefined;
            return stashMeshPayload(value);
        }
    ]);
}

function rewriteArrayOutputsForPaging(resultJson, pageSize = DEFAULT_PAGED_PREVIEW_ITEMS) {
    rewriteOutputs(resultJson, [
        ({ node, socketId, value }) => {
            if (!Array.isArray(value)) return undefined;
            node.outputs_truncated = true;
            node.max_preview_items = pageSize;
            return makePagedDescriptorForValue(socketId, value, pageSize);
        }
    ]);
}

function decodeFileUrlToPath(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.toLowerCase().startsWith('file://')) {
        return rawUrl;
    }
    let p = rawUrl.replace(/^file:\/\//i, '');
    if (process.platform === 'win32' && p.startsWith('/')) {
        p = p.slice(1);
    }
    return decodeURIComponent(p);
}

function resolveTextureFsPath(rawPath) {
    if (typeof rawPath !== 'string') return null;
    const trimmed = rawPath.trim();
    if (!trimmed || trimmed.startsWith('builtin://')) return null;
    const decoded = decodeFileUrlToPath(trimmed);
    if (path.isAbsolute(decoded)) return decoded;

    const candidates = [
        path.resolve(process.cwd(), decoded),
        path.resolve(__dirname, '..', decoded),
        path.resolve(__dirname, '../json', decoded)
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return path.resolve(__dirname, '..', decoded);
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function computeGraphHash(graphData) {
    const normalized = normalizeGraphData(graphData);
    const text = JSON.stringify(normalized);
    return crypto.createHash('sha1').update(text).digest('hex');
}

function computeExecutionGraphHash(graphData) {
    const normalized = normalizeGraphData(graphData);
    const nodes = normalized.nodes
        .map((node) => ({
            id: Number(node?.id),
            type: String(node?.type || ''),
            properties: (node?.properties && typeof node.properties === 'object' && !Array.isArray(node.properties))
                ? cloneJson(node.properties)
                : {},
            value: node?.value,
            operation: node?.operation,
            label: node?.label,
            text: node?.text,
            values: node?.values
        }))
        .sort((a, b) => a.id - b.id);
    const connections = normalized.connections
        .map((conn) => ({
            from_node: Number(conn?.from_node),
            from_socket: String(conn?.from_socket || ''),
            to_node: Number(conn?.to_node),
            to_socket: String(conn?.to_socket || '')
        }))
        .sort((a, b) =>
            (a.from_node - b.from_node) ||
            a.from_socket.localeCompare(b.from_socket) ||
            (a.to_node - b.to_node) ||
            a.to_socket.localeCompare(b.to_socket)
        );
    const signature = { nodes, connections };
    return crypto.createHash('sha1').update(JSON.stringify(signature)).digest('hex');
}

function normalizeExecutionOptions(raw) {
    const obj = raw && typeof raw === 'object' ? raw : {};
    const omitOutputs = obj.omitOutputs === true;
    const maxPreviewItems = Number.isFinite(obj.maxPreviewItems)
        ? Math.max(0, Math.floor(obj.maxPreviewItems))
        : DEFAULT_PAGED_PREVIEW_ITEMS;
    const outputNodeIds = Array.isArray(obj.outputNodeIds)
        ? obj.outputNodeIds.filter(Number.isFinite).map(v => Number(v))
        : [];
    const outputSockets = {};
    if (obj.outputSockets && typeof obj.outputSockets === 'object') {
        for (const [rawNodeId, rawList] of Object.entries(obj.outputSockets)) {
            const nodeId = Number(rawNodeId);
            if (!Number.isFinite(nodeId) || !Array.isArray(rawList)) continue;
            const sockets = rawList
                .filter(v => typeof v === 'string' && v.length > 0)
                .map(v => String(v));
            if (sockets.length > 0) {
                outputSockets[String(nodeId)] = [...new Set(sockets)];
            }
        }
    }
    const deltaOnly = obj.deltaOnly === true;
    return {
        omitOutputs,
        maxPreviewItems,
        outputNodeIds,
        outputSockets,
        deltaOnly
    };
}

function normalizeGraphData(raw) {
    const g = raw && typeof raw === 'object' ? cloneJson(raw) : {};
    g.nodes = Array.isArray(g.nodes) ? g.nodes : [];
    g.connections = Array.isArray(g.connections) ? g.connections : [];
    g.groups = Array.isArray(g.groups) ? g.groups : [];
    g.comments = Array.isArray(g.comments) ? g.comments : [];
    return g;
}

function getGraphNode(graphData, nodeId) {
    return graphData.nodes.find(n => Number(n.id) === Number(nodeId));
}

function normalizeInteractionEvent(rawEvent, fallbackNodeId) {
    if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
        throw new Error('interaction_event value must be an object');
    }
    const channel = (typeof rawEvent.channel === 'string' && rawEvent.channel.trim())
        ? rawEvent.channel.trim()
        : 'viewer';
    const phaseRaw = (typeof rawEvent.phase === 'string' && rawEvent.phase.trim())
        ? rawEvent.phase.trim().toLowerCase()
        : 'update';
    const phase = ['begin', 'update', 'commit', 'cancel'].includes(phaseRaw) ? phaseRaw : 'update';
    const targetNodeId = Number.isFinite(rawEvent.targetNodeId)
        ? Number(rawEvent.targetNodeId)
        : Number(fallbackNodeId);
    const sourceNodeId = Number.isFinite(rawEvent.sourceNodeId)
        ? Number(rawEvent.sourceNodeId)
        : (Number.isFinite(rawEvent?.payload?.sourceViewerNodeId)
            ? Number(rawEvent.payload.sourceViewerNodeId)
            : Number(fallbackNodeId));
    const version = Number.isFinite(rawEvent.version)
        ? Math.max(0, Math.floor(rawEvent.version))
        : Date.now();
    const payload = (rawEvent.payload && typeof rawEvent.payload === 'object' && !Array.isArray(rawEvent.payload))
        ? rawEvent.payload
        : {};
    const source = (typeof rawEvent.source === 'string' && rawEvent.source.trim())
        ? rawEvent.source.trim()
        : 'webui';
    const timestampMs = Number.isFinite(rawEvent.timestampMs)
        ? Math.max(0, Math.floor(rawEvent.timestampMs))
        : Date.now();
    return {
        channel,
        phase,
        sourceNodeId,
        targetNodeId,
        version,
        payload,
        source,
        timestampMs,
        ts: timestampMs
    };
}

function isValidInteractionEvent(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
    if (typeof event.channel !== 'string' || event.channel.trim().length === 0) return false;
    if (!['begin', 'update', 'commit', 'cancel'].includes(event.phase)) return false;
    if (!Number.isFinite(event.sourceNodeId) || Number(event.sourceNodeId) < 0) return false;
    if (!Number.isFinite(event.targetNodeId) || Number(event.targetNodeId) < 0) return false;
    if (!Number.isFinite(event.version) || Number(event.version) < 0) return false;
    if (!Number.isFinite(event.timestampMs) || Number(event.timestampMs) < 0) return false;
    if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return false;
    return true;
}

function applyInteractionEventToNode(node, event) {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
        node.properties = {};
    }
    const state = (node.properties.interaction_state && typeof node.properties.interaction_state === 'object' && !Array.isArray(node.properties.interaction_state))
        ? node.properties.interaction_state
        : {};
    const channels = (state.channels && typeof state.channels === 'object' && !Array.isArray(state.channels))
        ? state.channels
        : {};
    const prev = (channels[event.channel] && typeof channels[event.channel] === 'object' && !Array.isArray(channels[event.channel]))
        ? channels[event.channel]
        : {};
    const next = {
        ...prev,
        version: event.version,
        phase: event.phase,
        source: event.source,
        sourceNodeId: event.sourceNodeId,
        targetNodeId: event.targetNodeId,
        timestampMs: event.timestampMs,
        lastEvent: event
    };
    if (event.phase === 'begin' || event.phase === 'update') {
        next.transient = event.payload;
        next.payload = event.payload;
    } else if (event.phase === 'commit') {
        next.committed = event.payload;
        next.payload = event.payload;
        next.transient = {};
    } else if (event.phase === 'cancel') {
        next.transient = {};
    }
    channels[event.channel] = next;
    state.channels = channels;
    state.lastChannel = event.channel;
    state.lastVersion = event.version;
    state.lastPhase = event.phase;
    state.timestampMs = event.timestampMs;
    state.ts = event.timestampMs;
    node.properties.interaction_state = state;
    node.properties.interaction_event = event;
}

function applyGraphPatch(graphData, patch) {
    if (!patch || typeof patch !== 'object') {
        throw new Error('Invalid patch item');
    }
    const op = String(patch.op || '');
    if (!op) {
        throw new Error('Patch op is required');
    }

    if (op === 'set_node_property' || op === 'set_node_input_literal' || op === 'viewer_interaction') {
        const node = getGraphNode(graphData, patch.nodeId);
        if (!node) throw new Error(`Node not found: ${patch.nodeId}`);
        const key = String(patch.key || '');
        if (!key) throw new Error('Patch key is required');
        if (op === 'viewer_interaction') {
            let event = null;
            if (key === 'interaction_event') {
                event = normalizeInteractionEvent(patch.value, patch.nodeId);
            } else {
                // Backward-compatible legacy viewer_interaction patch:
                // convert {key,value} to normalized interaction_event.
                legacyViewerInteractionPatchCount += 1;
                if (process.env.INTERACTION_DEBUG === '1' &&
                    (legacyViewerInteractionPatchCount <= 5 || legacyViewerInteractionPatchCount % 100 === 0)) {
                    console.warn('[interaction][deprecated]',
                        `legacy viewer_interaction key="${key}" normalized to interaction_event`,
                        `count=${legacyViewerInteractionPatchCount}`);
                }
                event = normalizeInteractionEvent({
                    channel: typeof patch.channel === 'string' ? patch.channel : 'viewer',
                    phase: typeof patch.phase === 'string' ? patch.phase : 'update',
                    sourceNodeId: Number(patch.nodeId),
                    targetNodeId: Number(patch.nodeId),
                    version: Date.now(),
                    source: 'webui-legacy',
                    payload: {
                        sourceViewerNodeId: patch.nodeId,
                        action: key,
                        value: patch.value
                    }
                }, patch.nodeId);
            }
            if (!isValidInteractionEvent(event)) {
                throw new Error('Invalid interaction_event payload');
            }
            if (process.env.INTERACTION_DEBUG === '1') {
                const payloadKeys = (event.payload && typeof event.payload === 'object')
                    ? Object.keys(event.payload)
                    : [];
                console.log('[interaction]', `node=${patch.nodeId}`, `channel=${event.channel}`, `phase=${event.phase}`, `payloadKeys=${payloadKeys.join(',')}`);
            }
            applyInteractionEventToNode(node, event);
            // Connection-driven routing: source.interaction -> destination node.
            const conns = Array.isArray(graphData.connections) ? graphData.connections : [];
            for (const conn of conns) {
                if (!conn || Number(conn.from_node) !== Number(patch.nodeId)) continue;
                if (String(conn.from_socket || '') !== 'interaction') continue;
                const dst = getGraphNode(graphData, conn.to_node);
                if (!dst) continue;
                applyInteractionEventToNode(dst, event);
            }
            node.interaction_event = event;
            return;
        }
        node[key] = patch.value;
        if (!node.properties || typeof node.properties !== 'object') {
            node.properties = {};
        }
        node.properties[key] = patch.value;
        return;
    }

    if (op === 'add_node') {
        const node = (patch.node && typeof patch.node === 'object') ? patch.node : null;
        if (!node) throw new Error('Invalid add_node patch: missing node');
        if (!Number.isFinite(node.id)) throw new Error('Invalid add_node patch: node.id');
        const type = String(node.type || '');
        if (!type) throw new Error('Invalid add_node patch: node.type');
        const already = getGraphNode(graphData, node.id);
        if (already) {
            throw new Error(`add_node id already exists: ${node.id}`);
        }
        graphData.nodes.push(cloneJson(node));
        graphData.meta = graphData.meta && typeof graphData.meta === 'object' ? graphData.meta : {};
        const nextCounter = Number(node.id) + 1;
        const curCounter = Number(graphData.meta.nodeIdCounter);
        if (!Number.isFinite(curCounter) || curCounter < nextCounter) {
            graphData.meta.nodeIdCounter = nextCounter;
        }
        return;
    }

    if (op === 'move_node') {
        const node = getGraphNode(graphData, patch.nodeId);
        if (!node) throw new Error(`Node not found: ${patch.nodeId}`);
        if (Number.isFinite(patch.x)) node.x = patch.x;
        if (Number.isFinite(patch.y)) node.y = patch.y;
        return;
    }

    if (op === 'set_node_size') {
        const node = getGraphNode(graphData, patch.nodeId);
        if (!node) throw new Error(`Node not found: ${patch.nodeId}`);
        if (Number.isFinite(patch.width)) node.width = patch.width;
        if (Number.isFinite(patch.height)) node.height = patch.height;
        return;
    }

    if (op === 'add_connection') {
        const conn = {
            from_node: patch.from_node,
            from_socket: patch.from_socket,
            to_node: patch.to_node,
            to_socket: patch.to_socket
        };
        if (conn.from_node === undefined || conn.to_node === undefined ||
            !conn.from_socket || !conn.to_socket) {
            throw new Error('Invalid add_connection patch');
        }
        graphData.connections.push(conn);
        return;
    }

    if (op === 'remove_node') {
        const nodeId = Number(patch.nodeId);
        if (!Number.isFinite(nodeId)) {
            throw new Error('Invalid remove_node patch: nodeId');
        }
        const index = graphData.nodes.findIndex(n => Number(n.id) === nodeId);
        if (index === -1) {
            throw new Error(`Node not found: ${patch.nodeId}`);
        }
        graphData.nodes.splice(index, 1);
        graphData.connections = graphData.connections.filter(c =>
            Number(c.from_node) !== nodeId && Number(c.to_node) !== nodeId
        );
        if (Array.isArray(graphData.groups)) {
            graphData.groups = graphData.groups
                .map(group => ({
                    ...group,
                    nodeIds: Array.isArray(group.nodeIds)
                        ? group.nodeIds.filter(id => Number(id) !== nodeId)
                        : []
                }))
                .filter(group => !Array.isArray(group.nodeIds) || group.nodeIds.length > 0);
        }
        return;
    }

    if (op === 'remove_connection') {
        graphData.connections = graphData.connections.filter(c => !(
            Number(c.from_node) === Number(patch.from_node) &&
            String(c.from_socket) === String(patch.from_socket) &&
            Number(c.to_node) === Number(patch.to_node) &&
            String(c.to_socket) === String(patch.to_socket)
        ));
        return;
    }

    if (op === 'set_graph_meta') {
        graphData.meta = graphData.meta && typeof graphData.meta === 'object' ? graphData.meta : {};
        const key = String(patch.key || '');
        if (!key) throw new Error('Patch key is required');
        graphData.meta[key] = patch.value;
        return;
    }

    throw new Error(`Unsupported patch op: ${op}`);
}

function pruneGraphSessions() {
    const now = Date.now();
    for (const [sid, session] of graphSessionStore.entries()) {
        if (now - session.lastAccess > GRAPH_SESSION_TTL_MS) {
            graphSessionStore.delete(sid);
        }
    }
    if (graphSessionStore.size <= MAX_GRAPH_SESSIONS) return;
    const ordered = [...graphSessionStore.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    while (graphSessionStore.size > MAX_GRAPH_SESSIONS && ordered.length > 0) {
        const [sid] = ordered.shift();
        graphSessionStore.delete(sid);
    }
}

function createGraphSession(graphData) {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const session = {
        id: sessionId,
        version: 1,
        graphData: normalizeGraphData(graphData),
        lastAccess: now,
        createdAt: now,
        lastResult: null,
        lastStdout: '',
        lastGraphHash: ''
    };
    graphSessionStore.set(sessionId, session);
    pruneGraphSessions();
    return session;
}

function getGraphSession(sessionId) {
    const session = graphSessionStore.get(sessionId);
    if (!session) return null;
    session.lastAccess = Date.now();
    return session;
}

function runProcessorWithGraphViaExec(graphData, executionOptions = {}) {
    return new Promise((resolve, reject) => {
        const dataDir = path.join(__dirname, '../json/runtime');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir);
        }

        const inputFile = path.join(dataDir, 'graph_input.json');
        const outputFile = path.join(dataDir, 'graph_output.json');
        const processorInput = cloneJson(graphData);
        const targetNodes = Array.isArray(executionOptions.targetNodes)
            ? executionOptions.targetNodes.filter(Number.isFinite).map(v => Number(v))
            : [];
        const execOptions = normalizeExecutionOptions(executionOptions);
        const execution = {};
        if (targetNodes.length > 0) {
            execution.target_nodes = targetNodes;
        }
        if (execOptions.deltaOnly) {
            execution.delta_only = true;
        }
        if (execOptions.omitOutputs) {
            execution.omit_outputs = true;
        }
        if (execOptions.maxPreviewItems > 0) {
            execution.max_preview_items = execOptions.maxPreviewItems;
        }
        if (execOptions.outputNodeIds.length > 0) {
            execution.output_node_ids = execOptions.outputNodeIds;
        }
        if (Object.keys(execOptions.outputSockets).length > 0) {
            execution.output_socket_ids = execOptions.outputSockets;
        }
        if (Object.keys(execution).length > 0) {
            processorInput._execution = execution;
        }
        fs.writeFileSync(inputFile, JSON.stringify(processorInput, null, 2));
        console.log('Graph input saved to:', inputFile);

        const processorPath = getProcessorPath();
        if (!fs.existsSync(processorPath)) {
            reject({
                status: 500,
                body: {
                    error: 'Processor not found',
                    message: `Please build the C++ processor first. Expected location: ${processorPath}`,
                    hint: 'Run: mkdir build && cd build && cmake .. && cmake --build .'
                }
            });
            return;
        }

        const command = `"${processorPath}" "${inputFile}" "${outputFile}"`;
        console.log('Executing:', command);
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject({
                    status: 500,
                    body: {
                        error: 'Execution failed',
                        message: error.message,
                        stderr
                    }
                });
                return;
            }
            if (!fs.existsSync(outputFile)) {
                reject({
                    status: 500,
                    body: {
                        error: 'Output file not created',
                        message: 'Processor did not generate output file'
                    }
                });
                return;
            }
            const result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
            rewriteMeshPayloadsForStreaming(result);
            resolve({ result, stdout });
        });
    });
}

function runProcessorWithGraph(graphData, executionOptions = {}) {
    if (!ENABLE_PROCESSOR_WORKER) {
        return runProcessorWithGraphViaExec(graphData, executionOptions);
    }
    return runProcessorWithWorker(graphData, executionOptions).catch((error) => {
        console.warn('Processor worker failed, fallback to exec mode:', error.message || String(error));
        return runProcessorWithGraphViaExec(graphData, executionOptions);
    });
}

function getProcessorPath() {
    if (process.platform === 'win32') {
        return path.join(__dirname, '../build', 'bin', 'processor.exe');
    }
    return path.join(__dirname, '../build', 'bin', 'processor');
}

function rejectAllProcessorWorkerPending(message) {
    for (const [, pending] of processorWorkerPending.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(message));
    }
    processorWorkerPending.clear();
}

function ensureProcessorWorker() {
    if (processorWorker && !processorWorker.killed) {
        return processorWorker;
    }
    const processorPath = getProcessorPath();
    if (!fs.existsSync(processorPath)) {
        throw new Error(`Processor not found: ${processorPath}`);
    }
    const child = spawn(processorPath, ['--worker'], {
        stdio: ['pipe', 'pipe', 'pipe']
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        processorWorkerBuffer += chunk;
        while (true) {
            const idx = processorWorkerBuffer.indexOf('\n');
            if (idx < 0) break;
            const line = processorWorkerBuffer.slice(0, idx).trim();
            processorWorkerBuffer = processorWorkerBuffer.slice(idx + 1);
            if (!line) continue;
            let msg = null;
            try {
                msg = JSON.parse(line);
            } catch (_) {
                continue;
            }
            const reqId = Number(msg.id);
            const pending = processorWorkerPending.get(reqId);
            if (!pending) continue;
            clearTimeout(pending.timer);
            processorWorkerPending.delete(reqId);
            if (msg.ok) {
                pending.resolve(msg);
            } else {
                pending.reject(new Error(msg.error || 'Worker execution failed'));
            }
        }
    });
    child.stderr.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (text.length > 0) {
            console.warn('[processor-worker]', text);
        }
    });
    child.on('exit', (code, signal) => {
        processorWorker = null;
        processorWorkerBuffer = '';
        processorWorkerState.sessionId = null;
        processorWorkerState.version = null;
        rejectAllProcessorWorkerPending(`Processor worker exited (code=${code}, signal=${signal || ''})`);
    });
    processorWorker = child;
    return child;
}

function runProcessorWithWorker(graphData, executionOptions = {}) {
    return new Promise((resolve, reject) => {
        let worker = null;
        try {
            worker = ensureProcessorWorker();
        } catch (error) {
            reject(error);
            return;
        }
        const requestId = processorWorkerRequestId++;
        const payload = cloneJson(graphData);
        const targetNodes = Array.isArray(executionOptions.targetNodes)
            ? executionOptions.targetNodes.filter(Number.isFinite).map(v => Number(v))
            : [];
        const execOptions = normalizeExecutionOptions(executionOptions);
        const execution = {};
        if (targetNodes.length > 0) {
            execution.target_nodes = targetNodes;
        }
        if (execOptions.deltaOnly) {
            execution.delta_only = true;
        }
        if (execOptions.omitOutputs) {
            execution.omit_outputs = true;
        }
        if (execOptions.maxPreviewItems > 0) {
            execution.max_preview_items = execOptions.maxPreviewItems;
        }
        if (execOptions.outputNodeIds.length > 0) {
            execution.output_node_ids = execOptions.outputNodeIds;
        }
        if (Object.keys(execOptions.outputSockets).length > 0) {
            execution.output_socket_ids = execOptions.outputSockets;
        }
        if (Object.keys(execution).length > 0) {
            payload._execution = execution;
        }
        const req = { id: requestId, cmd: 'execute_graph', graph: payload };
        const timer = setTimeout(() => {
            processorWorkerPending.delete(requestId);
            reject(new Error('Processor worker request timeout'));
        }, 120000);
        processorWorkerPending.set(requestId, { resolve, reject, timer });
        try {
            worker.stdin.write(`${JSON.stringify(req)}\n`);
        } catch (error) {
            clearTimeout(timer);
            processorWorkerPending.delete(requestId);
            reject(error);
        }
    });
}

function sendProcessorWorkerCommand(cmd, payload = {}) {
    return new Promise((resolve, reject) => {
        let worker = null;
        try {
            worker = ensureProcessorWorker();
        } catch (error) {
            reject(error);
            return;
        }
        const requestId = processorWorkerRequestId++;
        const req = { id: requestId, cmd, ...payload };
        const timer = setTimeout(() => {
            processorWorkerPending.delete(requestId);
            reject(new Error(`Processor worker ${cmd} timeout`));
        }, 120000);
        processorWorkerPending.set(requestId, { resolve, reject, timer });
        try {
            worker.stdin.write(`${JSON.stringify(req)}\n`);
        } catch (error) {
            clearTimeout(timer);
            processorWorkerPending.delete(requestId);
            reject(error);
        }
    });
}

async function ensureWorkerGraphForSession(session) {
    if (!ENABLE_PROCESSOR_WORKER) return false;
    if (processorWorkerState.sessionId === session.id &&
        processorWorkerState.version === session.version) {
        return true;
    }
    await sendProcessorWorkerCommand('load_graph', { graph: session.graphData });
    processorWorkerState.sessionId = session.id;
    processorWorkerState.version = session.version;
    return true;
}

async function runSessionGraphWithCache(session) {
    const hash = computeGraphHash(session.graphData);
    if (session.lastResult && session.lastGraphHash === hash) {
        return { result: session.lastResult, stdout: session.lastStdout || '', cacheHit: true };
    }
    let result = null;
    let stdout = '';
    if (ENABLE_PROCESSOR_WORKER) {
        await ensureWorkerGraphForSession(session);
        const msg = await sendProcessorWorkerCommand('execute', {});
        result = msg.results;
        stdout = '';
    } else {
        const execRes = await runProcessorWithGraph(session.graphData);
        result = execRes.result;
        stdout = execRes.stdout;
    }
    rewriteMeshPayloadsForStreaming(result);
    session.lastResult = result;
    session.lastStdout = stdout || '';
    session.lastGraphHash = hash;
    return { result, stdout, cacheHit: false };
}

// Serve WebUI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../WebUI', 'index.html'));
});

app.get('/texture', (req, res) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path : '';
    const filePath = resolveTextureFsPath(rawPath);
    if (!filePath) {
        return res.status(400).json({ error: 'Invalid texture path' });
    }
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Texture file not found', path: rawPath });
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
        return res.status(400).json({ error: 'Texture path is not a file' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = textureMimeByExt[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
});

// Shortcuts config endpoints
app.get('/shortcuts', (req, res) => {
    const filePath = path.join(__dirname, '../json/config', 'shortcuts.json');
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'shortcuts.json not found' });
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(raw));
    } catch (error) {
        res.status(500).json({ error: 'Failed to read shortcuts.json', message: error.message });
    }
});

app.post('/shortcuts', (req, res) => {
    const data = req.body;
    if (!data || !Array.isArray(data.sections)) {
        return res.status(400).json({ error: 'Invalid shortcuts payload' });
    }

    const dataDir = path.join(__dirname, '../json/config');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }

    const filePath = path.join(dataDir, 'shortcuts.json');
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to write shortcuts.json', message: error.message });
    }
});

app.post('/graph/session', async (req, res) => {
    try {
        const graphData = normalizeGraphData(req.body?.graphData || req.body || {});
        const execute = req.body?.execute !== false;
        const session = createGraphSession(graphData);
        if (!execute) {
            return res.json({
                success: true,
                sessionId: session.id,
                version: session.version
            });
        }
        const { result, stdout, cacheHit } = await runSessionGraphWithCache(session);
        res.json({
            success: true,
            sessionId: session.id,
            version: session.version,
            results: result,
            stdout,
            cacheHit
        });
    } catch (error) {
        const status = error?.status || 500;
        const body = error?.body || { error: 'Server error', message: error.message };
        res.status(status).json(body);
    }
});

app.get('/graph/:sessionId', (req, res) => {
    const session = getGraphSession(req.params.sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    res.json({
        success: true,
        sessionId: session.id,
        version: session.version,
        graphData: session.graphData
    });
});

app.post('/graph/:sessionId/snapshot', async (req, res) => {
    const session = getGraphSession(req.params.sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    const baseVersion = Number.isFinite(req.body?.baseVersion) ? req.body.baseVersion : null;
    if (baseVersion !== null && baseVersion !== session.version) {
        return res.status(409).json({
            error: 'version_mismatch',
            message: `Expected version ${baseVersion}, current ${session.version}`,
            version: session.version
        });
    }

    try {
        const prevGraphData = session.graphData;
        const prevExecutionHash = computeExecutionGraphHash(prevGraphData);
        session.graphData = normalizeGraphData(req.body?.graphData || {});
        const nextExecutionHash = computeExecutionGraphHash(session.graphData);
        session.version += 1;
        const execute = req.body?.execute !== false;
        if (!execute) {
            if (ENABLE_PROCESSOR_WORKER) {
                const workerWasInSync =
                    processorWorkerState.sessionId === session.id &&
                    processorWorkerState.version === (session.version - 1);
                if (workerWasInSync) {
                    if (prevExecutionHash === nextExecutionHash) {
                        // Layout-only snapshot: keep worker execution graph/caches alive
                        // and just advance its version marker with the session.
                        processorWorkerState.version = session.version;
                    } else {
                        await ensureWorkerGraphForSession(session);
                    }
                }
            }
            return res.json({
                success: true,
                sessionId: session.id,
                version: session.version
            });
        }
        const { result, stdout, cacheHit } = await runSessionGraphWithCache(session);
        res.json({
            success: true,
            sessionId: session.id,
            version: session.version,
            results: result,
            stdout,
            cacheHit
        });
    } catch (error) {
        const status = error?.status || 500;
        const body = error?.body || { error: 'Server error', message: error.message };
        res.status(status).json(body);
    }
});

app.post('/graph/:sessionId/patch', async (req, res) => {
    const session = getGraphSession(req.params.sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    const baseVersion = Number.isFinite(req.body?.baseVersion) ? req.body.baseVersion : null;
    if (baseVersion !== null && baseVersion !== session.version) {
        return res.status(409).json({
            error: 'version_mismatch',
            message: `Expected version ${baseVersion}, current ${session.version}`,
            version: session.version
        });
    }

    const patches = Array.isArray(req.body?.patches) ? req.body.patches : [];
    if (patches.length === 0) {
        return res.status(400).json({ error: 'No patches provided' });
    }
    try {
        for (const patch of patches) {
            applyGraphPatch(session.graphData, patch);
        }
        session.version += 1;
        const execute = req.body?.execute !== false;
        const fullResults = req.body?.fullResults === true;
        const executionOptions = normalizeExecutionOptions(req.body?.executionOptions);
        if (!execute) {
            if (ENABLE_PROCESSOR_WORKER) {
                const canApplyIncremental =
                    processorWorkerState.sessionId === session.id &&
                    processorWorkerState.version === (session.version - 1);
                if (canApplyIncremental) {
                    await sendProcessorWorkerCommand('apply_patches', { patches });
                    processorWorkerState.version = session.version;
                }
            }
            return res.json({
                success: true,
                sessionId: session.id,
                version: session.version
            });
        }
        const affectedNodes = computeAffectedNodes(session.graphData, patches);
        const debugAddNode = Array.isArray(patches) && patches.some((p) => p && p.op === 'add_node');
        let result = null;
        let stdout = '';
        let workerMode = ENABLE_PROCESSOR_WORKER ? 'reload_graph' : 'stateless_exec';
        if (ENABLE_PROCESSOR_WORKER) {
            const canApplyIncremental =
                processorWorkerState.sessionId === session.id &&
                processorWorkerState.version === (session.version - 1);
            if (canApplyIncremental) {
                await sendProcessorWorkerCommand('apply_patches', { patches });
                processorWorkerState.version = session.version;
                workerMode = 'apply_patches';
            } else {
                await ensureWorkerGraphForSession(session);
                workerMode = 'reload_graph';
            }
            const execCmd = fullResults ? 'execute' : 'execute_delta';
            const execPayload = { target_nodes: affectedNodes };
            if (!fullResults) {
                execPayload.omit_outputs = executionOptions.omitOutputs;
                execPayload.max_preview_items = executionOptions.maxPreviewItems;
                execPayload.output_node_ids = executionOptions.outputNodeIds;
                execPayload.output_socket_ids = executionOptions.outputSockets;
            }
            const execMsg = await sendProcessorWorkerCommand(execCmd, execPayload);
            result = execMsg.results || null;
            stdout = '';
        } else {
            const execRes = await runProcessorWithGraph(session.graphData, {
                targetNodes: affectedNodes,
                deltaOnly: !fullResults,
                omitOutputs: executionOptions.omitOutputs,
                maxPreviewItems: executionOptions.maxPreviewItems,
                outputNodeIds: executionOptions.outputNodeIds,
                outputSockets: executionOptions.outputSockets
            });
            result = execRes.result;
            stdout = execRes.stdout;
        }
        rewriteMeshPayloadsForStreaming(result);
        const deltas = (!fullResults && Array.isArray(result?.node_deltas))
            ? result.node_deltas
            : buildNodeDeltas(result, patches, affectedNodes);
        const connectionDeltas = (!fullResults && Array.isArray(result?.connection_deltas))
            ? result.connection_deltas
            : buildConnectionDeltas(result, patches, affectedNodes);
        const responsePayload = {
            success: true,
            sessionId: session.id,
            version: session.version,
            deltas,
            connectionDeltas,
            execution_stats: result?.execution_stats || null,
            stdout,
            cacheHit: false,
            incremental: true,
            affectedNodeCount: affectedNodes.length,
            affectedNodes,
            workerMode
        };
        if (process.env.GRAPH_DEBUG === '1' && debugAddNode) {
            const deltaIds = Array.isArray(result?.node_deltas)
                ? result.node_deltas.map((d) => d?.id).filter(Number.isFinite)
                : [];
            console.log('[graph][add_node]',
                'affectedNodes=', JSON.stringify(affectedNodes),
                'deltaIds=', JSON.stringify(deltaIds),
                'execStats=', JSON.stringify(result?.execution_stats || null));
        }
        if (fullResults) {
            responsePayload.results = result;
        }
        res.json(responsePayload);
    } catch (error) {
        const status = error?.status || 500;
        const body = error?.body || { error: 'Patch apply failed', message: error.message };
        res.status(status).json(body);
    }
});

app.post('/graph/:sessionId/outputs', async (req, res) => {
    const session = getGraphSession(req.params.sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    const baseVersion = Number.isFinite(req.body?.baseVersion) ? req.body.baseVersion : null;
    if (baseVersion !== null && baseVersion !== session.version) {
        return res.status(409).json({
            error: 'version_mismatch',
            message: `Expected version ${baseVersion}, current ${session.version}`,
            version: session.version
        });
    }

    const nodeId = Number(req.body?.nodeId);
    if (!Number.isFinite(nodeId)) {
        return res.status(400).json({ error: 'Invalid nodeId' });
    }
    const requestedSockets = Array.isArray(req.body?.outputSockets)
        ? req.body.outputSockets.filter(v => typeof v === 'string' && v.length > 0)
        : [];
    const executionOptions = normalizeExecutionOptions(req.body?.executionOptions);
    executionOptions.omitOutputs = false;
    executionOptions.maxPreviewItems = Number.isFinite(executionOptions.maxPreviewItems)
        ? executionOptions.maxPreviewItems
        : DEFAULT_PAGED_PREVIEW_ITEMS;
    executionOptions.outputNodeIds = [nodeId];
    executionOptions.outputSockets = requestedSockets.length > 0
        ? { [String(nodeId)]: [...new Set(requestedSockets)] }
        : {};

    try {
        let result = null;
        let stdout = '';
        let workerMode = ENABLE_PROCESSOR_WORKER ? 'reload_graph' : 'stateless_exec';
        if (ENABLE_PROCESSOR_WORKER) {
            const workerInSync =
                processorWorkerState.sessionId === session.id &&
                processorWorkerState.version === session.version;
            if (!workerInSync) {
                await ensureWorkerGraphForSession(session);
                workerMode = 'reload_graph';
            } else {
                workerMode = 'session_cached';
            }
            const execMsg = await sendProcessorWorkerCommand('execute_delta', {
                target_nodes: [nodeId],
                omit_outputs: false,
                max_preview_items: executionOptions.maxPreviewItems,
                output_node_ids: executionOptions.outputNodeIds,
                output_socket_ids: executionOptions.outputSockets
            });
            result = execMsg.results || null;
        } else {
            const execRes = await runProcessorWithGraph(session.graphData, {
                targetNodes: [nodeId],
                deltaOnly: true,
                omitOutputs: false,
                maxPreviewItems: executionOptions.maxPreviewItems,
                outputNodeIds: executionOptions.outputNodeIds,
                outputSockets: executionOptions.outputSockets
            });
            result = execRes.result;
            stdout = execRes.stdout;
        }
        rewriteMeshPayloadsForStreaming(result);
        rewriteArrayOutputsForPaging(result);

        res.json({
            success: true,
            sessionId: session.id,
            version: session.version,
            deltas: Array.isArray(result?.node_deltas) ? result.node_deltas : [],
            connectionDeltas: Array.isArray(result?.connection_deltas) ? result.connection_deltas : [],
            execution_stats: result?.execution_stats || null,
            stdout,
            cacheHit: false,
            incremental: true,
            affectedNodeCount: 1,
            affectedNodes: [nodeId],
            workerMode
        });
    } catch (error) {
        const status = error?.status || 500;
        const body = error?.body || { error: 'Output fetch failed', message: error.message };
        res.status(status).json(body);
    }
});

app.post('/graph/:sessionId/output-page', async (req, res) => {
    const session = getGraphSession(req.params.sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    const baseVersion = Number.isFinite(req.body?.baseVersion) ? req.body.baseVersion : null;
    if (baseVersion !== null && baseVersion !== session.version) {
        return res.status(409).json({
            error: 'version_mismatch',
            message: `Expected version ${baseVersion}, current ${session.version}`,
            version: session.version
        });
    }

    const nodeId = Number(req.body?.nodeId);
    const socketId = typeof req.body?.socketId === 'string' ? req.body.socketId : '';
    const offset = Number.isFinite(req.body?.offset) ? Math.max(0, Math.floor(req.body.offset)) : 0;
    const limit = Number.isFinite(req.body?.limit) ? Math.max(0, Math.floor(req.body.limit)) : 0;
    if (!Number.isFinite(nodeId) || !socketId) {
        return res.status(400).json({ error: 'Invalid nodeId or socketId' });
    }

    try {
        let result = null;
        let workerMode = ENABLE_PROCESSOR_WORKER ? 'reload_graph' : 'stateless_exec';
        if (ENABLE_PROCESSOR_WORKER) {
            const workerInSync =
                processorWorkerState.sessionId === session.id &&
                processorWorkerState.version === session.version;
            if (!workerInSync) {
                await ensureWorkerGraphForSession(session);
                workerMode = 'reload_graph';
            } else {
                workerMode = 'session_cached';
            }
            const msg = await sendProcessorWorkerCommand('read_output_page', {
                node_id: nodeId,
                socket_id: socketId,
                offset,
                limit
            });
            result = msg.results || null;
        } else {
            const execRes = await runProcessorWithGraph(session.graphData, {
                targetNodes: [nodeId],
                deltaOnly: true,
                omitOutputs: false,
                maxPreviewItems: 0,
                outputNodeIds: [nodeId],
                outputSockets: { [String(nodeId)]: [socketId] }
            });
            const firstNode = Array.isArray(execRes.result?.node_deltas)
                ? execRes.result.node_deltas.find((d) => Number(d?.id) === nodeId)
                : null;
            const fullOutput = firstNode?.outputs?.[socketId];
            if (Array.isArray(fullOutput)) {
                const page = fullOutput.slice(offset, limit > 0 ? offset + limit : undefined);
                result = {
                    id: nodeId,
                    socketId,
                    offset,
                    limit,
                    success: !!firstNode?.success,
                    output: page,
                    totalCount: fullOutput.length,
                    count: page.length,
                    hasMore: offset + page.length < fullOutput.length,
                    paginated: true
                };
            } else {
                result = {
                    id: nodeId,
                    socketId,
                    offset,
                    limit,
                    success: !!firstNode?.success,
                    output: fullOutput ?? null,
                    totalCount: 0,
                    count: 0,
                    hasMore: false,
                    paginated: false
                };
            }
            workerMode = 'stateless_exec';
        }

        res.json({
            success: true,
            sessionId: session.id,
            version: session.version,
            workerMode,
            result
        });
    } catch (error) {
        const status = error?.status || 500;
        const body = error?.body || { error: 'Output page fetch failed', message: error.message };
        res.status(status).json(body);
    }
});

// Backward-compatible execute endpoint (stateless).
app.post('/execute', async (req, res) => {
    try {
        const graphData = normalizeGraphData(req.body || {});
        const { result, stdout } = await runProcessorWithGraph(graphData);
        res.json({
            success: true,
            results: result,
            stdout
        });
    } catch (error) {
        const status = error?.status || 500;
        const body = error?.body || { error: 'Server error', message: error.message };
        res.status(status).json(body);
    }
});

app.get('/mesh/:meshId/:version/meta', (req, res) => {
    const { meshId, version } = req.params;
    const key = getMeshBlobKey(meshId, version);
    const blob = meshBlobStore.get(key);
    if (!blob) {
        return res.status(404).json({ error: 'Mesh blob not found' });
    }
    blob.lastAccess = Date.now();
    res.setHeader('Cache-Control', 'private, max-age=300, immutable');
    res.json({
        success: true,
        meshId: blob.meshId,
        version: blob.version,
        streamFormat: 'binary_chunk_v1',
        chunkSize: MESH_CHUNK_SIZE,
        fields: {
            positions: { count: blob.positions.length, dtype: 'f32' },
            triIndices: { count: blob.triIndices.length, dtype: 'u32' },
            lineIndices: { count: blob.lineIndices.length, dtype: 'u32' },
            pointIndices: { count: blob.pointIndices.length, dtype: 'u32' }
        }
    });
});

app.get('/mesh/:meshId/:version/chunk', (req, res) => {
    const { meshId, version } = req.params;
    const field = req.query.field;
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
    const limit = Math.max(1, Math.min(MESH_CHUNK_SIZE, parseInt(req.query.limit || String(MESH_CHUNK_SIZE), 10)));
    const key = getMeshBlobKey(meshId, version);
    const blob = meshBlobStore.get(key);
    if (!blob) {
        return res.status(404).json({ error: 'Mesh blob not found' });
    }
    if (field !== 'positions' && field !== 'triIndices' && field !== 'lineIndices' && field !== 'pointIndices' && field !== 'indices') {
        return res.status(400).json({ error: 'Invalid field.' });
    }
    const source = (field === 'indices') ? blob.triIndices : blob[field];
    if (!source || typeof source.length !== 'number' || typeof source.subarray !== 'function') {
        return res.status(400).json({ error: 'Field not available' });
    }
    const end = Math.min(source.length, offset + limit);
    blob.lastAccess = Date.now();
    const count = end - offset;
    const isPositions = field === 'positions';
    const typed = source.subarray(offset, end);
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300, immutable');
    res.setHeader('X-Chunk-Format', 'binary_chunk_v1');
    res.setHeader('X-Chunk-Field', field);
    res.setHeader('X-Chunk-DType', isPositions ? 'f32' : 'u32');
    res.setHeader('X-Chunk-Offset', String(offset));
    res.setHeader('X-Chunk-Count', String(count));
    res.setHeader('X-Chunk-Total', String(source.length));
    res.send(bytes);
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Server is running',
        processorWorkerEnabled: ENABLE_PROCESSOR_WORKER,
        processorWorkerAlive: !!(processorWorker && !processorWorker.killed),
        processorWorkerSessionId: processorWorkerState.sessionId,
        processorWorkerSessionVersion: processorWorkerState.version
    });
});

app.listen(PORT, () => {
    console.log('========================================');
    console.log('Node Graph Processor Server');
    console.log('========================================');
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('');
    console.log('Open your browser and navigate to:');
    console.log(`  http://localhost:${PORT}`);
    console.log('');
    console.log('Press Ctrl+C to stop the server');
    console.log('========================================');
});

process.on('exit', () => {
    if (processorWorker && !processorWorker.killed) {
        try {
            processorWorker.kill();
        } catch (_) {
        }
    }
});
