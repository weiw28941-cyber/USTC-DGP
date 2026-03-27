const assert = require('assert');

const BASE_URL = process.env.FRAME_SERVER_URL || 'http://localhost:3000';

async function postJson(path, body) {
    const resp = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${path}: ${payload?.error || payload?.message || 'unknown error'}`);
    }
    return payload;
}

async function main() {
    const graphData = {
        nodes: [
            {
                id: 1,
                type: 'interaction_state',
                x: 100,
                y: 100,
                width: 220,
                height: 180,
                properties: {
                    channel: 'all',
                    phase_filter: 'all'
                }
            }
        ],
        connections: [],
        groups: [],
        comments: []
    };

    const session = await postJson('/graph/session', {
        graphData,
        execute: false
    });

    const commitEvent = {
        channel: 'mesh_edit',
        phase: 'commit',
        sourceNodeId: 1,
        targetNodeId: 1,
        version: Date.now(),
        timestampMs: Date.now(),
        source: 'regression-test',
        payload: {
            action: 'mesh_edit_handles',
            value: {
                handles: [
                    { id: 0, position: [0.25, 0.0, 0.0] },
                    { id: 2, position: [1.0, 1.0, 0.0] }
                ]
            }
        }
    };

    const patchResult = await postJson(`/graph/${encodeURIComponent(session.sessionId)}/patch`, {
        baseVersion: session.version,
        patches: [
            {
                op: 'viewer_interaction',
                nodeId: 1,
                key: 'interaction_event',
                value: commitEvent
            }
        ],
        execute: true,
        fullResults: true,
        executionOptions: {
            omitOutputs: false,
            outputNodeIds: [1]
        }
    });

    const nodeResult = Array.isArray(patchResult?.results?.nodes)
        ? patchResult.results.nodes.find((n) => Number(n.id) === 1)
        : null;
    assert(nodeResult, 'interaction_state node result not found');

    const committed = nodeResult.outputs?.committed;
    assert(committed && typeof committed === 'object', 'committed output is missing');
    assert.strictEqual(committed.action, 'mesh_edit_handles', 'committed.action mismatch');
    assert(committed.value && Array.isArray(committed.value.handles), 'committed.value.handles missing');
    assert(committed.value.handles.length > 0, 'committed.value.handles is empty');

    console.log('PASS interaction_commit_regression');
}

main().catch((error) => {
    console.error('FAIL interaction_commit_regression');
    console.error(error?.stack || String(error));
    process.exit(1);
});
