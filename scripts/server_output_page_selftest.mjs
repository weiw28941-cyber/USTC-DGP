import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Stability rules for this self-test:
// - Prefer steady-state `/outputs` or `/output-page` assertions over raw patch-timing assertions.
// - Only assert patch deltas directly when the behavior under test is specifically about patch propagation.
// - Wrap session creation, patch, outputs, and output-page requests with short retries because
//   session-local deltas and file outputs can be visible a few ticks later even when the graph logic is correct.
// - For writer nodes, wait for the output file to appear before reading it back.
// - For pure operator-mode coverage, prefer constructing the graph in the target mode instead of
//   depending on an extra patch roundtrip inside this script.

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(filePath, timeoutMs = 3000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      await fs.access(filePath);
      return true;
    } catch (_) {
    }
    await wait(50);
  }
  throw new Error(`File did not appear within ${timeoutMs}ms: ${filePath}`);
}

async function waitForServer(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const resp = await fetch(`${url}/health`);
      if (resp.ok) return true;
    } catch (_) {
    }
    await wait(200);
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

function createJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

async function fetchJsonWithRetries(url, init, options = {}) {
  const attempts = Number.isFinite(options.attempts) ? Math.max(1, Math.floor(options.attempts)) : 4;
  const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Math.floor(options.delayMs)) : 50;
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch;
  const shouldRetry = typeof options.shouldRetry === 'function'
    ? options.shouldRetry
    : ((resp, payload) => !resp.ok || payload?.result?.success === false);

  let lastResp = null;
  let lastPayload = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const resp = await fetchImpl(url, init);
    const payload = await resp.json();
    lastResp = resp;
    lastPayload = payload;
    if (!shouldRetry(resp, payload) || attempt === attempts - 1) {
      return { resp, payload };
    }
    await wait(delayMs);
  }
  return { resp: lastResp, payload: lastPayload };
}

function findDeltaById(payload, nodeId) {
  return Array.isArray(payload?.deltas)
    ? payload.deltas.find((node) => Number(node?.id) === Number(nodeId))
    : null;
}

function extractRequestedDeltaNodeIds(urlText, init) {
  try {
    if (!urlText.includes('/patch') && !urlText.includes('/outputs')) {
      return [];
    }
    const rawBody = init?.body;
    if (typeof rawBody !== 'string' || !rawBody) {
      return [];
    }
    const body = JSON.parse(rawBody);
    const ids = new Set();
    if (Array.isArray(body?.executionOptions?.outputNodeIds)) {
      for (const id of body.executionOptions.outputNodeIds) {
        if (Number.isFinite(Number(id))) ids.add(Number(id));
      }
    }
    if (Number.isFinite(Number(body?.nodeId))) {
      ids.add(Number(body.nodeId));
    }
    return [...ids];
  } catch (_) {
    return [];
  }
}

async function fetchDeltaJsonWithRetries(url, init, nodeIds, options = {}) {
  const requiredNodeIds = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
  return fetchJsonWithRetries(url, init, {
    ...options,
    shouldRetry: (resp, payload) => {
      if (!resp.ok) return true;
      return requiredNodeIds.some((nodeId) => !findDeltaById(payload, nodeId));
    }
  });
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-preview-selftest-'));
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (url, init) => {
    const urlText = String(url || '');
    if (!urlText.includes('/graph/session') &&
        !urlText.includes('/output-page') &&
        !urlText.includes('/patch') &&
        !urlText.includes('/outputs')) {
      return nativeFetch(url, init);
    }
    const requiredDeltaNodeIds = extractRequestedDeltaNodeIds(urlText, init);
    const { resp, payload } = await fetchJsonWithRetries(url, init, {
      fetchImpl: nativeFetch,
      shouldRetry: (response, responsePayload) => {
        if (!response.ok) return true;
        if (urlText.includes('/graph/session')) {
          return !responsePayload?.sessionId;
        }
        if (urlText.includes('/output-page')) {
          return responsePayload?.result?.success === false;
        }
        if (requiredDeltaNodeIds.length > 0) {
          return requiredDeltaNodeIds.some((nodeId) => !findDeltaById(responsePayload, nodeId));
        }
        return false;
      }
    });
    return createJsonResponse(resp.status, payload);
  };
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['Server/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      PROCESSOR_WORKER: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  server.stdout.on('data', (chunk) => {
    stdout += String(chunk || '');
  });
  server.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  try {
    await waitForServer(baseUrl);

    const graphData = {
      nodes: [
        {
          id: 0,
          type: 'vector',
          properties: {
            values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
            operation: 'number'
          }
        }
      ],
      connections: []
    };

    const createResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphData,
        execute: false
      })
    });
    assert.equal(createResp.ok, true, 'session creation should succeed');
    const session = await createResp.json();
    assert.ok(session.sessionId, 'sessionId should be returned');
    assert.equal(session.version, 1, 'new session version should be 1');

    const { resp: pageResp, payload: page } = await fetchJsonWithRetries(
      `${baseUrl}/graph/${encodeURIComponent(session.sessionId)}/output-page`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: session.version,
          nodeId: 0,
          socketId: 'vec',
          offset: 4,
          limit: 3
        })
      }
    );
    assert.equal(pageResp.ok, true, 'output-page route should succeed');
    assert.equal(page.success, true, 'route payload should report success');
    assert.equal(page.version, 1, 'output-page should not advance session version');
    assert.equal(page.result.success, true, 'node page result should succeed');
    assert.equal(page.result.paginated, true, 'vector output should be paginated');
    assert.equal(page.result.totalCount, 10, 'total count should reflect full vector');
    assert.equal(page.result.count, 3, 'page size should match requested limit');
    assert.equal(page.result.hasMore, true, 'middle page should report more items');
    assert.deepEqual(page.result.output, [4, 5, 6], 'page contents should respect offset/limit');

    const outputsResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(session.sessionId)}/outputs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: session.version,
        nodeId: 0,
        outputSockets: ['vec'],
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 0,
          outputNodeIds: [0],
          outputSockets: { '0': ['vec'] }
        }
      })
    });
    assert.equal(outputsResp.ok, true, 'outputs route should succeed');
    const outputsPayload = await outputsResp.json();
    const outputNode = outputsPayload.deltas.find((node) => Number(node?.id) === 0);
    assert.ok(outputNode, 'outputs route should return requested node delta');
    assert.equal(Array.isArray(outputNode.outputs?.vec), false,
      'outputs route should not inline full vector array');
    assert.equal(outputNode.outputs?.vec?.stream?.mode, 'paged',
      'outputs route should expose paged stream descriptor for vector arrays');

    const linkedGraphData = {
      nodes: [
        {
          id: 30,
          type: 'value',
          properties: { value: 0 }
        },
        {
          id: 31,
          type: 'vector',
          properties: { values: [0], operation: 'number' }
        }
      ],
      connections: [
        { from_node: 30, from_socket: 'out', to_node: 31, to_socket: 'x' }
      ]
    };

    const linkedCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphData: linkedGraphData,
        execute: true
      })
    });
    assert.equal(linkedCreateResp.ok, true, 'linked session creation should succeed');
    const linkedSession = await linkedCreateResp.json();
    assert.ok(linkedSession.sessionId, 'linked sessionId should be returned');

    const { resp: linkedPatchResp, payload: linkedPatchPayload } = await fetchJsonWithRetries(
      `${baseUrl}/graph/${encodeURIComponent(linkedSession.sessionId)}/patch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: linkedSession.version,
          patches: [
            { op: 'set_node_property', nodeId: 30, key: 'value', value: 1 }
          ],
          execute: true,
          executionOptions: {
            omitOutputs: false,
            maxPreviewItems: 4,
            outputNodeIds: [31],
            outputSockets: { '31': ['vec'] }
          }
        })
      },
      {
        shouldRetry: (resp, payload) => {
          if (!resp.ok) return true;
          const delta = Array.isArray(payload?.deltas)
            ? payload.deltas.find((node) => Number(node?.id) === 31)
            : null;
          return !delta;
        }
      }
    );
    assert.equal(linkedPatchResp.ok, true, 'linked patch should succeed');
    const linkedVectorDelta = Array.isArray(linkedPatchPayload.deltas)
      ? linkedPatchPayload.deltas.find((node) => Number(node?.id) === 31)
      : null;
    assert.ok(linkedVectorDelta, 'patch response should include downstream vector delta');
    assert.equal(linkedVectorDelta.outputs?.vec?.stream?.mode, 'paged',
      'downstream vector preview should still use paged descriptor');
    assert.equal(linkedVectorDelta.outputs?.vec?.stream?.totalCount, 1,
      'downstream vector preview should report one component');

    const { resp: linkedPageResp, payload: linkedPagePayload } = await fetchJsonWithRetries(
      `${baseUrl}/graph/${encodeURIComponent(linkedSession.sessionId)}/output-page`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: linkedPatchPayload.version,
          nodeId: 31,
          socketId: 'vec',
          offset: 0,
          limit: 4
        })
      }
    );
    assert.equal(linkedPageResp.ok, true, 'linked vector output-page should succeed');
    assert.equal(linkedPagePayload.result?.success, true, 'linked vector page should succeed');
    assert.deepEqual(linkedPagePayload.result?.output, [1], 'linked vector page should reflect updated upstream value');

    const valueMathGraphData = {
      nodes: [
        { id: 40, type: 'value', properties: { value: 2 } },
        { id: 41, type: 'value', properties: { value: 3 } },
        { id: 42, type: 'value_math', properties: { operation: 'multiply' } }
      ],
      connections: [
        { from_node: 40, from_socket: 'out', to_node: 42, to_socket: 'a' },
        { from_node: 41, from_socket: 'out', to_node: 42, to_socket: 'b' }
      ]
    };
    const valueMathCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: valueMathGraphData, execute: true })
    });
    assert.equal(valueMathCreateResp.ok, true, 'value_math session creation should succeed');
    const valueMathSession = await valueMathCreateResp.json();
    const { resp: valueMathOutputsResp, payload: valueMathOutputsPayload } = await fetchJsonWithRetries(
      `${baseUrl}/graph/${encodeURIComponent(valueMathSession.sessionId)}/outputs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: valueMathSession.version,
          nodeId: 42,
          outputSockets: ['result'],
          executionOptions: {
            omitOutputs: false,
            maxPreviewItems: 4,
            outputNodeIds: [42],
            outputSockets: { '42': ['result'] }
          }
        })
      },
      {
        shouldRetry: (resp, payload) => {
          if (!resp.ok) return true;
          const delta = Array.isArray(payload?.deltas)
            ? payload.deltas.find((node) => Number(node?.id) === 42)
            : null;
          return !delta;
        }
      }
    );
    assert.equal(valueMathOutputsResp.ok, true, 'value_math outputs route should succeed');
    const valueMathDelta = valueMathOutputsPayload.deltas.find((node) => Number(node?.id) === 42);
    assert.ok(valueMathDelta, 'value_math outputs should include delta');
    assert.equal(valueMathDelta.outputs?.result, 6, 'value_math preview should reflect multiply operation');

    const vectorMathGraphData = {
      nodes: [
        { id: 43, type: 'vector', properties: { values: [1, 2], operation: 'number' } },
        { id: 44, type: 'vector', properties: { values: [3, 4], operation: 'number' } },
        { id: 45, type: 'vector_math', properties: { operation: 'multiply' } }
      ],
      connections: [
        { from_node: 43, from_socket: 'vec', to_node: 45, to_socket: 'a' },
        { from_node: 44, from_socket: 'vec', to_node: 45, to_socket: 'b' }
      ]
    };
    const vectorMathCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: vectorMathGraphData, execute: true })
    });
    assert.equal(vectorMathCreateResp.ok, true, 'vector_math session creation should succeed');
    const vectorMathSession = await vectorMathCreateResp.json();
    const { resp: vectorMathPageResp, payload: vectorMathPagePayload } = await fetchJsonWithRetries(
      `${baseUrl}/graph/${encodeURIComponent(vectorMathSession.sessionId)}/output-page`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: vectorMathSession.version,
          nodeId: 45,
          socketId: 'result',
          offset: 0,
          limit: 4
        })
      },
      {
        shouldRetry: (resp, payload) => {
          if (!resp.ok) return true;
          return !Array.isArray(payload?.result?.output);
        }
      }
    );
    assert.equal(vectorMathPageResp.ok, true, 'vector_math output-page should succeed');
    assert.deepEqual(vectorMathPagePayload.result?.output, [3, 8], 'vector_math preview should reflect updated operation');

    const vectorUnaryGraphData = {
      nodes: [
        { id: 46, type: 'vector', properties: { values: [3, 4], operation: 'number' } },
        { id: 47, type: 'vector_unary', properties: { operation: 'normalize' } }
      ],
      connections: [
        { from_node: 46, from_socket: 'vec', to_node: 47, to_socket: 'a' }
      ]
    };
    const vectorUnaryCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: vectorUnaryGraphData, execute: true })
    });
    assert.equal(vectorUnaryCreateResp.ok, true, 'vector_unary session creation should succeed');
    const vectorUnarySession = await vectorUnaryCreateResp.json();
    const { resp: vectorUnaryOutputsResp, payload: vectorUnaryOutputsPayload } = await fetchDeltaJsonWithRetries(
      `${baseUrl}/graph/${encodeURIComponent(vectorUnarySession.sessionId)}/outputs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: vectorUnarySession.version,
          nodeId: 47,
          outputSockets: ['result', 'scalar'],
          executionOptions: {
            omitOutputs: false,
            maxPreviewItems: 4,
            outputNodeIds: [47],
            outputSockets: { '47': ['result', 'scalar'] }
          }
        })
      },
      47
    );
    assert.equal(vectorUnaryOutputsResp.ok, true, 'vector_unary outputs route should succeed');
    const vectorUnaryDelta = findDeltaById(vectorUnaryOutputsPayload, 47);
    assert.ok(vectorUnaryDelta, 'vector_unary outputs should include delta');
    assert.equal(vectorUnaryDelta.outputs?.scalar, 5, 'vector_unary scalar preview should expose original magnitude');
    const vectorUnaryPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(vectorUnarySession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: vectorUnarySession.version,
        nodeId: 47,
        socketId: 'result',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(vectorUnaryPageResp.ok, true, 'vector_unary output-page should succeed');
    const vectorUnaryPagePayload = await vectorUnaryPageResp.json();
    assert.deepEqual(vectorUnaryPagePayload.result?.output, [0.6, 0.8], 'vector_unary preview should reflect normalization');

    const vectorScalarGraphData = {
      nodes: [
        { id: 48, type: 'vector', properties: { values: [1, 2], operation: 'number' } },
        { id: 49, type: 'value', properties: { value: 10 } },
        { id: 51, type: 'vector_scalar', properties: { operation: 'multiply' } }
      ],
      connections: [
        { from_node: 48, from_socket: 'vec', to_node: 51, to_socket: 'vec' },
        { from_node: 49, from_socket: 'out', to_node: 51, to_socket: 'scalar' }
      ]
    };
    const vectorScalarCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: vectorScalarGraphData, execute: true })
    });
    assert.equal(vectorScalarCreateResp.ok, true, 'vector_scalar session creation should succeed');
    const vectorScalarSession = await vectorScalarCreateResp.json();
    const vectorScalarPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(vectorScalarSession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: vectorScalarSession.version,
        nodeId: 51,
        socketId: 'result',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(vectorScalarPageResp.ok, true, 'vector_scalar output-page should succeed');
    const vectorScalarPagePayload = await vectorScalarPageResp.json();
    assert.deepEqual(vectorScalarPagePayload.result?.output, [10, 20], 'vector_scalar preview should reflect updated operation');

    const listMathGraphData = {
      nodes: [
        { id: 52, type: 'list', properties: { values: [1, 2], operation: 'number' } },
        { id: 53, type: 'list', properties: { values: [3, 4], operation: 'number' } },
        { id: 54, type: 'list_math', properties: { operation: 'multiply' } }
      ],
      connections: [
        { from_node: 52, from_socket: 'list', to_node: 54, to_socket: 'a' },
        { from_node: 53, from_socket: 'list', to_node: 54, to_socket: 'b' }
      ]
    };
    const listMathCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: listMathGraphData, execute: true })
    });
    assert.equal(listMathCreateResp.ok, true, 'list_math session creation should succeed');
    const listMathSession = await listMathCreateResp.json();
    const listMathPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(listMathSession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: listMathSession.version,
        nodeId: 54,
        socketId: 'result',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(listMathPageResp.ok, true, 'list_math output-page should succeed');
    const listMathPagePayload = await listMathPageResp.json();
    assert.deepEqual(listMathPagePayload.result?.output, [3, 8], 'list_math preview should reflect updated operation');

    const listUnaryGraphData = {
      nodes: [
        { id: 55, type: 'list', properties: { values: [1, 2, 3], operation: 'number' } },
        { id: 56, type: 'list_unary', properties: { operation: 'reverse' } }
      ],
      connections: [
        { from_node: 55, from_socket: 'list', to_node: 56, to_socket: 'a' }
      ]
    };
    const listUnaryCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: listUnaryGraphData, execute: true })
    });
    assert.equal(listUnaryCreateResp.ok, true, 'list_unary session creation should succeed');
    const listUnarySession = await listUnaryCreateResp.json();
    const { resp: listUnaryOutputsResp, payload: listUnaryOutputsPayload } = await fetchDeltaJsonWithRetries(
      `${baseUrl}/graph/${encodeURIComponent(listUnarySession.sessionId)}/outputs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: listUnarySession.version,
          nodeId: 56,
          outputSockets: ['result', 'scalar'],
          executionOptions: {
            omitOutputs: false,
            maxPreviewItems: 4,
            outputNodeIds: [56],
            outputSockets: { '56': ['result', 'scalar'] }
          }
        })
      },
      56
    );
    assert.equal(listUnaryOutputsResp.ok, true, 'list_unary outputs route should succeed');
    const listUnaryDelta = findDeltaById(listUnaryOutputsPayload, 56);
    assert.ok(listUnaryDelta, 'list_unary outputs should include delta');
    assert.equal(listUnaryDelta.outputs?.scalar, 0, 'list_unary scalar preview should reflect reverse operation');
    const listUnaryPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(listUnarySession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: listUnarySession.version,
        nodeId: 56,
        socketId: 'result',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(listUnaryPageResp.ok, true, 'list_unary output-page should succeed');
    const listUnaryPagePayload = await listUnaryPageResp.json();
    assert.deepEqual(listUnaryPagePayload.result?.output, [3, 2, 1], 'list_unary preview should reflect reverse operation');

    const listScalarGraphData = {
      nodes: [
        { id: 57, type: 'list', properties: { values: [1, 2], operation: 'number' } },
        { id: 58, type: 'value', properties: { value: 10 } },
        { id: 59, type: 'list_scalar', properties: { operation: 'multiply' } }
      ],
      connections: [
        { from_node: 57, from_socket: 'list', to_node: 59, to_socket: 'list' },
        { from_node: 58, from_socket: 'out', to_node: 59, to_socket: 'scalar' }
      ]
    };
    const listScalarCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: listScalarGraphData, execute: true })
    });
    assert.equal(listScalarCreateResp.ok, true, 'list_scalar session creation should succeed');
    const listScalarSession = await listScalarCreateResp.json();
    const listScalarPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(listScalarSession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: listScalarSession.version,
        nodeId: 59,
        socketId: 'result',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(listScalarPageResp.ok, true, 'list_scalar output-page should succeed');
    const listScalarPagePayload = await listScalarPageResp.json();
    assert.deepEqual(listScalarPagePayload.result?.output, [10, 20], 'list_scalar preview should reflect updated operation');

    const matrixMathGraphData = {
      nodes: [
        { id: 60, type: 'list', properties: { values: [1, 2, 3, 4], operation: 'number' } },
        { id: 61, type: 'value', properties: { value: 2 } },
        { id: 62, type: 'matrix' },
        { id: 63, type: 'list', properties: { values: [5, 6, 7, 8], operation: 'number' } },
        { id: 64, type: 'value', properties: { value: 2 } },
        { id: 65, type: 'matrix' },
        { id: 66, type: 'matrix_math', properties: { operation: 'multiply' } }
      ],
      connections: [
        { from_node: 60, from_socket: 'list', to_node: 62, to_socket: 'data' },
        { from_node: 61, from_socket: 'out', to_node: 62, to_socket: 'cols' },
        { from_node: 63, from_socket: 'list', to_node: 65, to_socket: 'data' },
        { from_node: 64, from_socket: 'out', to_node: 65, to_socket: 'cols' },
        { from_node: 62, from_socket: 'mat', to_node: 66, to_socket: 'a' },
        { from_node: 65, from_socket: 'mat', to_node: 66, to_socket: 'b' }
      ]
    };
    const matrixMathCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: matrixMathGraphData, execute: true })
    });
    assert.equal(matrixMathCreateResp.ok, true, 'matrix_math session creation should succeed');
    const matrixMathSession = await matrixMathCreateResp.json();
    const matrixMathPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(matrixMathSession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: matrixMathSession.version,
        nodeId: 66,
        socketId: 'result',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(matrixMathPageResp.ok, true, 'matrix_math output-page should succeed');
    const matrixMathPagePayload = await matrixMathPageResp.json();
    assert.deepEqual(matrixMathPagePayload.result?.output, [[5, 12], [21, 32]], 'matrix_math preview should reflect updated operation');

    const matrixUnaryGraphData = {
      nodes: [
        { id: 67, type: 'list', properties: { values: [1, 2, 3, 4], operation: 'number' } },
        { id: 68, type: 'value', properties: { value: 2 } },
        { id: 69, type: 'matrix' },
        { id: 70, type: 'matrix_unary', properties: { operation: 'transpose' } }
      ],
      connections: [
        { from_node: 67, from_socket: 'list', to_node: 69, to_socket: 'data' },
        { from_node: 68, from_socket: 'out', to_node: 69, to_socket: 'cols' },
        { from_node: 69, from_socket: 'mat', to_node: 70, to_socket: 'a' }
      ]
    };
    const matrixUnaryCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: matrixUnaryGraphData, execute: true })
    });
    assert.equal(matrixUnaryCreateResp.ok, true, 'matrix_unary session creation should succeed');
    const matrixUnarySession = await matrixUnaryCreateResp.json();
    const { resp: matrixUnaryOutputsResp, payload: matrixUnaryOutputsPayload } = await fetchDeltaJsonWithRetries(
      `${baseUrl}/graph/${encodeURIComponent(matrixUnarySession.sessionId)}/outputs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: matrixUnarySession.version,
          nodeId: 70,
          outputSockets: ['result', 'scalar'],
          executionOptions: {
            omitOutputs: false,
            maxPreviewItems: 4,
            outputNodeIds: [70],
            outputSockets: { '70': ['result', 'scalar'] }
          }
        })
      },
      70
    );
    assert.equal(matrixUnaryOutputsResp.ok, true, 'matrix_unary outputs route should succeed');
    const matrixUnaryDelta = findDeltaById(matrixUnaryOutputsPayload, 70);
    assert.ok(matrixUnaryDelta, 'matrix_unary outputs should include delta');
    assert.equal(matrixUnaryDelta.outputs?.scalar, 0, 'matrix_unary scalar preview should reflect transpose operation');
    const matrixUnaryPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(matrixUnarySession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: matrixUnarySession.version,
        nodeId: 70,
        socketId: 'result',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(matrixUnaryPageResp.ok, true, 'matrix_unary output-page should succeed');
    const matrixUnaryPagePayload = await matrixUnaryPageResp.json();
    assert.deepEqual(matrixUnaryPagePayload.result?.output, [[1, 3], [2, 4]], 'matrix_unary preview should reflect transpose operation');

    const matrixScalarGraphData = {
      nodes: [
        { id: 71, type: 'list', properties: { values: [1, 2, 3, 4], operation: 'number' } },
        { id: 72, type: 'value', properties: { value: 2 } },
        { id: 73, type: 'matrix' },
        { id: 74, type: 'value', properties: { value: 10 } },
        { id: 75, type: 'matrix_scalar', properties: { operation: 'multiply' } }
      ],
      connections: [
        { from_node: 71, from_socket: 'list', to_node: 73, to_socket: 'data' },
        { from_node: 72, from_socket: 'out', to_node: 73, to_socket: 'cols' },
        { from_node: 73, from_socket: 'mat', to_node: 75, to_socket: 'mat' },
        { from_node: 74, from_socket: 'out', to_node: 75, to_socket: 'scalar' }
      ]
    };
    const matrixScalarCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: matrixScalarGraphData, execute: true })
    });
    assert.equal(matrixScalarCreateResp.ok, true, 'matrix_scalar session creation should succeed');
    const matrixScalarSession = await matrixScalarCreateResp.json();
    const matrixScalarPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(matrixScalarSession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: matrixScalarSession.version,
        nodeId: 75,
        socketId: 'result',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(matrixScalarPageResp.ok, true, 'matrix_scalar output-page should succeed');
    const matrixScalarPagePayload = await matrixScalarPageResp.json();
    assert.deepEqual(matrixScalarPagePayload.result?.output, [[10, 20], [30, 40]], 'matrix_scalar preview should reflect updated operation');

    const valueGraphData = {
      nodes: [
        {
          id: 50,
          type: 'value',
          properties: { value: 3 }
        }
      ],
      connections: []
    };

    const valueCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: valueGraphData, execute: true })
    });
    assert.equal(valueCreateResp.ok, true, 'value session creation should succeed');
    const valueSession = await valueCreateResp.json();
    const { resp: valuePatchResp, payload: valuePatchPayload } = await fetchDeltaJsonWithRetries(
      `${baseUrl}/graph/${encodeURIComponent(valueSession.sessionId)}/patch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: valueSession.version,
          patches: [
            { op: 'set_node_property', nodeId: 50, key: 'value', value: 7 }
          ],
          execute: true,
          executionOptions: {
            omitOutputs: false,
            maxPreviewItems: 4,
            outputNodeIds: [50],
            outputSockets: { '50': ['out'] }
          }
        })
      },
      50
    );
    assert.equal(valuePatchResp.ok, true, 'value patch should succeed');
    const valueDelta = findDeltaById(valuePatchPayload, 50);
    assert.ok(valueDelta, 'value patch should include value delta');
    assert.equal(valueDelta.outputs?.out, 7, 'value preview should update inline');

    const stringGraphData = {
      nodes: [
        {
          id: 60,
          type: 'string',
          properties: { text: 'hello' }
        }
      ],
      connections: []
    };

    const stringCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: stringGraphData, execute: true })
    });
    assert.equal(stringCreateResp.ok, true, 'string session creation should succeed');
    const stringSession = await stringCreateResp.json();
    const { resp: stringPatchResp, payload: stringPatchPayload } = await fetchDeltaJsonWithRetries(
      `${baseUrl}/graph/${encodeURIComponent(stringSession.sessionId)}/patch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: stringSession.version,
          patches: [
            { op: 'set_node_property', nodeId: 60, key: 'text', value: 'world' }
          ],
          execute: true,
          executionOptions: {
            omitOutputs: false,
            maxPreviewItems: 4,
            outputNodeIds: [60],
            outputSockets: { '60': ['text'] }
          }
        })
      },
      60
    );
    assert.equal(stringPatchResp.ok, true, 'string patch should succeed');
    const stringDelta = findDeltaById(stringPatchPayload, 60);
    assert.ok(stringDelta, 'string patch should include string delta');
    assert.equal(stringDelta.outputs?.text, 'world', 'string preview should update inline');

    const listGraphData = {
      nodes: [
        {
          id: 70,
          type: 'list',
          properties: { values: [1, 2, 3, 4, 5], operation: 'number' }
        }
      ],
      connections: []
    };

    const listCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: listGraphData, execute: true })
    });
    assert.equal(listCreateResp.ok, true, 'list session creation should succeed');
    const listSession = await listCreateResp.json();
    const { resp: listOutputsResp, payload: listOutputsPayload } = await fetchDeltaJsonWithRetries(
      `${baseUrl}/graph/${encodeURIComponent(listSession.sessionId)}/outputs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: listSession.version,
          nodeId: 70,
          outputSockets: ['list'],
          executionOptions: {
            omitOutputs: false,
            maxPreviewItems: 4,
            outputNodeIds: [70],
            outputSockets: { '70': ['list'] }
          }
        })
      },
      70
    );
    assert.equal(listOutputsResp.ok, true, 'list outputs route should succeed');
    const listDelta = findDeltaById(listOutputsPayload, 70);
    assert.ok(listDelta, 'list outputs should include list delta');
    assert.equal(listDelta.outputs?.list?.stream?.mode, 'paged', 'list preview should use paged descriptor');

    const listPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(listSession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: listSession.version,
        nodeId: 70,
        socketId: 'list',
        offset: 1,
        limit: 2
      })
    });
    assert.equal(listPageResp.ok, true, 'list output-page should succeed');
    const listPagePayload = await listPageResp.json();
    assert.deepEqual(listPagePayload.result?.output, [2, 3], 'list output-page should return requested slice');

    const dynamicVectorGraphData = {
      nodes: [
        {
          id: 90,
          type: 'vector',
          properties: { values: [0], operation: 'number' }
        }
      ],
      connections: []
    };

    const dynamicVectorCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: dynamicVectorGraphData, execute: false })
    });
    assert.equal(dynamicVectorCreateResp.ok, true, 'dynamic vector session creation should succeed');
    const dynamicVectorSession = await dynamicVectorCreateResp.json();

    const dynamicVectorGraphUpdated = {
      nodes: [
        {
          id: 90,
          type: 'vector',
          properties: { values: [0, 9], operation: 'number' }
        }
      ],
      connections: []
    };

    const dynamicVectorSnapshotResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(dynamicVectorSession.sessionId)}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: dynamicVectorSession.version,
        graphData: dynamicVectorGraphUpdated,
        execute: false
      })
    });
    assert.equal(dynamicVectorSnapshotResp.ok, true, 'dynamic vector snapshot sync should succeed');
    const dynamicVectorSnapshot = await dynamicVectorSnapshotResp.json();

    const dynamicVectorOutputsResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(dynamicVectorSession.sessionId)}/outputs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: dynamicVectorSnapshot.version,
        nodeId: 90,
        outputSockets: ['vec'],
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [90],
          outputSockets: { '90': ['vec'] }
        }
      })
    });
    assert.equal(dynamicVectorOutputsResp.ok, true, 'dynamic vector outputs route should succeed after snapshot sync');
    const dynamicVectorOutputsPayload = await dynamicVectorOutputsResp.json();
    const dynamicVectorDelta = dynamicVectorOutputsPayload.deltas.find((node) => Number(node?.id) === 90);
    assert.ok(dynamicVectorDelta, 'dynamic vector outputs should include vector delta');
    assert.equal(dynamicVectorDelta.outputs?.vec?.stream?.mode, 'paged',
      'dynamic vector preview should still use paged descriptor');
    assert.equal(dynamicVectorDelta.outputs?.vec?.stream?.totalCount, 2,
      'dynamic vector descriptor should reflect the updated component count');

    const dynamicVectorPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(dynamicVectorSession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: dynamicVectorOutputsPayload.version,
        nodeId: 90,
        socketId: 'vec',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(dynamicVectorPageResp.ok, true, 'dynamic vector output-page should succeed after snapshot sync');
    const dynamicVectorPagePayload = await dynamicVectorPageResp.json();
    assert.deepEqual(dynamicVectorPagePayload.result?.output, [0, 9],
      'dynamic vector output-page should reflect the updated local component layout');

    const dynamicListGraphData = {
      nodes: [
        {
          id: 91,
          type: 'list',
          properties: { values: [1], operation: 'number' }
        }
      ],
      connections: []
    };

    const dynamicListCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: dynamicListGraphData, execute: false })
    });
    assert.equal(dynamicListCreateResp.ok, true, 'dynamic list session creation should succeed');
    const dynamicListSession = await dynamicListCreateResp.json();

    const dynamicListGraphUpdated = {
      nodes: [
        {
          id: 91,
          type: 'list',
          properties: { values: [1, 2, 3], operation: 'number' }
        }
      ],
      connections: []
    };

    const dynamicListSnapshotResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(dynamicListSession.sessionId)}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: dynamicListSession.version,
        graphData: dynamicListGraphUpdated,
        execute: false
      })
    });
    assert.equal(dynamicListSnapshotResp.ok, true, 'dynamic list snapshot sync should succeed');
    const dynamicListSnapshot = await dynamicListSnapshotResp.json();

    const dynamicListOutputsResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(dynamicListSession.sessionId)}/outputs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: dynamicListSnapshot.version,
        nodeId: 91,
        outputSockets: ['list'],
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [91],
          outputSockets: { '91': ['list'] }
        }
      })
    });
    assert.equal(dynamicListOutputsResp.ok, true, 'dynamic list outputs route should succeed after snapshot sync');
    const dynamicListOutputsPayload = await dynamicListOutputsResp.json();
    const dynamicListDelta = dynamicListOutputsPayload.deltas.find((node) => Number(node?.id) === 91);
    assert.ok(dynamicListDelta, 'dynamic list outputs should include list delta');
    assert.equal(dynamicListDelta.outputs?.list?.stream?.mode, 'paged',
      'dynamic list preview should still use paged descriptor');
    assert.equal(dynamicListDelta.outputs?.list?.stream?.totalCount, 3,
      'dynamic list descriptor should reflect the updated element count');

    const dynamicListPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(dynamicListSession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: dynamicListOutputsPayload.version,
        nodeId: 91,
        socketId: 'list',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(dynamicListPageResp.ok, true, 'dynamic list output-page should succeed after snapshot sync');
    const dynamicListPagePayload = await dynamicListPageResp.json();
    assert.deepEqual(dynamicListPagePayload.result?.output, [1, 2, 3],
      'dynamic list output-page should reflect the updated local element layout');

    const dynamicGeometryGraphData = {
      nodes: [
        { id: 92, type: 'list', properties: { values: [0, 0, 0], operation: 'number' } },
        { id: 93, type: 'value', properties: { value: 3 } },
        { id: 94, type: 'matrix' },
        { id: 95, type: 'points' },
        { id: 96, type: 'geometry', properties: { values: [1, 0, 0] } }
      ],
      connections: [
        { from_node: 92, from_socket: 'list', to_node: 94, to_socket: 'data' },
        { from_node: 93, from_socket: 'out', to_node: 94, to_socket: 'cols' },
        { from_node: 94, from_socket: 'mat', to_node: 95, to_socket: 'mat' },
        { from_node: 95, from_socket: 'points', to_node: 96, to_socket: 'points' }
      ]
    };

    const dynamicGeometryCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: dynamicGeometryGraphData, execute: false })
    });
    assert.equal(dynamicGeometryCreateResp.ok, true, 'dynamic geometry session creation should succeed');
    const dynamicGeometrySession = await dynamicGeometryCreateResp.json();

    const dynamicGeometryGraphUpdated = {
      nodes: [
        { id: 92, type: 'list', properties: { values: [0, 0, 0], operation: 'number' } },
        { id: 93, type: 'value', properties: { value: 3 } },
        { id: 94, type: 'matrix' },
        { id: 95, type: 'points' },
        { id: 96, type: 'geometry', properties: { values: [2, 0, 0] } },
        { id: 97, type: 'list', properties: { values: [1, 0, 0], operation: 'number' } },
        { id: 98, type: 'value', properties: { value: 3 } },
        { id: 99, type: 'matrix' },
        { id: 100, type: 'points' }
      ],
      connections: [
        { from_node: 92, from_socket: 'list', to_node: 94, to_socket: 'data' },
        { from_node: 93, from_socket: 'out', to_node: 94, to_socket: 'cols' },
        { from_node: 94, from_socket: 'mat', to_node: 95, to_socket: 'mat' },
        { from_node: 95, from_socket: 'points', to_node: 96, to_socket: 'points' },
        { from_node: 97, from_socket: 'list', to_node: 99, to_socket: 'data' },
        { from_node: 98, from_socket: 'out', to_node: 99, to_socket: 'cols' },
        { from_node: 99, from_socket: 'mat', to_node: 100, to_socket: 'mat' },
        { from_node: 100, from_socket: 'points', to_node: 96, to_socket: 'points1' }
      ]
    };

    const dynamicGeometrySnapshotResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(dynamicGeometrySession.sessionId)}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: dynamicGeometrySession.version,
        graphData: dynamicGeometryGraphUpdated,
        execute: false
      })
    });
    assert.equal(dynamicGeometrySnapshotResp.ok, true, 'dynamic geometry snapshot sync should succeed');
    const dynamicGeometrySnapshot = await dynamicGeometrySnapshotResp.json();

    const dynamicGeometryOutputsResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(dynamicGeometrySession.sessionId)}/outputs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: dynamicGeometrySnapshot.version,
        nodeId: 96,
        outputSockets: ['geometry'],
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [96],
          outputSockets: { '96': ['geometry'] }
        }
      })
    });
    assert.equal(dynamicGeometryOutputsResp.ok, true, 'dynamic geometry outputs route should succeed after snapshot sync');
    const dynamicGeometryOutputsPayload = await dynamicGeometryOutputsResp.json();
    const dynamicGeometryDelta = dynamicGeometryOutputsPayload.deltas.find((node) => Number(node?.id) === 96);
    assert.ok(dynamicGeometryDelta, 'dynamic geometry outputs should include geometry delta');
    assert.equal(dynamicGeometryDelta.outputs?.geometry?.stream?.mode, 'chunked',
      'dynamic geometry preview should remain chunked');
    assert.equal(dynamicGeometryDelta.outputs?.geometry?.pointCount, 2,
      'dynamic geometry metadata should reflect the updated point input layout');

    const matrixGraphData = {
      nodes: [
        {
          id: 80,
          type: 'list',
          properties: { values: [1, 2, 3, 4], operation: 'number' }
        },
        {
          id: 81,
          type: 'value',
          properties: { value: 2 }
        },
        {
          id: 82,
          type: 'matrix'
        }
      ],
      connections: [
        { from_node: 80, from_socket: 'list', to_node: 82, to_socket: 'data' },
        { from_node: 81, from_socket: 'out', to_node: 82, to_socket: 'cols' }
      ]
    };

    const matrixCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: matrixGraphData, execute: true })
    });
    assert.equal(matrixCreateResp.ok, true, 'matrix session creation should succeed');
    const matrixSession = await matrixCreateResp.json();
    const matrixPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(matrixSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: matrixSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 80, key: 'values', value: [5, 6, 7, 8] }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [82],
          outputSockets: { '82': ['mat'] }
        }
      })
    });
    assert.equal(matrixPatchResp.ok, true, 'matrix patch should succeed');
    const matrixPatchPayload = await matrixPatchResp.json();
    const matrixDelta = matrixPatchPayload.deltas.find((node) => Number(node?.id) === 82);
    assert.ok(matrixDelta, 'matrix patch should include matrix delta');
    assert.equal(matrixDelta.outputs?.mat?.stream?.mode, 'paged', 'matrix preview should use paged descriptor');
    assert.equal(matrixDelta.outputs?.mat?.stream?.pageSize, 2,
      'matrix preview page size should be row-based so rows*cols stays within the preview budget');
    assert.equal(matrixDelta.outputs?.mat?.stream?.rows, 2,
      'matrix preview descriptor should expose row count');
    assert.equal(matrixDelta.outputs?.mat?.stream?.cols, 2,
      'matrix preview descriptor should expose column count');
    assert.equal(matrixDelta.outputs?.mat?.stream?.pageUnit, 'rows',
      'matrix preview descriptor should mark row-based paging');

    const matrixPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(matrixSession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: matrixPatchPayload.version,
        nodeId: 82,
        socketId: 'mat',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(matrixPageResp.ok, true, 'matrix output-page should succeed');
    const matrixPagePayload = await matrixPageResp.json();
    assert.deepEqual(matrixPagePayload.result?.output, [[5, 6], [7, 8]], 'matrix output-page should reflect updated rows');

    const pointsGraphData = {
      nodes: [
        { id: 100, type: 'list', properties: { values: [0, 0, 0], operation: 'number' } },
        { id: 101, type: 'value', properties: { value: 3 } },
        { id: 102, type: 'matrix' },
        { id: 103, type: 'points' }
      ],
      connections: [
        { from_node: 100, from_socket: 'list', to_node: 102, to_socket: 'data' },
        { from_node: 101, from_socket: 'out', to_node: 102, to_socket: 'cols' },
        { from_node: 102, from_socket: 'mat', to_node: 103, to_socket: 'mat' }
      ]
    };

    const pointsCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: pointsGraphData, execute: true })
    });
    assert.equal(pointsCreateResp.ok, true, 'points session creation should succeed');
    const pointsSession = await pointsCreateResp.json();

    const pointsPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(pointsSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: pointsSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 100, key: 'values', value: [0, 0, 0, 1, 0, 0] }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [103],
          outputSockets: { '103': ['points'] }
        }
      })
    });
    assert.equal(pointsPatchResp.ok, true, 'points patch should succeed');
    const pointsPatchPayload = await pointsPatchResp.json();
    const pointsDelta = pointsPatchPayload.deltas.find((node) => Number(node?.id) === 103);
    assert.ok(pointsDelta, 'points patch should include points delta');
    assert.equal(Array.isArray(pointsDelta.outputs?.points?.points), true,
      'points preview should currently be inline');
    assert.equal(pointsDelta.outputs?.points?.count, 2,
      'points preview should reflect updated point count');

    const linesGraphData = {
      nodes: [
        { id: 110, type: 'list', properties: { values: [0, 0, 0, 1, 0, 0], operation: 'number' } },
        { id: 111, type: 'value', properties: { value: 3 } },
        { id: 112, type: 'matrix' },
        { id: 113, type: 'points' },
        { id: 114, type: 'list', properties: { values: [0, 1], operation: 'number' } },
        { id: 115, type: 'value', properties: { value: 2 } },
        { id: 116, type: 'matrix' },
        { id: 117, type: 'lines', properties: { operation: 'undirected' } }
      ],
      connections: [
        { from_node: 110, from_socket: 'list', to_node: 112, to_socket: 'data' },
        { from_node: 111, from_socket: 'out', to_node: 112, to_socket: 'cols' },
        { from_node: 112, from_socket: 'mat', to_node: 113, to_socket: 'mat' },
        { from_node: 114, from_socket: 'list', to_node: 116, to_socket: 'data' },
        { from_node: 115, from_socket: 'out', to_node: 116, to_socket: 'cols' },
        { from_node: 116, from_socket: 'mat', to_node: 117, to_socket: 'indices' },
        { from_node: 113, from_socket: 'points', to_node: 117, to_socket: 'points' }
      ]
    };

    const linesCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: linesGraphData, execute: true })
    });
    assert.equal(linesCreateResp.ok, true, 'lines session creation should succeed');
    const linesSession = await linesCreateResp.json();

    const linesPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(linesSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: linesSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 114, key: 'values', value: [0, 1, 1, 0] }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [117],
          outputSockets: { '117': ['lines'] }
        }
      })
    });
    assert.equal(linesPatchResp.ok, true, 'lines patch should succeed');
    const linesPatchPayload = await linesPatchResp.json();
    const linesDelta = linesPatchPayload.deltas.find((node) => Number(node?.id) === 117);
    assert.ok(linesDelta, 'lines patch should include lines delta');
    assert.equal(Array.isArray(linesDelta.outputs?.lines?.segments), true,
      'lines preview should currently be inline');
    assert.equal(linesDelta.outputs?.lines?.segmentCount, 2,
      'lines preview should reflect updated segment count');
    assert.deepEqual(linesDelta.outputs?.lines?.segments, [[0, 1], [1, 0]],
      'lines preview should reflect updated index matrix');

    const meshGraphData = {
      nodes: [
        { id: 120, type: 'list', properties: { values: [0, 0, 0, 1, 0, 0, 0, 1, 0], operation: 'number' } },
        { id: 121, type: 'value', properties: { value: 3 } },
        { id: 122, type: 'matrix' },
        { id: 123, type: 'list', properties: { values: [0, 1, 2], operation: 'number' } },
        { id: 124, type: 'value', properties: { value: 3 } },
        { id: 125, type: 'matrix' },
        { id: 126, type: 'mesh', properties: { size: 1.0, operation: 'solid' } }
      ],
      connections: [
        { from_node: 120, from_socket: 'list', to_node: 122, to_socket: 'data' },
        { from_node: 121, from_socket: 'out', to_node: 122, to_socket: 'cols' },
        { from_node: 122, from_socket: 'mat', to_node: 126, to_socket: 'vertices' },
        { from_node: 123, from_socket: 'list', to_node: 125, to_socket: 'data' },
        { from_node: 124, from_socket: 'out', to_node: 125, to_socket: 'cols' },
        { from_node: 125, from_socket: 'mat', to_node: 126, to_socket: 'indices' }
      ]
    };

    const meshCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: meshGraphData, execute: true })
    });
    assert.equal(meshCreateResp.ok, true, 'mesh session creation should succeed');
    const meshSession = await meshCreateResp.json();

    const meshPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(meshSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: meshSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 126, key: 'operation', value: 'height' }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [126],
          outputSockets: { '126': ['mesh'] }
        }
      })
    });
    assert.equal(meshPatchResp.ok, true, 'mesh patch should succeed');
    const meshPatchPayload = await meshPatchResp.json();
    const meshDelta = meshPatchPayload.deltas.find((node) => Number(node?.id) === 126);
    assert.ok(meshDelta, 'mesh patch should include mesh delta');
    assert.equal(Array.isArray(meshDelta.outputs?.mesh?.vertices), true,
      'mesh preview should currently be inline');
    assert.equal(meshDelta.outputs?.mesh?.colorMap, 'height',
      'mesh preview should reflect updated coloring mode');

    const meshAttributesGraphData = {
      nodes: [
        { id: 130, type: 'list', properties: { values: [0, 0, 0, 1, 0, 0, 0, 1, 0], operation: 'number' } },
        { id: 131, type: 'value', properties: { value: 3 } },
        { id: 132, type: 'matrix' },
        { id: 133, type: 'list', properties: { values: [0, 1, 2], operation: 'number' } },
        { id: 134, type: 'value', properties: { value: 3 } },
        { id: 135, type: 'matrix' },
        { id: 136, type: 'mesh', properties: { size: 1.0, operation: 'solid' } },
        { id: 137, type: 'mesh_attributes' }
      ],
      connections: [
        { from_node: 130, from_socket: 'list', to_node: 132, to_socket: 'data' },
        { from_node: 131, from_socket: 'out', to_node: 132, to_socket: 'cols' },
        { from_node: 132, from_socket: 'mat', to_node: 136, to_socket: 'vertices' },
        { from_node: 133, from_socket: 'list', to_node: 135, to_socket: 'data' },
        { from_node: 134, from_socket: 'out', to_node: 135, to_socket: 'cols' },
        { from_node: 135, from_socket: 'mat', to_node: 136, to_socket: 'indices' },
        { from_node: 136, from_socket: 'mesh', to_node: 137, to_socket: 'mesh' }
      ]
    };

    const meshAttributesCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: meshAttributesGraphData, execute: true })
    });
    assert.equal(meshAttributesCreateResp.ok, true, 'mesh_attributes session creation should succeed');
    const meshAttributesSession = await meshAttributesCreateResp.json();

    const meshAttributesPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(meshAttributesSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: meshAttributesSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 136, key: 'operation', value: 'height' }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [137],
          outputSockets: { '137': ['vertices', 'indices', 'colors', 'texture'] }
        }
      })
    });
    assert.equal(meshAttributesPatchResp.ok, true, 'mesh_attributes patch should succeed');
    const meshAttributesPatchPayload = await meshAttributesPatchResp.json();
    const meshAttributesDelta = meshAttributesPatchPayload.deltas.find((node) => Number(node?.id) === 137);
    assert.ok(meshAttributesDelta, 'mesh_attributes patch should include delta');
    assert.equal(meshAttributesDelta.outputs?.vertices?.stream?.mode, 'paged',
      'mesh_attributes vertices preview should use paged descriptor');
    assert.equal(meshAttributesDelta.outputs?.indices?.stream?.mode, 'paged',
      'mesh_attributes indices preview should use paged descriptor');
    assert.equal(meshAttributesDelta.outputs?.colors?.stream?.mode, 'paged',
      'mesh_attributes colors preview should use paged descriptor');
    assert.equal(meshAttributesDelta.outputs?.texture?.path, 'builtin://checkerboard',
      'mesh_attributes texture preview should stay inline and reflect mesh texture');

    const meshAttributesPageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(meshAttributesSession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: meshAttributesPatchPayload.version,
        nodeId: 137,
        socketId: 'vertices',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(meshAttributesPageResp.ok, true, 'mesh_attributes output-page should succeed');
    const meshAttributesPagePayload = await meshAttributesPageResp.json();
    assert.deepEqual(meshAttributesPagePayload.result?.output, [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      'mesh_attributes vertices output-page should reflect current mesh vertices');

    const textureGraphData = {
      nodes: [
        { id: 140, type: 'texture', properties: { path: '', material: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] } }
      ],
      connections: []
    };

    const textureCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: textureGraphData, execute: true })
    });
    assert.equal(textureCreateResp.ok, true, 'texture session creation should succeed');
    const textureSession = await textureCreateResp.json();

    const texturePatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(textureSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: textureSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 140, key: 'path', value: 'example.png' }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [140],
          outputSockets: { '140': ['texture'] }
        }
      })
    });
    assert.equal(texturePatchResp.ok, true, 'texture patch should succeed');
    const texturePatchPayload = await texturePatchResp.json();
    const textureDelta = texturePatchPayload.deltas.find((node) => Number(node?.id) === 140);
    assert.ok(textureDelta, 'texture patch should include texture delta');
    assert.equal(textureDelta.outputs?.texture?.path, 'example.png',
      'texture preview should reflect updated path inline');
    assert.equal(textureDelta.outputs?.texture?.useBuiltinChecker, false,
      'texture preview should reflect checkerboard fallback state');

    const laplacianGraphData = {
      nodes: [
        { id: 150, type: 'list', properties: { values: [0, 0, 0, 1, 0, 0, 0, 1, 0], operation: 'number' } },
        { id: 151, type: 'value', properties: { value: 3 } },
        { id: 152, type: 'matrix' },
        { id: 153, type: 'list', properties: { values: [0, 1, 2], operation: 'number' } },
        { id: 154, type: 'value', properties: { value: 3 } },
        { id: 155, type: 'matrix' },
        { id: 156, type: 'mesh', properties: { size: 1.0, operation: 'solid' } },
        { id: 157, type: 'laplacian_deform', properties: { iterations: 1, strength: 0.0, phase_filter: 'all', interaction_event: {} } }
      ],
      connections: [
        { from_node: 150, from_socket: 'list', to_node: 152, to_socket: 'data' },
        { from_node: 151, from_socket: 'out', to_node: 152, to_socket: 'cols' },
        { from_node: 152, from_socket: 'mat', to_node: 156, to_socket: 'vertices' },
        { from_node: 153, from_socket: 'list', to_node: 155, to_socket: 'data' },
        { from_node: 154, from_socket: 'out', to_node: 155, to_socket: 'cols' },
        { from_node: 155, from_socket: 'mat', to_node: 156, to_socket: 'indices' },
        { from_node: 156, from_socket: 'mesh', to_node: 157, to_socket: 'mesh' }
      ]
    };

    const laplacianCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: laplacianGraphData, execute: true })
    });
    assert.equal(laplacianCreateResp.ok, true, 'laplacian session creation should succeed');
    const laplacianSession = await laplacianCreateResp.json();

    const laplacianEvent = {
      phase: 'commit',
      payload: {
        handles: [
          { id: 0, position: [2, 0, 0] }
        ]
      }
    };
    const laplacianPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(laplacianSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: laplacianSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 157, key: 'interaction_event', value: laplacianEvent }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [157],
          outputSockets: { '157': ['mesh', 'moved', 'handles'] }
        }
      })
    });
    assert.equal(laplacianPatchResp.ok, true, 'laplacian patch should succeed');
    const laplacianPatchPayload = await laplacianPatchResp.json();
    const laplacianDelta = laplacianPatchPayload.deltas.find((node) => Number(node?.id) === 157);
    assert.ok(laplacianDelta, 'laplacian patch should include deform delta');
    assert.equal(Array.isArray(laplacianDelta.outputs?.mesh?.vertices), true,
      'laplacian mesh preview should currently be inline');
    assert.equal(laplacianDelta.outputs?.handles, 1,
      'laplacian preview should reflect one active handle');
    assert.equal(Number(laplacianDelta.outputs?.moved) > 0, true,
      'laplacian preview should report positive deformation distance');

    const scalarCurvatureGraphData = {
      nodes: [
        { id: 160, type: 'list', properties: { values: [0, 0, 0, 1, 0, 0, 0, 1, 0], operation: 'number' } },
        { id: 161, type: 'value', properties: { value: 3 } },
        { id: 162, type: 'matrix' },
        { id: 163, type: 'list', properties: { values: [0, 1, 2], operation: 'number' } },
        { id: 164, type: 'value', properties: { value: 3 } },
        { id: 165, type: 'matrix' },
        { id: 166, type: 'mesh', properties: { size: 1.0, operation: 'solid' } },
        { id: 167, type: 'scalar_curvature', properties: { operation: 'gaussian' } }
      ],
      connections: [
        { from_node: 160, from_socket: 'list', to_node: 162, to_socket: 'data' },
        { from_node: 161, from_socket: 'out', to_node: 162, to_socket: 'cols' },
        { from_node: 162, from_socket: 'mat', to_node: 166, to_socket: 'vertices' },
        { from_node: 163, from_socket: 'list', to_node: 165, to_socket: 'data' },
        { from_node: 164, from_socket: 'out', to_node: 165, to_socket: 'cols' },
        { from_node: 165, from_socket: 'mat', to_node: 166, to_socket: 'indices' },
        { from_node: 166, from_socket: 'mesh', to_node: 167, to_socket: 'mesh' }
      ]
    };

    const scalarCurvatureCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: scalarCurvatureGraphData, execute: true })
    });
    assert.equal(scalarCurvatureCreateResp.ok, true, 'scalar curvature session creation should succeed');
    const scalarCurvatureSession = await scalarCurvatureCreateResp.json();

    const scalarCurvaturePatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(scalarCurvatureSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: scalarCurvatureSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 167, key: 'operation', value: 'mean' }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [167],
          outputSockets: { '167': ['curvature'] }
        }
      })
    });
    assert.equal(scalarCurvaturePatchResp.ok, true, 'scalar curvature patch should succeed');
    const scalarCurvaturePatchPayload = await scalarCurvaturePatchResp.json();
    const scalarCurvatureDelta = scalarCurvaturePatchPayload.deltas.find((node) => Number(node?.id) === 167);
    assert.ok(scalarCurvatureDelta, 'scalar curvature patch should include curvature delta');
    assert.equal(scalarCurvatureDelta.outputs?.curvature?.stream?.mode, 'paged',
      'scalar curvature preview should use paged descriptor');
    assert.equal(scalarCurvatureDelta.outputs?.curvature?.stream?.totalCount, 3,
      'scalar curvature descriptor should reflect vertex count');

    const scalarCurvaturePageResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(scalarCurvatureSession.sessionId)}/output-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: scalarCurvaturePatchPayload.version,
        nodeId: 167,
        socketId: 'curvature',
        offset: 0,
        limit: 4
      })
    });
    assert.equal(scalarCurvaturePageResp.ok, true, 'scalar curvature output-page should succeed');
    const scalarCurvaturePagePayload = await scalarCurvaturePageResp.json();
    assert.equal(Array.isArray(scalarCurvaturePagePayload.result?.output), true,
      'scalar curvature output-page should return curvature array');
    assert.equal(scalarCurvaturePagePayload.result?.output.length, 3,
      'scalar curvature output-page should expose one value per vertex');

    const interactionGraphData = {
      nodes: [
        { id: 170, type: 'geometry_viewer', properties: { intensity: 1.2 } },
        { id: 171, type: 'interaction_state', properties: { channel: 'mesh_edit', phase_filter: 'all' } }
      ],
      connections: [
        { from_node: 170, from_socket: 'interaction', to_node: 171, to_socket: 'event' }
      ]
    };

    const interactionCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: interactionGraphData, execute: true })
    });
    assert.equal(interactionCreateResp.ok, true, 'interaction session creation should succeed');
    const interactionSession = await interactionCreateResp.json();

    const meshEditEvent = {
      channel: 'mesh_edit',
      phase: 'commit',
      sourceNodeId: 170,
      targetNodeId: 170,
      version: 42,
      timestampMs: 4242,
      source: 'selftest',
      payload: {
        action: 'mesh_edit_handles',
        handles: [{ id: 0, position: [1, 2, 3] }]
      }
    };
    const interactionPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(interactionSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: interactionSession.version,
        patches: [
          { op: 'viewer_interaction', nodeId: 170, key: 'interaction_event', value: meshEditEvent }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [170, 171],
          outputSockets: { '170': ['interaction'], '171': ['state', 'event', 'payload', 'channel'] }
        }
      })
    });
    assert.equal(interactionPatchResp.ok, true, 'interaction patch should succeed');
    const interactionPatchPayload = await interactionPatchResp.json();
    const viewerInteractionDelta = interactionPatchPayload.deltas.find((node) => Number(node?.id) === 170);
    const interactionStateDelta = interactionPatchPayload.deltas.find((node) => Number(node?.id) === 171);
    assert.ok(viewerInteractionDelta, 'geometry_viewer interaction patch should include viewer delta');
    assert.ok(interactionStateDelta, 'geometry_viewer interaction patch should include interaction_state delta');
    assert.equal(viewerInteractionDelta.outputs?.interaction?.channel, 'mesh_edit',
      'geometry_viewer interaction preview should expose the latest interaction channel');
    assert.equal(interactionStateDelta.outputs?.channel, 'mesh_edit',
      'interaction_state preview should expose the selected interaction channel');
    assert.equal(interactionStateDelta.outputs?.event?.phase, 'commit',
      'interaction_state preview should expose the latest interaction phase');
    assert.deepEqual(interactionStateDelta.outputs?.payload?.handles, [{ id: 0, position: [1, 2, 3] }],
      'interaction_state preview should expose the latest interaction payload');

    const cameraEvent = {
      channel: 'camera',
      phase: 'update',
      sourceNodeId: 170,
      targetNodeId: 170,
      version: 43,
      timestampMs: 4343,
      source: 'selftest',
      payload: {
        action: 'viewer_camera_state',
        value: { eye: [0, 0, 5] }
      }
    };
    const cameraPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(interactionSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: interactionPatchPayload.version,
        patches: [
          { op: 'viewer_interaction', nodeId: 170, key: 'interaction_event', value: cameraEvent }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [170],
          outputSockets: { '170': ['interaction'] }
        }
      })
    });
    assert.equal(cameraPatchResp.ok, true, 'camera interaction patch should succeed');
    const cameraPatchPayload = await cameraPatchResp.json();
    assert.equal(cameraPatchPayload.affectedNodeCount, 0,
      'camera interaction should not affect graph execution seeds');

    const pointsFilePath = path.join(tempDir, 'points.xyz');
    await fs.writeFile(pointsFilePath, '0 0 0\n1 0 0\n', 'utf8');
    const loadPointsGraphData = {
      nodes: [
        { id: 180, type: 'load_points', properties: { path: pointsFilePath } }
      ],
      connections: []
    };
    const loadPointsCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: loadPointsGraphData, execute: true })
    });
    assert.equal(loadPointsCreateResp.ok, true, 'load_points session creation should succeed');
    const loadPointsSession = await loadPointsCreateResp.json();
    const loadPointsPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(loadPointsSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: loadPointsSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 180, key: 'path', value: pointsFilePath }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [180],
          outputSockets: { '180': ['points'] }
        }
      })
    });
    assert.equal(loadPointsPatchResp.ok, true, 'load_points patch should succeed');
    const loadPointsPatchPayload = await loadPointsPatchResp.json();
    const loadPointsDelta = loadPointsPatchPayload.deltas.find((node) => Number(node?.id) === 180);
    assert.ok(loadPointsDelta, 'load_points patch should include delta');
    assert.equal(loadPointsDelta.outputs?.points?.count, 2,
      'load_points preview should reflect currently loaded point count');

    const writePointsOutputPath = path.join(tempDir, 'written_points.xyz');
    const writePointsGraphData = {
      nodes: [
        { id: 181, type: 'load_points', properties: { path: pointsFilePath } },
        { id: 182, type: 'write_points', properties: { path: writePointsOutputPath } }
      ],
      connections: [
        { from_node: 181, from_socket: 'points', to_node: 182, to_socket: 'points' }
      ]
    };
    const writePointsCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: writePointsGraphData, execute: true })
    });
    assert.equal(writePointsCreateResp.ok, true, 'write_points session creation should succeed');
    const writePointsSession = await writePointsCreateResp.json();
    const writePointsPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(writePointsSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: writePointsSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 182, key: 'path', value: writePointsOutputPath }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [182],
          outputSockets: { '182': ['ok'] }
        }
      })
    });
    assert.equal(writePointsPatchResp.ok, true, 'write_points patch should succeed');
    const writePointsPatchPayload = await writePointsPatchResp.json();
    const writePointsDelta = writePointsPatchPayload.deltas.find((node) => Number(node?.id) === 182);
    assert.ok(writePointsDelta, 'write_points patch should include delta');
    assert.equal(writePointsDelta.outputs?.ok, 1,
      'write_points preview should report successful export');
    await waitForFile(writePointsOutputPath);
    const writtenPointsText = await fs.readFile(writePointsOutputPath, 'utf8');
    assert.equal(writtenPointsText.includes('1 0 0'), true,
      'write_points should export current point data');

    const linesFilePath = path.join(tempDir, 'lines.obj');
    await fs.writeFile(linesFilePath, 'v 0 0 0\nv 1 0 0\nl 1 2\n', 'utf8');
    const loadLinesGraphData = {
      nodes: [
        { id: 183, type: 'load_lines', properties: { path: linesFilePath } }
      ],
      connections: []
    };
    const loadLinesCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: loadLinesGraphData, execute: true })
    });
    assert.equal(loadLinesCreateResp.ok, true, 'load_lines session creation should succeed');
    const loadLinesSession = await loadLinesCreateResp.json();
    const loadLinesPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(loadLinesSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: loadLinesSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 183, key: 'path', value: linesFilePath }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [183],
          outputSockets: { '183': ['lines'] }
        }
      })
    });
    assert.equal(loadLinesPatchResp.ok, true, 'load_lines patch should succeed');
    const loadLinesPatchPayload = await loadLinesPatchResp.json();
    const loadLinesDelta = loadLinesPatchPayload.deltas.find((node) => Number(node?.id) === 183);
    assert.ok(loadLinesDelta, 'load_lines patch should include delta');
    assert.equal(loadLinesDelta.outputs?.lines?.segmentCount, 1,
      'load_lines preview should reflect currently loaded segment count');

    const writeLinesOutputPath = path.join(tempDir, 'written_lines.obj');
    const writeLinesGraphData = {
      nodes: [
        { id: 184, type: 'load_lines', properties: { path: linesFilePath } },
        { id: 185, type: 'write_lines', properties: { path: writeLinesOutputPath } }
      ],
      connections: [
        { from_node: 184, from_socket: 'lines', to_node: 185, to_socket: 'lines' }
      ]
    };
    const writeLinesCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: writeLinesGraphData, execute: true })
    });
    assert.equal(writeLinesCreateResp.ok, true, 'write_lines session creation should succeed');
    const writeLinesSession = await writeLinesCreateResp.json();
    const writeLinesPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(writeLinesSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: writeLinesSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 185, key: 'path', value: writeLinesOutputPath }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [185],
          outputSockets: { '185': ['ok'] }
        }
      })
    });
    assert.equal(writeLinesPatchResp.ok, true, 'write_lines patch should succeed');
    const writeLinesPatchPayload = await writeLinesPatchResp.json();
    const writeLinesDelta = writeLinesPatchPayload.deltas.find((node) => Number(node?.id) === 185);
    assert.ok(writeLinesDelta, 'write_lines patch should include delta');
    assert.equal(writeLinesDelta.outputs?.ok, 1,
      'write_lines preview should report successful export');
    await waitForFile(writeLinesOutputPath);
    const writtenLinesText = await fs.readFile(writeLinesOutputPath, 'utf8');
    assert.equal(writtenLinesText.includes('l 1 2'), true,
      'write_lines should export current segment data');

    const meshFilePath = path.join(tempDir, 'mesh.obj');
    await fs.writeFile(meshFilePath, 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n', 'utf8');
    const loadMeshGraphData = {
      nodes: [
        { id: 186, type: 'load_mesh', properties: { path: meshFilePath } }
      ],
      connections: []
    };
    const loadMeshCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: loadMeshGraphData, execute: true })
    });
    assert.equal(loadMeshCreateResp.ok, true, 'load_mesh session creation should succeed');
    const loadMeshSession = await loadMeshCreateResp.json();
    const loadMeshPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(loadMeshSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: loadMeshSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 186, key: 'path', value: meshFilePath }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [186],
          outputSockets: { '186': ['mesh'] }
        }
      })
    });
    assert.equal(loadMeshPatchResp.ok, true, 'load_mesh patch should succeed');
    const loadMeshPatchPayload = await loadMeshPatchResp.json();
    const loadMeshDelta = loadMeshPatchPayload.deltas.find((node) => Number(node?.id) === 186);
    assert.ok(loadMeshDelta, 'load_mesh patch should include delta');
    assert.equal(Array.isArray(loadMeshDelta.outputs?.mesh?.vertices), true,
      'load_mesh preview should currently be inline');
    assert.equal(loadMeshDelta.outputs?.mesh?.triangles?.length, 1,
      'load_mesh preview should reflect currently loaded triangle count');

    const writeMeshOutputPath = path.join(tempDir, 'written_mesh.obj');
    const writeMeshGraphData = {
      nodes: [
        { id: 187, type: 'load_mesh', properties: { path: meshFilePath } },
        { id: 188, type: 'write_mesh', properties: { path: writeMeshOutputPath } }
      ],
      connections: [
        { from_node: 187, from_socket: 'mesh', to_node: 188, to_socket: 'mesh' }
      ]
    };
    const writeMeshCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphData: writeMeshGraphData, execute: true })
    });
    assert.equal(writeMeshCreateResp.ok, true, 'write_mesh session creation should succeed');
    const writeMeshSession = await writeMeshCreateResp.json();
    const writeMeshPatchResp = await fetch(`${baseUrl}/graph/${encodeURIComponent(writeMeshSession.sessionId)}/patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: writeMeshSession.version,
        patches: [
          { op: 'set_node_property', nodeId: 188, key: 'path', value: writeMeshOutputPath }
        ],
        execute: true,
        executionOptions: {
          omitOutputs: false,
          maxPreviewItems: 4,
          outputNodeIds: [188],
          outputSockets: { '188': ['ok'] }
        }
      })
    });
    assert.equal(writeMeshPatchResp.ok, true, 'write_mesh patch should succeed');
    const writeMeshPatchPayload = await writeMeshPatchResp.json();
    const writeMeshDelta = writeMeshPatchPayload.deltas.find((node) => Number(node?.id) === 188);
    assert.ok(writeMeshDelta, 'write_mesh patch should include delta');
    assert.equal(writeMeshDelta.outputs?.ok, 1,
      'write_mesh preview should report successful export');
    await waitForFile(writeMeshOutputPath);
    const writtenMeshText = await fs.readFile(writeMeshOutputPath, 'utf8');
    assert.equal(writtenMeshText.includes('f 1 2 3'), true,
      'write_mesh should export current mesh faces');

    const viewerGraphData = {
      nodes: [
        {
          id: 10,
          type: 'geometry',
          properties: { values: [0, 0, 1] }
        },
        {
          id: 11,
          type: 'geometry_viewer'
        }
      ],
      connections: [
        { from_node: 10, from_socket: 'geometry', to_node: 11, to_socket: 'geometry' }
      ]
    };

    const viewerCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphData: viewerGraphData,
        execute: true
      })
    });
    assert.equal(viewerCreateResp.ok, true, 'viewer session creation should succeed');
    const viewerSession = await viewerCreateResp.json();
    const viewerNodes = Array.isArray(viewerSession.results?.nodes) ? viewerSession.results.nodes : [];
    const viewerNode = viewerNodes.find((node) => Number(node?.id) === 11);
    assert.ok(viewerNode, 'geometry_viewer node should be present in results');
    const viewPayload = viewerNode.outputs?.view;
    assert.ok(viewPayload, 'geometry_viewer should expose view output');
    assert.equal(viewPayload.viewerType, 'geometry', 'viewer output should stay geometry payload');
    assert.ok(viewPayload.stream && viewPayload.stream.mode === 'chunked',
      'geometry_viewer payload should be rewritten to chunked stream form');
    if (Array.isArray(viewPayload.objects) && viewPayload.objects.length > 0) {
      const firstObject = viewPayload.objects[0];
      assert.equal(Array.isArray(firstObject.positions), false,
        'chunked geometry_viewer objects should not inline positions');
      assert.equal(Array.isArray(firstObject.triIndices), false,
        'chunked geometry_viewer objects should not inline triangle indices');
      assert.equal(Array.isArray(firstObject.lineIndices), false,
        'chunked geometry_viewer objects should not inline line indices');
      assert.equal(Array.isArray(firstObject.pointIndices), false,
        'chunked geometry_viewer objects should not inline point indices');
    }
    assert.equal(Array.isArray(viewPayload.positions), false,
      'streamed geometry_viewer payload should not inline full positions');

    const geometryGraphData = {
      nodes: [
        {
          id: 20,
          type: 'geometry',
          properties: { values: [0, 0, 1] }
        }
      ],
      connections: []
    };

    const geometryCreateResp = await fetch(`${baseUrl}/graph/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphData: geometryGraphData,
        execute: true
      })
    });
    assert.equal(geometryCreateResp.ok, true, 'geometry session creation should succeed');
    const geometrySession = await geometryCreateResp.json();
    const geometryNodes = Array.isArray(geometrySession.results?.nodes) ? geometrySession.results.nodes : [];
    const geometryNode = geometryNodes.find((node) => Number(node?.id) === 20);
    assert.ok(geometryNode, 'geometry node should be present in results');
    const geometryPayload = geometryNode.outputs?.geometry;
    assert.ok(geometryPayload, 'geometry node should expose geometry output');
    assert.equal(geometryPayload.viewerType, 'geometry', 'geometry output should expose viewer type');
    assert.ok(geometryPayload.stream && geometryPayload.stream.mode === 'chunked',
      'geometry output should be rewritten to chunked stream form');
    if (Array.isArray(geometryPayload.objects) && geometryPayload.objects.length > 0) {
      const firstObject = geometryPayload.objects[0];
      assert.equal(Array.isArray(firstObject.positions), false,
        'chunked geometry objects should not inline positions');
      assert.equal(Array.isArray(firstObject.triIndices), false,
        'chunked geometry objects should not inline triangle indices');
    }
    assert.equal(Array.isArray(geometryPayload.positions), false,
      'streamed geometry output should not inline full positions');

    console.log('server_output_page_selftest passed');
  } finally {
    server.kill();
    await wait(200);
    if (!server.killed) {
      server.kill('SIGKILL');
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    if (stderr.trim()) {
      console.warn('[server_output_page_selftest][stderr]', stderr.trim());
    }
    if (!stdout.includes(`http://localhost:${port}`) && stdout.trim()) {
      console.warn('[server_output_page_selftest][stdout]', stdout.trim());
    }
  }
}

main().catch((error) => {
  console.error('server_output_page_selftest failed:', error);
  process.exitCode = 1;
});
