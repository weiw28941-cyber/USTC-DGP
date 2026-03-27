import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { Node } from '../WebUI/core/node.js';
import { NodeEditor } from '../WebUI/core/editor.js';
import { GraphPatchQueue } from '../WebUI/core/patch_queue.js';
import { ExecutionSessionClient } from '../WebUI/core/execution_session_client.js';
import { ExecutionResultApplier } from '../WebUI/core/execution_result_applier.js';
import { QueuedExecutionOptionsAccumulator } from '../WebUI/core/queued_execution_options.js';
import { MeshViewerPanel } from '../WebUI/ui/mesh_viewer_panel.js';
import { PreviewPanel } from '../WebUI/ui/preview_panel.js';
import { scheduleHandleAuxiliaryBuild as scheduleAuxiliaryLodBuild } from '../WebUI/ui/mesh_viewer_aux_lods.js';
import { ensureLineRenderResources } from '../WebUI/ui/mesh_viewer_lines.js';
import { ensureHandleRenderResources, ensurePointRenderResources } from '../WebUI/ui/mesh_viewer_handles.js';
import { getRequiredFieldsForDisplay } from '../WebUI/ui/mesh_viewer_streaming.js';
import { buildUniqueEdgeIndices, extractGeometry } from '../WebUI/ui/mesh_viewer_geometry.js';
import { chooseLineLodIndex, choosePointLodIndex } from '../WebUI/ui/mesh_viewer_lod.js';
import { updateColorbarTargets as updateMeshViewerObjectTargets } from '../WebUI/ui/mesh_viewer_object_ui.js';
import { prepareInteractionGeometry as prepareMeshViewerInteractionGeometry } from '../WebUI/ui/mesh_viewer_editing.js';
import { getSelectionData as getMeshViewerSelectionData } from '../WebUI/ui/mesh_viewer_edit_ui.js';
import { buildColorbarTextureData } from '../WebUI/ui/mesh_viewer_colorbar_gl.js';
import { rebuildHandleBuffers as rebuildMeshViewerHandleBuffers } from '../WebUI/ui/mesh_viewer_geometry_updates.js';
import { buildMetaText as buildMeshViewerMetaText } from '../WebUI/ui/mesh_viewer_runtime.js';
import { ensurePanel as ensureMeshViewerShell } from '../WebUI/ui/mesh_viewer_shell.js';
import { validateMeshViewerModuleContracts } from '../WebUI/ui/mesh_viewer_module_contracts.js';
import { handleDynamicSocketControl } from '../WebUI/core/dynamic_socket_controls.js';
import { applyPreviewTrackedNodeEdit, enqueueConnectionGraphChange } from '../WebUI/core/graph_change_execution.js';
import { applyNodePreviewContracts } from '../WebUI/core/node_preview_contracts.js';
import { PreviewRefreshScheduler, collectAffectedNodeIds } from '../WebUI/core/preview_refresh_scheduler.js';
import {
  DEFAULT_PAGED_PREVIEW_ITEMS
} from '../WebUI/core/output_transport.js';
import {
  viewerInteractionTriggersExecution
} from '../WebUI/core/graph_execution_rules.js';
import {
  buildNodePreviewExecutionOptions,
  buildIncrementalExecutionOptions,
  getPreferredPreviewSocketId
} from '../WebUI/core/execution_request_builder.js';

const require = createRequire(import.meta.url);
const serverGraphExecutionRules = require('../Server/graph_execution_rules.js');

function createJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    clone() {
      return createJsonResponse(status, payload);
    }
  };
}

async function testPatchQueue() {
  const queue = new GraphPatchQueue({
    coalescePatchBatch: (patches) => {
      const latestByKey = new Map();
      for (const patch of patches) {
        latestByKey.set(`${patch.op}|${patch.nodeId ?? ''}|${patch.key ?? ''}`, patch);
      }
      return [...latestByKey.values()];
    },
    defaultDelayMs: 1
  });

  let flushExecute = null;
  queue.enqueue(
    [
      { op: 'move_node', nodeId: 1, x: 10 },
      { op: 'move_node', nodeId: 1, x: 20 }
    ],
    {
      flushExecute: true,
      onFlush: (flag) => {
        flushExecute = flag;
      }
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(flushExecute, true);
  const batch = queue.consumePending();
  assert.equal(batch.length, 1);
  assert.equal(batch[0].x, 20);
}

async function testExecutionSessionClientCreateAndSnapshot() {
  const calls = [];
  const client = new ExecutionSessionClient({
    baseUrl: 'http://unit.test',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/graph/session')) {
        return createJsonResponse(200, { sessionId: 's1', version: 3 });
      }
      if (url.includes('/snapshot')) {
        return createJsonResponse(200, { version: 4 });
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  const graphData = { nodes: [], connections: [] };
  const createResp = await client.executeGraph(graphData, { execute: true });
  assert.equal(createResp.ok, true);
  assert.equal(client.sessionId, 's1');
  assert.equal(client.sessionVersion, 3);

  const snapshotResp = await client.executeGraph(graphData, { execute: false });
  assert.equal(snapshotResp.ok, true);
  assert.equal(client.sessionVersion, 4);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.includes('/graph/s1/snapshot'));
}

async function testExecutionSessionClientPatchRetry() {
  const calls = [];
  let patchAttempts = 0;
  const client = new ExecutionSessionClient({
    baseUrl: 'http://unit.test',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/graph/session')) {
        return createJsonResponse(200, { sessionId: 'session-a', version: 1 });
      }
      if (url.includes('/patch')) {
        patchAttempts += 1;
        if (patchAttempts === 1) {
          return createJsonResponse(409, { error: 'stale' });
        }
        return createJsonResponse(200, { version: 2 });
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  const resp = await client.dispatchGraphPatches(
    [{ op: 'set_node_property', nodeId: 1, key: 'value', value: 2 }],
    { graphData: { nodes: [], connections: [] }, execute: true }
  );
  assert.equal(resp.ok, true);
  assert.equal(client.sessionId, 'session-a');
  assert.equal(client.sessionVersion, 2);
  assert.equal(patchAttempts, 2);
}

async function testExecutionSessionClientOutputPage() {
  const calls = [];
  const client = new ExecutionSessionClient({
    baseUrl: 'http://unit.test',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/graph/session')) {
        return createJsonResponse(200, { sessionId: 'session-paged', version: 7 });
      }
      if (url.includes('/output-page')) {
        return createJsonResponse(200, {
          version: 8,
          result: {
            id: 3,
            socketId: 'vec',
            offset: 4,
            limit: 4,
            success: true,
            output: [4, 5, 6, 7],
            totalCount: 10,
            count: 4,
            hasMore: true,
            paginated: true
          }
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  const resp = await client.fetchNodeOutputPage(3, 'vec', {
    graphData: { nodes: [], connections: [] },
    offset: 4,
    limit: 4
  });
  assert.equal(resp.ok, true);
  assert.equal(client.sessionId, 'session-paged');
  assert.equal(client.sessionVersion, 8);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.includes('/graph/session-paged/output-page'));
}

async function testExecutionSessionClientVersionNeverRegresses() {
  let outputPageCallCount = 0;
  const client = new ExecutionSessionClient({
    baseUrl: 'http://unit.test',
    fetchImpl: async (url) => {
      if (url.endsWith('/graph/session')) {
        return createJsonResponse(200, { sessionId: 'session-version', version: 10 });
      }
      if (url.includes('/output-page')) {
        outputPageCallCount += 1;
        return createJsonResponse(200, {
          version: outputPageCallCount === 1 ? 11 : 9,
          result: {
            id: 3,
            socketId: 'vec',
            offset: 0,
            limit: 4,
            success: true,
            output: [1],
            totalCount: 1,
            count: 1,
            hasMore: false,
            paginated: true
          }
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  await client.fetchNodeOutputPage(3, 'vec', {
    graphData: { nodes: [], connections: [] },
    offset: 0,
    limit: 4
  });
  assert.equal(client.sessionVersion, 11);

  await client.fetchNodeOutputPage(3, 'vec', {
    offset: 0,
    limit: 4
  });
  assert.equal(client.sessionVersion, 11);
}

async function testExecutionSessionClientDedupesAndCachesOutputPages() {
  let outputPageCallCount = 0;
  const client = new ExecutionSessionClient({
    baseUrl: 'http://unit.test',
    fetchImpl: async (url) => {
      if (url.endsWith('/graph/session')) {
        return createJsonResponse(200, { sessionId: 'session-cache', version: 3 });
      }
      if (url.includes('/output-page')) {
        outputPageCallCount += 1;
        return createJsonResponse(200, {
          version: 4,
          result: {
            id: 9,
            socketId: 'vec',
            offset: 0,
            limit: 4,
            success: true,
            output: [0, 1, 2, 3],
            totalCount: 8,
            count: 4,
            hasMore: true,
            paginated: true
          }
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  await client.executeGraph({ nodes: [], connections: [] }, { execute: false });

  const [respA, respB] = await Promise.all([
    client.fetchNodeOutputPage(9, 'vec', {
      offset: 0,
      limit: 4
    }),
    client.fetchNodeOutputPage(9, 'vec', {
      offset: 0,
      limit: 4
    })
  ]);
  assert.equal(respA.ok, true);
  assert.equal(respB.ok, true);
  assert.equal(outputPageCallCount, 1);

  const respC = await client.fetchNodeOutputPage(9, 'vec', {
    offset: 0,
    limit: 4
  });
  assert.equal(respC.ok, true);
  assert.equal(outputPageCallCount, 1);
}

async function testMeshViewerPanelDedupesAndCachesChunks() {
  const originalFetch = globalThis.fetch;
  let positionsChunkCalls = 0;
  try {
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (!href.includes('/chunk?')) {
        throw new Error(`unexpected url: ${href}`);
      }
      const parsed = new URL(href, 'http://unit.test');
      const field = parsed.searchParams.get('field');
      if (field === 'positions') {
        positionsChunkCalls += 1;
        const typed = new Float32Array([0, 0, 0, 1, 0, 0]);
        return {
          ok: true,
          status: 200,
          headers: {
            get(name) {
              const lower = String(name).toLowerCase();
              if (lower === 'x-chunk-dtype') return 'f32';
              if (lower === 'x-chunk-count') return '6';
              return null;
            }
          },
          async arrayBuffer() {
            return typed.buffer.slice(0);
          }
        };
      }
      const typed = new Uint32Array([0, 1]);
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            const lower = String(name).toLowerCase();
            if (lower === 'x-chunk-dtype') return 'u32';
            if (lower === 'x-chunk-count') return '2';
            return null;
          }
        },
        async arrayBuffer() {
          return typed.buffer.slice(0);
        }
      };
    };

    const panel = new MeshViewerPanel();
    const payload = {
      meshId: 'mesh-1',
      version: 1,
      viewerType: 'mesh',
      stream: {
        mode: 'chunked',
        endpoint: 'http://unit.test/mesh/mesh-1/1',
        chunkSize: 6,
        maxParallel: 2,
        fields: {
          positions: { count: 6, dtype: 'f32' },
          triIndices: { count: 2, dtype: 'u32' },
          lineIndices: { count: 0, dtype: 'u32' },
          pointIndices: { count: 0, dtype: 'u32' }
        }
      }
    };

    const [first, second] = await Promise.all([
      panel.resolvePayload(payload),
      panel.resolvePayload(payload)
    ]);
    assert.equal(Array.isArray(first.positions), false);
    assert.equal(first.positions.length, 6);
    assert.equal(second.positions.length, 6);
    assert.equal(positionsChunkCalls, 1);

    const third = await panel.resolvePayload(payload);
    assert.equal(third.positions.length, 6);
    assert.equal(positionsChunkCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testMeshViewerPanelStagesInitialFieldFetches() {
  const originalFetch = globalThis.fetch;
  const requestedFields = [];
  try {
    globalThis.fetch = async (url) => {
      const href = String(url);
      const parsed = new URL(href, 'http://unit.test');
      const field = parsed.searchParams.get('field');
      requestedFields.push(field);
      if (field === 'positions') {
        const typed = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
        return {
          ok: true,
          status: 200,
          headers: {
            get(name) {
              const lower = String(name).toLowerCase();
              if (lower === 'x-chunk-dtype') return 'f32';
              if (lower === 'x-chunk-count') return '9';
              return null;
            }
          },
          async arrayBuffer() {
            return typed.buffer.slice(0);
          }
        };
      }
      const typed = field === 'triIndices'
        ? new Uint32Array([0, 1, 2])
        : new Uint32Array([0, 1]);
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            const lower = String(name).toLowerCase();
            if (lower === 'x-chunk-dtype') return 'u32';
            if (lower === 'x-chunk-count') return String(typed.length);
            return null;
          }
        },
        async arrayBuffer() {
          return typed.buffer.slice(0);
        }
      };
    };

    const panel = new MeshViewerPanel();
    const payload = {
      meshId: 'mesh-stage',
      version: 1,
      viewerType: 'mesh',
      triangleCount: 1,
      lineCount: 1,
      pointCount: 2,
      stream: {
        mode: 'chunked',
        endpoint: 'http://unit.test/mesh/mesh-stage/1',
        chunkSize: 16,
        maxParallel: 4,
        fields: {
          positions: { count: 9, dtype: 'f32' },
          triIndices: { count: 3, dtype: 'u32' },
          lineIndices: { count: 2, dtype: 'u32' },
          pointIndices: { count: 2, dtype: 'u32' }
        }
      }
    };

    const resolved = await panel.resolvePayload(payload);
    assert.equal(resolved.positions.length, 9);
    assert.equal(resolved.triIndices.length, 3);
    assert.equal(Array.isArray(resolved.loadedFields), true);
    assert.ok(requestedFields.includes('positions'));
    assert.ok(requestedFields.includes('triIndices'));
    assert.equal(requestedFields.includes('pointIndices'), false);
    assert.equal(requestedFields.includes('lineIndices'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testMeshViewerEnsureFieldsForDisplayHydratesHandleWithoutRebind() {
  const originalFetch = globalThis.fetch;
  const panel = new MeshViewerPanel();
  const payload = {
    meshId: 'mesh-hydrate',
    version: 1,
    viewerType: 'mesh',
    triangleCount: 1,
    lineCount: 1,
    pointCount: 2,
    stream: {
      mode: 'chunked',
      endpoint: 'http://unit.test/mesh/mesh-hydrate/1',
      chunkSize: 16,
      maxParallel: 4,
      fields: {
        positions: { count: 9, dtype: 'f32' },
        triIndices: { count: 3, dtype: 'u32' },
        lineIndices: { count: 2, dtype: 'u32' },
        pointIndices: { count: 2, dtype: 'u32' }
      }
    }
  };

  const hydratedPayload = {
    ...payload,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    triIndices: new Uint32Array([0, 1, 2]),
    lineIndices: new Uint32Array([0, 1]),
    pointIndices: new Uint32Array([0, 1]),
    loadedFields: ['positions', 'triIndices', 'lineIndices', 'pointIndices']
  };

  try {
    globalThis.fetch = async (url) => {
      const parsed = new URL(String(url), 'http://unit.test');
      const field = parsed.searchParams.get('field');
      const typed = field === 'positions'
        ? new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
        : field === 'triIndices'
          ? new Uint32Array([0, 1, 2])
          : new Uint32Array([0, 1]);
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            const lower = String(name).toLowerCase();
            if (lower === 'x-chunk-dtype') return field === 'positions' ? 'f32' : 'u32';
            if (lower === 'x-chunk-count') return String(typed.length);
            return null;
          }
        },
        async arrayBuffer() {
          return typed.buffer.slice(0);
        }
      };
    };

    panel.currentPayload = {
      ...payload,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triIndices: new Uint32Array([0, 1, 2]),
      loadedFields: ['positions', 'triIndices']
    };
    panel.currentMeshHandle = { key: 'mesh-hydrate', version: 1 };

    let bindMeshCalled = false;
    let startRenderLoopCalled = false;
    let scheduleViewerUiRefreshCalled = false;
    let scheduleHandleAuxiliaryBuildCalled = false;
    let meshCacheDeleteCalled = false;

    panel.hydrateHandleForPayload = (nextPayload) => {
      assert.deepEqual(nextPayload.loadedFields.sort(), hydratedPayload.loadedFields.sort());
      return { key: 'mesh-hydrate', version: 1, hydrated: true };
    };
    panel.bindMesh = () => {
      bindMeshCalled = true;
    };
    panel.startRenderLoop = () => {
      startRenderLoopCalled = true;
    };
    panel.scheduleViewerUiRefresh = () => {
      scheduleViewerUiRefreshCalled = true;
    };
    panel.scheduleHandleAuxiliaryBuild = (handle) => {
      scheduleHandleAuxiliaryBuildCalled = !!handle?.hydrated;
    };
    panel.meshCache = {
      delete() {
        meshCacheDeleteCalled = true;
      }
    };

    await panel.ensureFieldsForDisplay(
      { key: 'mesh-hydrate' },
      { faces: true, lines: true, points: true }
    );

    assert.equal(bindMeshCalled, false);
    assert.equal(meshCacheDeleteCalled, false);
    assert.equal(startRenderLoopCalled, true);
    assert.equal(scheduleViewerUiRefreshCalled, true);
    assert.equal(scheduleHandleAuxiliaryBuildCalled, true);
    assert.equal(panel.currentMeshHandle?.hydrated, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testMeshViewerLineDisplayPrefersLineIndicesOverTriangles() {
  const panel = new MeshViewerPanel();
  const payload = {
    meshId: 'mesh-lines-only',
    version: 1,
    viewerType: 'mesh',
    triangleCount: 10,
    lineCount: 4,
    pointCount: 0,
    stream: {
      mode: 'chunked',
      endpoint: 'http://unit.test/mesh/mesh-lines-only/1',
      chunkSize: 16,
      maxParallel: 4,
      fields: {
        positions: { count: 9, dtype: 'f32' },
        triIndices: { count: 30, dtype: 'u32' },
        lineIndices: { count: 8, dtype: 'u32' },
        pointIndices: { count: 0, dtype: 'u32' }
      }
    }
  };

  const required = getRequiredFieldsForDisplay(
    panel,
    payload,
    { faces: false, lines: true, points: false },
    { key: 'mesh-lines-only', objectType: 'mesh' },
  );

  assert.ok(required.has('positions'));
  assert.ok(required.has('lineIndices'));
  assert.equal(required.has('triIndices') || required.has('indices'), false);
}

async function testMeshViewerAuxiliaryBuildDoesNotEagerlyBuildEdgeLods() {
  const viewer = {
    gl: {
      createBuffer() {
        return {};
      },
      bindBuffer() {},
      bufferData() {},
      ELEMENT_ARRAY_BUFFER: 1,
      STATIC_DRAW: 2
    },
    pendingHandleAuxBuilds: new Map(),
    afterNextPaint: async () => {},
    buildLodIndices(indices, step) {
      return step > 1 ? indices.slice(0, Math.max(3, indices.length / step)) : indices;
    },
    buildLineLodIndices(indices, step) {
      return step > 1 ? indices.slice(0, Math.max(2, indices.length / step)) : indices;
    },
    buildPointLodIndices(indices, step) {
      return step > 1 ? indices.slice(0, Math.max(1, indices.length / step)) : indices;
    },
    buildDirectedArrowLod() {
      return { vao: {}, vbo: {}, vertexCount: 2 };
    },
    currentMeshHandle: null,
    startRenderLoop() {}
  };

  const handle = {
    key: 'mesh-aux',
    triIndices: [0, 1, 2, 0, 2, 3],
    lods: [{ ebo: {}, indexCount: 6 }],
    lineLods: [{ ebo: {}, indexCount: 4 }],
    pointLods: [{ ebo: {}, indexCount: 4 }],
    arrowLods: [{ vao: {}, vbo: {}, vertexCount: 2 }],
    edgeLods: null,
    geometry: {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      colors: [],
      lineIndices: [0, 1, 1, 2],
      pointIndices: [0, 1, 2, 3],
      vectorLineFlags: [0, 0]
    },
    auxBuffersReady: false
  };

  await scheduleAuxiliaryLodBuild(viewer, handle);

  assert.equal(handle.auxBuffersReady, true);
  assert.ok(Array.isArray(handle.lods) && handle.lods.length >= 1);
  assert.ok(Array.isArray(handle.lineLods) && handle.lineLods.length >= 1);
  assert.ok(Array.isArray(handle.pointLods) && handle.pointLods.length >= 1);
  assert.ok(Array.isArray(handle.arrowLods) && handle.arrowLods.length >= 1);
  assert.equal(handle.edgeLods, null);
}

async function testMeshViewerLinesModuleSchedulesEdgeLodsOnlyWhenNeeded() {
  const viewer = {
    pendingEdgeLodBuilds: new Map(),
    afterNextPaint: async () => {},
    gl: {
      createBuffer() {
        return {};
      },
      bindBuffer() {},
      bufferData() {},
      ELEMENT_ARRAY_BUFFER: 1,
      STATIC_DRAW: 2
    },
    buildLodIndices(indices) {
      return indices;
    },
    startRenderLoop() {}
  };

  const meshWithoutNativeLines = {
    key: 'mesh-a',
    triIndices: [0, 1, 2, 0, 2, 3],
    lineLods: [{ ebo: {}, indexCount: 0 }],
    edgeLods: null
  };
  ensureLineRenderResources(viewer, meshWithoutNativeLines);
  const pending = viewer.pendingEdgeLodBuilds.get('mesh-a');
  assert.ok(pending);
  await pending;

  const meshWithNativeLines = {
    key: 'mesh-b',
    triIndices: [0, 1, 2],
    lineLods: [{ ebo: {}, indexCount: 2 }],
    edgeLods: null
  };
  ensureLineRenderResources(viewer, meshWithNativeLines);

  assert.ok(Array.isArray(meshWithoutNativeLines.edgeLods));
  assert.equal(meshWithNativeLines.edgeLods, null);
  assert.equal(viewer.pendingEdgeLodBuilds.has('mesh-b'), false);
}

function testMeshViewerGeometryExtractsMeshPointIndicesByDefault() {
  const geom = extractGeometry({}, {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ]),
    triIndices: new Uint32Array([0, 1, 2])
  });
  assert.deepEqual(geom.pointIndices, [0, 1, 2]);
  assert.deepEqual(geom.lineIndices, [0, 1, 1, 2, 0, 2]);
}

function testMeshViewerGeometryBuildsUniqueMeshEdges() {
  const edges = buildUniqueEdgeIndices([0, 1, 2, 2, 1, 3]);
  assert.deepEqual(edges, [0, 1, 1, 2, 0, 2, 1, 3, 2, 3]);
}

function testMeshViewerGeometryMarksDerivedMeshEdges() {
  const geom = extractGeometry({}, {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    triIndices: [0, 1, 2]
  });
  assert.equal(geom.lineIndicesDerived, true);
}

function testMeshViewerDerivedMeshEdgesUseFullLineLod() {
  const lodIndex = chooseLineLodIndex({}, {
    geometry: {
      lineIndicesDerived: true
    },
    lineLods: [
      { indexCount: 20000 },
      { indexCount: 10000 },
      { indexCount: 5000 }
    ]
  }, 2);
  assert.equal(lodIndex, 2);
}

function testMeshViewerNativeLinesUseFullLodNearCamera() {
  const lodIndex = chooseLineLodIndex({}, {
    geometry: {
      lineIndicesDerived: false
    },
    lineLods: [
      { indexCount: 20000 },
      { indexCount: 10000 },
      { indexCount: 5000 }
    ],
    edgeLods: []
  }, 2);
  assert.equal(lodIndex, 2);
}

function testMeshViewerPointsUseFullLodNearCamera() {
  const lodIndex = choosePointLodIndex({}, {
    pointLods: [
      { indexCount: 60000 },
      { indexCount: 30000 },
      { indexCount: 15000 }
    ]
  }, 2);
  assert.equal(lodIndex, 2);
}

function testMeshViewerLinesFollowSharedFaceLodWhenFar() {
  const lodIndex = chooseLineLodIndex({ cameraDistance: 6.0 }, {
    geometry: {
      lineIndicesDerived: true
    },
    lineLods: [
      { indexCount: 20000 },
      { indexCount: 10000 },
      { indexCount: 5000 }
    ],
    edgeLods: [
      { indexCount: 20000 },
      { indexCount: 10000 },
      { indexCount: 5000 }
    ]
  }, 1);
  assert.equal(lodIndex, 1);
}

function testMeshViewerPointsFollowSharedFaceLodWhenFar() {
  const lodIndex = choosePointLodIndex({ cameraDistance: 6.0 }, {
    pointLods: [
      { indexCount: 60000 },
      { indexCount: 30000 },
      { indexCount: 15000 }
    ]
  }, 1);
  assert.equal(lodIndex, 1);
}

function testMeshViewerLinesModuleBuildsImmediateEdgesForCurrentMesh() {
  const viewer = {
    pendingEdgeLodBuilds: new Map(),
    afterNextPaint: async () => {},
    gl: {
      createBuffer() {
        return {};
      },
      bindBuffer() {},
      bufferData() {},
      ELEMENT_ARRAY_BUFFER: 1,
      STATIC_DRAW: 2
    },
    buildLodIndices(indices) {
      return indices;
    },
    startRenderLoop() {},
    currentMeshHandle: null
  };

  const mesh = {
    key: 'mesh-current',
    triIndices: [0, 1, 2, 0, 2, 3],
    lineLods: [{ ebo: {}, indexCount: 0 }],
    edgeLods: null
  };
  viewer.currentMeshHandle = mesh;

  ensureLineRenderResources(viewer, mesh);

  assert.ok(Array.isArray(mesh.edgeLods));
  assert.ok(mesh.edgeLods[0].indexCount > 0);
  assert.equal(viewer.pendingEdgeLodBuilds.has('mesh-current'), false);
}

function testMeshViewerHandlesEnsurePointRenderResourcesBuildsVertexPoints() {
  const viewer = {
    gl: {
      createBuffer() {
        return {};
      },
      bindBuffer() {},
      bufferData() {},
      ELEMENT_ARRAY_BUFFER: 1,
      STATIC_DRAW: 2
    }
  };
  const handle = {
    vertexCount: 3,
    pointLods: [{ ebo: {}, indexCount: 0 }],
    geometry: {
      vertexCount: 3,
      pointIndices: []
    }
  };
  ensurePointRenderResources(viewer, handle);
  assert.deepEqual(handle.geometry.pointIndices, [0, 1, 2]);
  assert.equal(handle.pointLods[0].indexCount, 3);
}

function testMeshViewerHandlesEnsureHandleRenderResourcesBuildsLinesAndPoints() {
  const viewer = {
    gl: {
      createBuffer() {
        return {};
      },
      bindBuffer() {},
      bufferData() {},
      ELEMENT_ARRAY_BUFFER: 1,
      STATIC_DRAW: 2
    },
    buildDirectedArrowLod() {
      return { vao: {}, vbo: {}, vertexCount: 2 };
    }
  };
  const handle = {
    vertexCount: 4,
    lineLods: [{ ebo: {}, indexCount: 0 }],
    pointLods: [{ ebo: {}, indexCount: 0 }],
    geometry: {
      vertexCount: 4,
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      colors: [],
      lineIndices: [0, 1, 1, 2, 2, 3, 3, 0],
      pointIndices: [0, 1, 2, 3],
      vectorLineFlags: []
    }
  };
  ensureHandleRenderResources(viewer, handle);
  assert.equal(handle.lineLods[0].indexCount, 8);
  assert.equal(handle.pointLods[0].indexCount, 4);
}

function testMeshViewerHandlesEnsureLineRenderBuffersDerivesEdgesFromTriangles() {
  const viewer = {
    gl: {
      createBuffer() {
        return {};
      },
      bindBuffer() {},
      bufferData() {},
      ELEMENT_ARRAY_BUFFER: 1,
      STATIC_DRAW: 2
    },
    buildDirectedArrowLod() {
      return { vao: {}, vbo: {}, vertexCount: 0 };
    }
  };
  const handle = {
    triIndices: [0, 1, 2, 0, 2, 3],
    lineLods: [{ ebo: {}, indexCount: 0 }],
    geometry: {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      colors: [],
      lineIndices: [],
      vectorLineFlags: []
    }
  };
  ensureHandleRenderResources(viewer, handle);
  assert.deepEqual(handle.geometry.lineIndices, [0, 1, 1, 2, 0, 2, 2, 3, 0, 3]);
  assert.equal(handle.lineLods[0].indexCount, 10);
}

function testMeshViewerHandlesRehydratesCachedHandleForSameVersion() {
  const cached = {
    key: 'mesh-same-version',
    version: 7,
    isComposite: false,
    geometry: {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      triIndices: [0, 1, 2],
      lineIndices: [],
      pointIndices: [],
      colors: [],
      vectorLineFlags: []
    },
    triIndices: [0, 1, 2],
    lods: [{ ebo: {}, indexCount: 3 }],
    lineLods: [{ ebo: {}, indexCount: 0 }],
    pointLods: [{ ebo: {}, indexCount: 0 }],
    arrowLods: [{ vao: {}, vbo: {}, vertexCount: 0 }],
    edgeLods: null
  };
  const viewer = {
    gl: {
      createBuffer() {
        return {};
      },
      bindBuffer() {},
      bufferData() {},
      ELEMENT_ARRAY_BUFFER: 1,
      STATIC_DRAW: 2
    },
    program: {},
    meshCache: new Map([['mesh-same-version', cached]]),
    extractGeometry() {
      return {
        vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        triIndices: [0, 1, 2],
        lineIndices: [0, 1, 1, 2, 0, 2],
        pointIndices: [0, 1, 2],
        vectorLineFlags: [],
        vertexCount: 3
      };
    },
    releaseIndexedLodBuffers() {},
    releaseArrowLodBuffers() {},
    buildDirectedArrowLod() {
      return { vao: {}, vbo: {}, vertexCount: 0 };
    }
  };
  const payload = { meshId: 'mesh-same-version', version: 7 };
  const handle = MeshViewerPanel.prototype.getOrCreateHandleForPayload.call(viewer, payload);
  assert.equal(handle, cached);
  assert.deepEqual(handle.geometry.pointIndices, [0, 1, 2]);
  assert.deepEqual(handle.geometry.lineIndices, [0, 1, 1, 2, 0, 2]);
}

async function testMeshViewerObjectUiInitializesTargetsAndDefaults() {
  const optionNodes = [];
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        value: '',
        textContent: '',
        style: {},
        dataset: {},
        classList: { toggle() {} },
        setAttribute() {},
        appendChild() {},
        addEventListener() {}
      };
    }
  };
  const viewer = {
    currentMeshHandle: {
      key: 'mesh-root',
      version: 7,
      parts: [
        { key: 'mesh-part', label: 'Mesh Part', objectType: 'mesh', texturePath: 'builtin://checkerboard', triIndices: [0, 1, 2] },
        { key: 'line-part', label: 'Line Part', objectType: 'lines', geometry: { lineIndices: [0, 1] } }
      ]
    },
    objectSelect: {
      innerHTML: '',
      value: '',
      style: {},
      appendChild(node) {
        optionNodes.push(node);
      }
    },
    objectColorbars: new Map(),
    objectVisibility: new Map(),
    objectTextureOverrides: new Map(),
    objectDisplayModes: new Map(),
    objectColorModes: new Map(),
    textureOverrideScope: '',
    activeColorbarTarget: '',
    panel: {
      querySelectorAll() {
        return [];
      }
    },
    colorbar: {
      setStops() {},
      setVisible() {}
    },
    colorbarSaveBtn: { style: {} },
    colorbarLoadBtn: { style: {} },
    getDefaultColorbarStops() {
      return [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }];
    },
    getAllowedColorModes(handle) {
      return handle.objectType === 'lines' ? ['lit', 'colormap'] : ['lit', 'colormap', 'texture'];
    },
    getHandleObjectType(handle) {
      return handle.objectType || 'mesh';
    },
    getHandleByKey(handleKey) {
      const handles = this.currentMeshHandle.parts || [this.currentMeshHandle];
      return handles.find((handle) => handle.key === handleKey) || null;
    },
    getHandleColorMode(handle) {
      return this.objectColorModes.get(handle.key) || 'lit';
    },
    getDefaultDisplayFlagsForHandle(handle) {
      return handle.objectType === 'lines'
        ? { faces: false, lines: true, points: false }
        : { faces: true, lines: true, points: false };
    },
    getAllowedDisplayFlags(handle) {
      return handle.objectType === 'lines'
        ? { points: true, lines: true, faces: false }
        : { points: true, lines: true, faces: true };
    },
    getObjectDisplayFlags(handle) {
      return this.objectDisplayModes.get(handle.key) || this.getDefaultDisplayFlagsForHandle(handle);
    },
    syncColorbarEditorToActiveTarget() {},
    updateModeButtons() {},
    refreshObjectFilterCounts() {},
    refreshObjectListUI() {}
  };

  try {
    updateMeshViewerObjectTargets(viewer);

    assert.equal(optionNodes.length, 2);
    assert.equal(viewer.activeColorbarTarget, 'mesh-part');
    assert.equal(viewer.objectVisibility.get('mesh-part'), true);
    assert.equal(viewer.objectVisibility.get('line-part'), true);
    assert.ok(viewer.objectColorbars.has('mesh-part'));
    assert.ok(viewer.objectDisplayModes.has('line-part'));
    assert.equal(viewer.objectTextureOverrides.get('mesh-part'), 'builtin://checkerboard');
  } finally {
    globalThis.document = previousDocument;
  }
}

async function testMeshViewerEditingModuleBuildsInteractionGeometry() {
  const viewer = {
    vertexPositions: new Map(),
    edgeList: [],
    faceList: [],
    vertexBVH: null,
    edgeBVH: null,
    faceBVH: null,
    currentPayload: { boundsMin: [0, 0, 0], boundsMax: [1, 1, 0] }
  };
  const handle = {
    geometryInteractionReady: false,
    geometry: {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      triIndices: [0, 1, 2, 0, 2, 3],
      lineIndices: []
    }
  };

  prepareMeshViewerInteractionGeometry(viewer, handle);

  assert.equal(handle.geometryInteractionReady, true);
  assert.equal(viewer.vertexPositions.size, 4);
  assert.equal(viewer.faceList.length, 2);
  assert.ok(viewer.edgeList.length >= 4);
  assert.ok(viewer.vertexBVH);
  assert.ok(viewer.faceBVH);
}

async function testVectorPreviewPanelRefreshesAfterUpstreamValueEdit() {
  const valueNode = {
    id: 30,
    type: 'value',
    success: true,
    errorMessage: '',
    errorInputs: new Set(),
    errorOutputs: new Set(),
    previewMeta: {},
    config: { name: 'Value' }
  };
  const vectorNode = {
    id: 31,
    type: 'vector',
    success: true,
    errorMessage: '',
    errorInputs: new Set(),
    errorOutputs: new Set(),
    previewValue: [0],
    previewMeta: {
      socketId: 'vec',
      loadedCount: 1,
      totalCount: 1,
      hasMorePages: false,
      outputsTruncated: false,
      previewEpoch: 1
    },
    config: { name: 'Vector' }
  };

  let latestVectorPage = [1];
  const editor = {
    nodes: [valueNode, vectorNode],
    connections: [],
    lastInteractionStateOutputs: null,
    previewPanel: {
      node: vectorNode,
      refresh(node) {
        this.node = node;
        if (node?.previewValue?.stream?.mode === 'paged' || node?.previewMeta?.outputsTruncated === true) {
          editor.fetchPreviewPageForNode(node, {
            socketId: 'vec',
            offset: 0,
            limit: 4
          }).catch(() => {});
        }
      }
    },
    meshViewerPanel: {
      updateIfVisible() {},
      setPreviewStatus() {}
    },
    requestRender() {},
    getPreviewBudget() {
      return 64;
    },
    async fetchPreviewPageForNode(node) {
      node.previewValue = latestVectorPage.slice();
      node.previewMeta = {
        ...node.previewMeta,
        socketId: 'vec',
        loadedCount: latestVectorPage.length,
        totalCount: latestVectorPage.length,
        hasMorePages: false,
        outputsTruncated: false
      };
      return true;
    }
  };

  const applier = new ExecutionResultApplier(editor);
  applier.applyExecutionResult({
    success: true,
    deltas: [
      {
        id: 31,
        success: true,
        error: '',
        outputs_truncated: true,
        max_preview_items: 4,
        outputs: {
          vec: {
            stream: {
              mode: 'paged',
              socketId: 'vec',
              totalCount: 1,
              loadedCount: 0,
              pageSize: 4
            },
            paginated: true
          }
        }
      }
    ],
    connectionDeltas: []
  }, { silent: true });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(vectorNode.previewValue, [1]);
  assert.equal(vectorNode.previewMeta.loadedCount, 1);
}

function testPagedPreviewDoesNotCollapseAfterDescriptorRefresh() {
  const node = {
    id: 88,
    type: 'vector',
    success: true,
    errorMessage: '',
    errorInputs: new Set(),
    errorOutputs: new Set(),
    previewValue: [1, 2, 3, 4],
    previewMeta: {
      socketId: 'vec',
      loadedCount: 4,
      totalCount: 10,
      hasMorePages: true,
      outputsTruncated: true,
      previewEpoch: 1
    },
    config: { name: 'Vector' }
  };

  const editor = {
    nodes: [node],
    connections: [],
    lastInteractionStateOutputs: null,
    previewPanel: null,
    meshViewerPanel: {
      updateIfVisible() {},
      setPreviewStatus() {}
    },
    requestRender() {},
    getPreviewBudget() {
      return 64;
    }
  };

  const applier = new ExecutionResultApplier(editor);
  applier.applyExecutionResult({
    success: true,
    deltas: [
      {
        id: 88,
        success: true,
        error: '',
        outputs_truncated: true,
        max_preview_items: 64,
        outputs: {
          vec: {
            stream: {
              mode: 'paged',
              socketId: 'vec',
              totalCount: 10,
              loadedCount: 0,
              pageSize: 64
            },
            paginated: true
          }
        }
      }
    ],
    connectionDeltas: []
  }, { silent: true });

  assert.deepEqual(node.previewValue, [1, 2, 3, 4]);
  assert.equal(node.previewMeta.loadedCount, 4);
  assert.equal(node.previewMeta.totalCount, 10);
  assert.equal(node.previewMeta.hasMorePages, true);
  assert.equal(node.previewMeta.pageSize, 64);
}

async function testMatrixPreviewUsesPagedRowBudgetAfterArrayHydration() {
  const node = {
    id: 77,
    type: 'matrix_unary',
    previewValue: [[1, 2, 3], [4, 5, 6]],
    previewMeta: {
      socketId: 'result',
      loadedCount: 2,
      totalCount: 300,
      hasMorePages: true,
      outputsTruncated: true,
      pageSize: 66,
      rows: 300,
      cols: 3,
      pageUnit: 'rows',
      previewEpoch: 1
    },
    config: { name: 'Matrix Unary' }
  };

  const pageRequests = [];
  const editor = {
    shouldProgressivelyLoadFullPreview() {
      return false;
    },
    isPreviewPageFetchInFlight() {
      return false;
    },
    async fetchPreviewPageForNode(targetNode, options) {
      pageRequests.push({
        nodeId: targetNode?.id,
        socketId: options?.socketId,
        offset: options?.offset,
        limit: options?.limit
      });
      return true;
    }
  };

  const panel = new PreviewPanel(editor);
  panel.ensurePreviewDataRequested(node);
  assert.equal(pageRequests.length, 0);
}


function testExecutionRequestBuilder() {
  assert.equal(getPreferredPreviewSocketId({ type: 'vector', previewSocket: 'vec', outputs: [{ id: 'vec' }] }), 'vec');
  assert.equal(getPreferredPreviewSocketId({ type: 'interaction_state', previewSocket: null, outputs: [{ id: 'state' }] }), null);
  assert.equal(getPreferredPreviewSocketId({ type: 'mesh', previewSocket: 'view', outputs: [{ id: 'view' }, { id: 'result' }] }), 'view');
  assert.equal(getPreferredPreviewSocketId({ type: 'geometry_viewer', previewSocket: 'view', outputs: [{ id: 'view' }] }), 'view');

  const context = {
    selectedNode: { id: 1, type: 'vector', previewSocket: 'vec', outputs: [{ id: 'vec' }] },
    previewHoldNode: { id: 2, type: 'list', previewSocket: 'list', outputs: [{ id: 'list' }] },
    previewPanel: { node: { id: 2, type: 'list', previewSocket: 'list', outputs: [{ id: 'list' }] } },
    meshViewerPanel: { currentNodeId: 3 },
    interactionFocusNodeIds: new Set([4]),
    nodes: [
      { id: 1, type: 'vector', previewSocket: 'vec', outputs: [{ id: 'vec' }] },
      { id: 2, type: 'list', previewSocket: 'list', outputs: [{ id: 'list' }] },
      { id: 3, type: 'geometry_viewer', previewSocket: 'view', outputs: [{ id: 'view' }] },
      { id: 4, type: 'interaction_state', previewSocket: null, outputs: [{ id: 'state' }] }
    ],
    getPreviewBudget() {
      return 128;
    }
  };

  const options = buildIncrementalExecutionOptions(context);
  assert.equal(options.omitOutputs, false);
  assert.deepEqual(new Set(options.outputNodeIds), new Set([2, 3, 4]));
  assert.deepEqual(options.outputSockets['2'], ['list']);
  assert.deepEqual(options.outputSockets['3'], ['view']);
  assert.equal(options.outputSockets['4'], undefined);
  assert.equal(options.maxPreviewItems, DEFAULT_PAGED_PREVIEW_ITEMS);

  const connectionOptions = buildNodePreviewExecutionOptions([
    { id: 31, type: 'vector', previewSocket: 'vec', outputs: [{ id: 'vec' }] },
    { id: 32, type: 'interaction_state', previewSocket: null, outputs: [{ id: 'state' }] }
  ]);
  assert.deepEqual(connectionOptions.outputNodeIds, [31, 32]);
  assert.deepEqual(connectionOptions.outputSockets['31'], ['vec']);
  assert.equal(connectionOptions.outputSockets['32'], undefined);
}

function testNodePreviewContractsAssignDeclaredPreviewSockets() {
  const nodeTypes = applyNodePreviewContracts([
    { id: 'value', outputs: [{ id: 'out' }] },
    { id: 'vector', outputs: [{ id: 'vec' }] },
    { id: 'geometry_viewer', outputs: [{ id: 'view' }] },
    { id: 'interaction_state', outputs: [{ id: 'state' }] }
  ]);
  assert.equal(nodeTypes[0].previewSocket, 'out');
  assert.equal(nodeTypes[1].previewSocket, 'vec');
  assert.equal(nodeTypes[2].previewSocket, 'view');
  assert.equal(nodeTypes[3].previewSocket, null);
  assert.equal(
    getPreferredPreviewSocketId({ config: nodeTypes[1], outputs: nodeTypes[1].outputs }),
    'vec'
  );
  assert.throws(
    () => getPreferredPreviewSocketId({ type: 'vector', outputs: [{ id: 'vec' }] }),
    /Missing previewSocket contract/
  );
}

function testEditorPreferredPromptKeys() {
  const fakeEditor = Object.create(NodeEditor.prototype);
  fakeEditor.nodeTypes = [
    {
      id: 'value',
      name: 'Value',
      properties: {
        value: { editable: true, type: 'number', description: 'Constant value' }
      }
    },
    {
      id: 'string',
      name: 'String',
      properties: {
        text: { editable: true, type: 'string', description: 'Editable text' }
      }
    },
    {
      id: 'load_mesh',
      name: 'Load Mesh',
      properties: {
        path: { editable: true, type: 'string', description: 'Mesh path' }
      }
    },
    {
      id: 'vector',
      name: 'Vector',
      properties: {
        operation: { editable: true, options: ['number', 'string'], description: 'Value type' },
        values: { editable: true, type: 'array', description: 'Values' }
      }
    }
  ];

  const editors = fakeEditor.createNodeEditors();
  assert.equal(editors.value.patchKey, 'value');
  assert.equal(editors.string.patchKey, 'text');
  assert.equal(editors.load_mesh.patchKey, 'path');
  assert.equal(editors.vector.patchKey, 'operation');
  assert.equal(editors.vector.kind, 'cycle');
}

function testVectorOperationCycleSyncsSocketTypes() {
  const fakeEditor = Object.create(NodeEditor.prototype);
  fakeEditor.nodeTypes = [
    {
      id: 'vector',
      name: 'Vector',
      properties: {
        operation: { editable: true, options: ['number', 'string'], description: 'Value type' },
        values: { editable: true, type: 'array', description: 'Values' }
      }
    }
  ];
  fakeEditor.nodeEditors = fakeEditor.createNodeEditors();
  fakeEditor.connections = [];
  fakeEditor.saveHistory = () => {};
  fakeEditor.requestRender = () => {};
  let capturedExecutionOptions = null;
  fakeEditor.enqueueGraphPatches = (_patches, options) => {
    capturedExecutionOptions = options?.executionOptions || null;
  };
  fakeEditor.getPreferredPreviewSocketId = () => 'vec';
  fakeEditor.scheduleAutoExecute = () => {};
  const node = {
    id: 7,
    type: 'vector',
    previewSocket: 'vec',
    operation: 'number',
    values: [1, 2],
    inputs: [
      { id: 'x', label: 'X', type: 'number', customType: '', connection: null },
      { id: 'y', label: 'Y', type: 'number', customType: '', connection: null }
    ],
    outputs: [{ id: 'vec' }],
    config: { name: 'Vector', previewSocket: 'vec' },
    updateAutoSize() {}
  };
  fakeEditor.cycleNodeOperation(node);
  assert.equal(node.operation, 'string');
  assert.deepEqual(node.values, ['1', '2']);
  assert.deepEqual(node.inputs.map((input) => input.type), ['string', 'string']);
  assert.deepEqual(capturedExecutionOptions?.outputNodeIds, [7]);
  assert.deepEqual(capturedExecutionOptions?.outputSockets?.['7'], ['vec']);
}

function testOperationCycleDispatchesPreviewRecomputeForGenericNode() {
  const fakeEditor = Object.create(NodeEditor.prototype);
  fakeEditor.nodeTypes = [
    {
      id: 'vector_math',
      name: 'Vector Math',
      properties: {
        operation: { editable: true, options: ['add', 'subtract'], description: 'Operation' }
      }
    }
  ];
  fakeEditor.nodeEditors = fakeEditor.createNodeEditors();
  fakeEditor.connections = [];
  fakeEditor.saveHistory = () => {};
  fakeEditor.requestRender = () => {};
  let capturedExecutionOptions = null;
  let capturedPatch = null;
  fakeEditor.enqueueGraphPatches = (patches, options) => {
    capturedPatch = Array.isArray(patches) ? patches[0] : null;
    capturedExecutionOptions = options?.executionOptions || null;
  };
  fakeEditor.getPreferredPreviewSocketId = () => 'result';
  fakeEditor.scheduleAutoExecute = () => {};
  const node = {
    id: 12,
    type: 'vector_math',
    previewSocket: 'result',
    operation: 'add',
    outputs: [{ id: 'result' }],
    config: { name: 'Vector Math', previewSocket: 'result' }
  };

  const changed = fakeEditor.cycleNodeOperation(node);
  assert.equal(changed, true);
  assert.equal(node.operation, 'subtract');
  assert.equal(capturedPatch?.op, 'set_node_property');
  assert.equal(capturedPatch?.nodeId, 12);
  assert.equal(capturedPatch?.key, 'operation');
  assert.equal(capturedPatch?.value, 'subtract');
  assert.deepEqual(capturedExecutionOptions?.outputNodeIds, [12]);
  assert.deepEqual(capturedExecutionOptions?.outputSockets?.['12'], ['result']);
}

function testSyncSessionAfterNodeEditRequiresExecutionOptions() {
  const fakeEditor = Object.create(NodeEditor.prototype);
  assert.throws(() => {
    fakeEditor.syncSessionAfterNodeEdit({
      op: 'set_node_property',
      nodeId: 21,
      key: 'value',
      value: 9
    }, {
      immediatePatchExecute: true
    });
  }, /Missing executionOptions/);
}

function testGraphChangeExecutionHelpersUseStandardPreviewChains() {
  let propertyExecutionOptions = null;
  let connectionExecutionOptions = null;
  const vectorNode = { id: 31, type: 'vector', previewSocket: 'vec', outputs: [{ id: 'vec' }] };
  const downstreamNode = { id: 32, type: 'vector', previewSocket: 'vec', outputs: [{ id: 'vec' }] };
  const downstreamNode2 = { id: 33, type: 'vector', previewSocket: 'vec', outputs: [{ id: 'vec' }] };
  const fakeEditor = {
    getPreferredPreviewSocketId: () => 'vec',
    mergeExecutionOptions(base, override) {
      return { ...(base || {}), ...(override || {}) };
    },
    nodes: [vectorNode, downstreamNode, downstreamNode2],
    connections: [
      {
        from_node: 31,
        from_socket: 'vec',
        to_node: 32,
        to_socket: 'x'
      },
      {
        from_node: 32,
        from_socket: 'vec',
        to_node: 33,
        to_socket: 'x'
      }
    ],
    applyNodeEdit(_history, updateFn, _syncSpec, options) {
      updateFn();
      propertyExecutionOptions = options?.executionOptions || null;
    },
    enqueueIncrementalExecutionPatches(_patches, options) {
      connectionExecutionOptions = options?.executionOptions || null;
    },
    extractConnectionEndpoints(conn) {
      return {
        fromNodeId: Number(conn.from_node),
        toNodeId: Number(conn.to_node),
        fromSocketId: String(conn.from_socket)
      };
    }
  };
  applyPreviewTrackedNodeEdit(
    fakeEditor,
    'Property Change',
    vectorNode,
    () => {},
    { op: 'set_node_property', nodeId: 31, key: 'values', value: [1] }
  );
  assert.deepEqual(new Set(propertyExecutionOptions?.outputNodeIds || []), new Set([31, 32, 33]));
  assert.deepEqual(propertyExecutionOptions?.outputSockets?.['31'], ['vec']);
  assert.deepEqual(propertyExecutionOptions?.outputSockets?.['32'], ['vec']);
  assert.deepEqual(propertyExecutionOptions?.outputSockets?.['33'], ['vec']);

  enqueueConnectionGraphChange(fakeEditor, [{ op: 'add_connection' }], [vectorNode]);
  assert.deepEqual(new Set(connectionExecutionOptions?.outputNodeIds || []), new Set([31, 32, 33]));
  assert.deepEqual(connectionExecutionOptions?.outputSockets?.['31'], ['vec']);
  assert.deepEqual(connectionExecutionOptions?.outputSockets?.['32'], ['vec']);
  assert.deepEqual(connectionExecutionOptions?.outputSockets?.['33'], ['vec']);
}

function testEnqueueIncrementalExecutionPatchesRequiresExecutionOptionsForConnections() {
  const fakeEditor = Object.create(NodeEditor.prototype);
  fakeEditor.enqueueGraphPatches = () => {};
  fakeEditor.scheduleAutoExecute = () => {};
  assert.throws(() => {
    fakeEditor.enqueueIncrementalExecutionPatches([
      {
        op: 'add_connection',
        from_node: 1,
        from_socket: 'out',
        to_node: 2,
        to_socket: 'x'
      }
    ]);
  }, /Missing executionOptions for connection graph change/);
}

async function testPreviewRefreshSchedulerMarksStaleAndRefreshesImmediateNodes() {
  const nodeA = { id: 41, outputs: [{ id: 'out' }], previewSocket: 'out', previewMeta: {}, previewValue: 1 };
  const nodeB = { id: 42, outputs: [{ id: 'vec' }], previewSocket: 'vec', previewMeta: {}, previewValue: [1] };
  const refreshed = [];
  const editor = {
    nodes: [nodeA, nodeB],
    previewPanel: { node: nodeB },
    meshViewerPanel: { currentNodeId: null },
    getPreferredPreviewSocketId(node) {
      return node.previewSocket;
    },
    async fetchPreviewDescriptorForNode(node) {
      refreshed.push(Number(node.id));
      return true;
    }
  };
  const scheduler = new PreviewRefreshScheduler(editor);
  scheduler.scheduleIdleRefreshes = (nodeIds) => {
    scheduler._idleIds = [...nodeIds];
  };
  await scheduler.processExecutionResult({
    success: true,
    execution_stats: {
      computedNodes: [41, 42],
      cacheHitNodes: []
    },
    deltas: [
      { id: 41, outputs: { out: 2 } }
    ]
  });
  assert.equal(nodeA.previewMeta.isStale, undefined);
  assert.equal(nodeB.previewMeta.isStale, false);
  assert.deepEqual(refreshed, [42]);
  assert.deepEqual(scheduler._idleIds || [], []);
}

function testCollectAffectedNodeIdsUsesExecutionStats() {
  const affected = collectAffectedNodeIds({
    success: true,
    execution_stats: {
      computedNodes: [1, 2],
      cacheHitNodes: [3]
    }
  });
  assert.deepEqual(new Set([...affected]), new Set([1, 2, 3]));
}

function testPreviewIconDoesNotRequireLoadedPreviewValue() {
  const node = new Node(1, 'load_mesh', 20, 20, {
    name: 'Load Mesh',
    color: '#38a169',
    inputs: [],
    outputs: [{ id: 'mesh', label: 'Mesh', type: 'custom' }],
    properties: {
      path: { default: '', editable: true, type: 'string' }
    }
  });
  node.success = true;
  node.previewValue = null;

  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    beginPath() {},
    roundRect() {},
    fill() {},
    stroke() {},
    fillText() {},
    fillRect() {},
    strokeRect() {},
    arc() {},
    ellipse() {},
    moveTo() {},
    lineTo() {},
    measureText(text) { return { width: String(text).length * 7 }; }
  };

  node.draw(ctx, false);
  assert.ok(node.previewIconBounds);
}

function testViewerInteractionExecutionRules() {
  const cameraPatch = {
    op: 'viewer_interaction',
    nodeId: 5,
    key: 'interaction_event',
    value: {
      channel: 'camera',
      phase: 'update',
      sourceNodeId: 5,
      targetNodeId: 5,
      version: 1,
      timestampMs: 1,
      payload: {
        action: 'viewer_camera_state',
        value: { eye: [0, 0, 5] }
      }
    }
  };
  const meshEditPatch = {
    op: 'viewer_interaction',
    nodeId: 5,
    key: 'interaction_event',
    value: {
      channel: 'mesh_edit',
      phase: 'commit',
      sourceNodeId: 5,
      targetNodeId: 5,
      version: 2,
      timestampMs: 2,
      payload: {
        action: 'mesh_edit_handles',
        handles: [{ id: 0, position: [1, 0, 0] }]
      }
    }
  };

  assert.equal(viewerInteractionTriggersExecution(cameraPatch), false);
  assert.equal(viewerInteractionTriggersExecution(meshEditPatch), true);
  assert.equal(serverGraphExecutionRules.viewerInteractionAffectsGraphExecution(cameraPatch), false);
  assert.equal(serverGraphExecutionRules.viewerInteractionAffectsGraphExecution(meshEditPatch), true);
}

function createDynamicSocketTestEditor() {
  const captured = {
    patches: [],
    executionOptions: []
  };
  const editor = {
    previewPanel: null,
    cloneJsonValue(value) {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    },
    getPreferredPreviewSocketId() {
      return 'vec';
    },
    pointInCircle(x, y, circle) {
      const dx = x - circle.cx;
      const dy = y - circle.cy;
      return (dx * dx + dy * dy) <= (circle.r * circle.r);
    },
    applyNodeEdit(_history, updateFn, syncSpec, options = {}) {
      updateFn();
      const resolvedSpec = typeof syncSpec === 'function' ? syncSpec() : syncSpec;
      captured.patches.push(resolvedSpec);
      captured.executionOptions.push(options.executionOptions || null);
      if (typeof options.afterUpdate === 'function') {
        options.afterUpdate();
      }
    },
    syncVectorInputs(node) {
      node.inputs = Array.from({ length: node.values.length }, (_, i) => ({ id: `v${i}` }));
    },
    syncListInputs(node) {
      node.inputs = Array.from({ length: node.values.length }, (_, i) => ({ id: `e${i}` }));
    },
    syncGeometryInputs(node) {
      const counts = Array.isArray(node.values) ? node.values.slice(0, 3) : [1, 1, 1];
      while (counts.length < 3) counts.push(1);
      node.values = counts;
      node.inputs = Array.from({ length: counts[0] + counts[1] + counts[2] + 1 }, (_, i) => ({ id: `g${i}` }));
    },
    shiftListConnections() {}
  };
  return { editor, captured };
}

function runDynamicSocketControlTest({
  type,
  initialValues,
  controlButtons,
  hitPoint,
  expectedValues,
  expectedHistoryPatchValue
}) {
  const { editor, captured } = createDynamicSocketTestEditor();
  const node = {
    id: 41,
    type,
    values: initialValues.slice(),
    inputs: Array.from({ length: initialValues.length }, (_, i) => ({ id: `in${i}` })),
    controlButtons,
    previewValue: null,
    previewMeta: {}
  };

  const handled = handleDynamicSocketControl(editor, node, hitPoint.x, hitPoint.y);
  assert.equal(handled, true);
  assert.deepEqual(node.values, expectedValues);
  assert.deepEqual(node.previewValue, expectedValues);
  assert.deepEqual(captured.patches[0]?.value, expectedHistoryPatchValue);
  assert.equal(captured.patches[0]?.key, 'values');
  assert.deepEqual(captured.executionOptions[0]?.outputNodeIds, [41]);
  assert.deepEqual(captured.executionOptions[0]?.outputSockets?.['41'], ['vec']);
}

function testDynamicSocketControlsAreModularized() {
  runDynamicSocketControlTest({
    type: 'vector',
    initialValues: [0],
    controlButtons: {
      vectorAdd: { cx: 10, cy: 10, r: 8 }
    },
    hitPoint: { x: 10, y: 10 },
    expectedValues: [0, 0],
    expectedHistoryPatchValue: [0, 0]
  });

  runDynamicSocketControlTest({
    type: 'list',
    initialValues: [1, 2],
    controlButtons: {
      listAdd: [{ cx: 20, cy: 20, r: 8, index: 0 }],
      listRemove: []
    },
    hitPoint: { x: 20, y: 20 },
    expectedValues: [1, 0, 2],
    expectedHistoryPatchValue: [1, 0, 2]
  });

  runDynamicSocketControlTest({
    type: 'geometry',
    initialValues: [1, 1, 1],
    controlButtons: {
      geometryAdd: [{ cx: 30, cy: 30, r: 8, bucket: 2 }],
      geometryRemove: []
    },
    hitPoint: { x: 30, y: 30 },
    expectedValues: [1, 1, 2],
    expectedHistoryPatchValue: [1, 1, 2]
  });
}

function testQueuedExecutionOptionsAccumulator() {
  const acc = new QueuedExecutionOptionsAccumulator((base, override) => {
    const left = base || {};
    const right = override || {};
    const ids = new Set([...(left.outputNodeIds || []), ...(right.outputNodeIds || [])]);
    const sockets = { ...(left.outputSockets || {}) };
    for (const [key, value] of Object.entries(right.outputSockets || {})) {
      sockets[key] = Array.from(new Set([...(sockets[key] || []), ...value]));
    }
    return {
      ...left,
      ...right,
      outputNodeIds: [...ids],
      outputSockets: sockets
    };
  });

  acc.queue({ outputNodeIds: [1], outputSockets: { '1': ['vec'] } });
  acc.queue({ outputNodeIds: [2], outputSockets: { '2': ['list'] } });
  const merged = acc.consume();
  assert.deepEqual(new Set(merged.outputNodeIds), new Set([1, 2]));
  assert.deepEqual(merged.outputSockets['1'], ['vec']);
  assert.deepEqual(merged.outputSockets['2'], ['list']);
  assert.equal(acc.consume(), null);
  acc.queue({ outputNodeIds: [3], outputSockets: { '3': ['view'] } });
  acc.clear();
  assert.equal(acc.consume(), null);
}

function testMeshViewerColorbarTextureModuleBuildsGradient() {
  const data = buildColorbarTextureData([
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' }
  ], 4);
  assert.equal(data.length, 16);
  assert.deepEqual(Array.from(data.slice(0, 4)), [0, 0, 0, 255]);
  assert.deepEqual(Array.from(data.slice(12, 16)), [255, 255, 255, 255]);
}

function testMeshViewerGeometryUpdatesRebuildsHandleBuffers() {
  const deleted = [];
  const uploaded = [];
  const viewer = {
    gl: {
      ARRAY_BUFFER: 'ARRAY_BUFFER',
      ELEMENT_ARRAY_BUFFER: 'ELEMENT_ARRAY_BUFFER',
      STATIC_DRAW: 'STATIC_DRAW',
      createBuffer() {
        return { id: Math.random() };
      },
      bindBuffer(target, buffer) {
        uploaded.push({ type: 'bind', target, buffer });
      },
      bufferData(target, data) {
        uploaded.push({ type: 'data', target, length: data.length });
      },
      deleteBuffer(buffer) {
        deleted.push(buffer);
      }
    }
  };
  const handle = {
    vbo: { id: 'vbo' },
    lods: [{ ebo: { id: 'old-a' }, indexCount: 3 }, { ebo: { id: 'old-b' }, indexCount: 3 }],
    geometry: {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      triIndices: [0, 1, 2],
      colors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      uv: [[0, 0], [1, 0], [0, 1]],
      vertexCount: 3
    }
  };
  rebuildMeshViewerHandleBuffers(viewer, handle);
  assert.equal(handle.lods.length, 3);
  assert.ok(uploaded.some((entry) => entry.target === 'ARRAY_BUFFER' && entry.type === 'data'));
  assert.equal(deleted.length, 2);
  assert.equal(handle.geometry.normals.length, 3);
}

function testMeshViewerRuntimeBuildsMetaText() {
  const text = buildMeshViewerMetaText(
    { previewStatusText: 'Full geometry loaded' },
    { meshId: 'geom_a', version: 12, vertexCount: 8, triangleCount: 4, lineCount: 2, pointCount: 1 },
    12
  );
  assert.match(text, /Full geometry loaded \| geomId: geom_a/);
  assert.match(text, /vertices: 8/);
  assert.match(text, /triangles: 4/);
  assert.match(text, /indices: 12/);
}

async function testMeshViewerRuntimeClearsLoopHandleAfterRenderFailure() {
  const runtime = await import('../WebUI/ui/mesh_viewer_runtime.js');
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  try {
    globalThis.requestAnimationFrame = (callback) => {
      setTimeout(callback, 0);
      return 1;
    };
    const viewer = {
      animationFrame: null,
      panel: { style: { display: 'flex' } },
      renderFrame() {
        throw new Error('boom');
      }
    };
    runtime.startRenderLoop(viewer);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(viewer.animationFrame, null);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
}

function testMeshViewerEditUiBuildsSelectionPayload() {
  const viewer = {
    selectionMode: 'edge',
    selectedEdges: new Set(['1-2', '2-3']),
    selectedVertices: new Set(),
    selectedFaces: new Set(),
    vertexPositions: new Map(),
    faceList: []
  };
  const data = getMeshViewerSelectionData(viewer);
  assert.equal(data.action, 'mesh_edit_edges');
  assert.deepEqual(data.value.edges, [{ v1: 1, v2: 2 }, { v1: 2, v2: 3 }]);
}

function testMeshViewerShellCreatesPanelMarkup() {
  const appended = [];
  const makeElement = () => ({
    className: '',
    innerHTML: '',
    style: {},
    textContent: '',
    value: '',
    appendChild() {},
    addEventListener() {},
    click() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  });
  const fakePanel = {
    className: '',
    innerHTML: '',
    style: {},
    querySelector(selector) {
      if (selector === '.mesh-viewer-canvas') {
        return {
          getContext() {
            return null;
          }
        };
      }
      if (selector === '.mesh-viewer-close' || selector === '.mesh-viewer-header' || selector === '.mesh-viewer-resize-handle') {
        return { addEventListener() {} };
      }
      if (selector === '.mesh-viewer-colorbar-slot' || selector === '.mesh-viewer-object-list') {
        return { appendChild() {} };
      }
      if (selector === '.mesh-viewer-meta') {
        return { textContent: '' };
      }
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  let createdRootPanel = false;
  globalThis.document = {
    createElement(tag) {
      if (tag === 'div' && !createdRootPanel) {
        createdRootPanel = true;
        return fakePanel;
      }
      if (tag === 'canvas') {
        return {
          ...makeElement(),
          width: 0,
          height: 0,
          getBoundingClientRect() {
            return { left: 0, top: 0, width: 256, height: 32 };
          },
          getContext() {
            return new Proxy({}, {
              get(_target, prop) {
                if (prop === 'createLinearGradient') {
                  return () => ({ addColorStop() {} });
                }
                return () => {};
              },
              set() {
                return true;
              }
            });
          }
        };
      }
      return makeElement();
    },
    body: {
      appendChild(node) {
        appended.push(node);
      }
    }
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(callback) {
      return setTimeout(callback, 0);
    }
  };
  const viewer = {
    panel: null,
    objectColorbars: new Map(),
    objectColorModes: new Map(),
    objectVisibility: new Map(),
    objectTextureOverrides: new Map(),
    objectDisplayModes: new Map(),
    initMouseControls() {},
    initMeshEditControls() {},
    initProgram() {},
    updateColorbarTexture() {},
    updateModeButtons() {},
    hide() {},
    onPanelDragStart() {},
    onPanelResizeStart() {},
    refreshObjectListUI() {},
    applyObjectBulkVisibility() {},
    syncColorbarEditorToActiveTarget() {},
    startRenderLoop() {},
    emitInteraction() {}
  };
  try {
    ensureMeshViewerShell(viewer);
    assert.equal(appended.length, 1);
    assert.match(fakePanel.innerHTML, /mesh-viewer-header/);
    assert.match(fakePanel.innerHTML, /mesh-viewer-colorbar-slot/);
    assert.match(fakePanel.innerHTML, /mesh-viewer-object-list/);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
}

function testMeshViewerPanelSatisfiesModuleContracts() {
  const result = validateMeshViewerModuleContracts(MeshViewerPanel.prototype);
  assert.equal(result.ok, true, `Missing mesh viewer module delegates: ${result.missing.join(', ')}`);
}

async function main() {
  await testPatchQueue();
  await testExecutionSessionClientCreateAndSnapshot();
  await testExecutionSessionClientPatchRetry();
  await testExecutionSessionClientOutputPage();
  await testExecutionSessionClientVersionNeverRegresses();
  await testExecutionSessionClientDedupesAndCachesOutputPages();
  await testMeshViewerPanelDedupesAndCachesChunks();
  await testMeshViewerPanelStagesInitialFieldFetches();
  await testMeshViewerEnsureFieldsForDisplayHydratesHandleWithoutRebind();
  await testMeshViewerLineDisplayPrefersLineIndicesOverTriangles();
  await testMeshViewerAuxiliaryBuildDoesNotEagerlyBuildEdgeLods();
  await testMeshViewerLinesModuleSchedulesEdgeLodsOnlyWhenNeeded();
  testMeshViewerGeometryExtractsMeshPointIndicesByDefault();
  testMeshViewerGeometryBuildsUniqueMeshEdges();
  testMeshViewerGeometryMarksDerivedMeshEdges();
  testMeshViewerDerivedMeshEdgesUseFullLineLod();
  testMeshViewerNativeLinesUseFullLodNearCamera();
  testMeshViewerPointsUseFullLodNearCamera();
  testMeshViewerLinesFollowSharedFaceLodWhenFar();
  testMeshViewerPointsFollowSharedFaceLodWhenFar();
  testMeshViewerLinesModuleBuildsImmediateEdgesForCurrentMesh();
  testMeshViewerHandlesEnsurePointRenderResourcesBuildsVertexPoints();
  testMeshViewerHandlesEnsureHandleRenderResourcesBuildsLinesAndPoints();
  testMeshViewerHandlesEnsureLineRenderBuffersDerivesEdgesFromTriangles();
  testMeshViewerHandlesRehydratesCachedHandleForSameVersion();
  await testMeshViewerObjectUiInitializesTargetsAndDefaults();
  await testMeshViewerEditingModuleBuildsInteractionGeometry();
  await testVectorPreviewPanelRefreshesAfterUpstreamValueEdit();
  testPagedPreviewDoesNotCollapseAfterDescriptorRefresh();
  await testMatrixPreviewUsesPagedRowBudgetAfterArrayHydration();
  testExecutionRequestBuilder();
  testNodePreviewContractsAssignDeclaredPreviewSockets();
  testEditorPreferredPromptKeys();
  testVectorOperationCycleSyncsSocketTypes();
  testOperationCycleDispatchesPreviewRecomputeForGenericNode();
  testSyncSessionAfterNodeEditRequiresExecutionOptions();
  testGraphChangeExecutionHelpersUseStandardPreviewChains();
  testEnqueueIncrementalExecutionPatchesRequiresExecutionOptionsForConnections();
  testCollectAffectedNodeIdsUsesExecutionStats();
  await testPreviewRefreshSchedulerMarksStaleAndRefreshesImmediateNodes();
  testPreviewIconDoesNotRequireLoadedPreviewValue();
  testViewerInteractionExecutionRules();
  testDynamicSocketControlsAreModularized();
  testQueuedExecutionOptionsAccumulator();
  testMeshViewerColorbarTextureModuleBuildsGradient();
  testMeshViewerGeometryUpdatesRebuildsHandleBuffers();
  testMeshViewerRuntimeBuildsMetaText();
  await testMeshViewerRuntimeClearsLoopHandleAfterRenderFailure();
  testMeshViewerEditUiBuildsSelectionPayload();
  testMeshViewerShellCreatesPanelMarkup();
  testMeshViewerPanelSatisfiesModuleContracts();
  console.log('webui_execution_selftest passed');
}

main().catch((error) => {
  console.error('webui_execution_selftest failed:', error);
  process.exitCode = 1;
});
