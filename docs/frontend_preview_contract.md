# Frontend Preview Update Contract

This document defines the fixed frontend contract for preview updates.

The preview update chain is intentionally split into three layers:

1. Preview target selection
2. Graph change execution
3. Queued execution option propagation

These layers must stay separate.

## Hard Constraints

New frontend graph-editing code must follow these rules:

1. Property and socket changes must use `applyPreviewTrackedNodeEdit(...)`.
2. Connection changes must use `enqueueConnectionGraphChange(...)`.
3. Preview sockets must come from node type contract data.

These are enforced in code:
- `editor.js`
  - throws if a property edit patch reaches `syncSessionAfterNodeEdit(...)` without `executionOptions`
  - throws if a connection patch reaches `enqueueIncrementalExecutionPatches(...)` without `executionOptions`
- `preview_target_router.js`
  - throws if a node with outputs has no declared `previewSocket` contract

The purpose is to prevent silent preview drift when new node types or new interaction code paths are added.

## Layer 1: Preview Target Selection

Files:
- `WebUI/core/preview_target_router.js`
- `WebUI/core/node_preview_contracts.js`
- `WebUI/core/execution_request_builder.js`

Responsibility:
- Decide which node outputs must be requested after a graph change.
- Convert node/context changes into `outputNodeIds` and `outputSockets`.
- Load and validate per-node `previewSocket` contract data.

Current entry points:
- `buildPropertyPreviewExecutionOptions(...)`
  - For direct property edits such as `value`, `text`, `path`, and local `values` edits.
- `buildConnectionPreviewExecutionOptions(...)`
  - For connection changes such as `add_connection` and `remove_connection`.
- `buildContextPreviewExecutionOptions(...)`
  - For normal incremental execution context:
    - active preview panel node
    - active mesh viewer node
    - routed interaction focus nodes
- `buildNodePreviewExecutionOptions(...)`
  - Convenience helper for explicit node lists.

Rules:
- Do not hand-build `outputNodeIds` / `outputSockets` in interaction code.
- Do not duplicate socket-choice rules outside `preview_target_router.js`.
- New node types must declare `previewSocket` during node type loading.
- Do not rely on runtime fallback such as `outputs[0]`.

Preview socket contract source:
- `WebUI/core/node_preview_contracts.js`
- `NodeEditor.loadNodeTypes()`

Rules:
- `previewSocket` must resolve to an existing output id, or `null`.
- If a node type has outputs and no valid `previewSocket`, that is a contract error.

## Layer 2: Graph Change Execution

Files:
- `WebUI/core/graph_change_execution.js`
- `WebUI/core/node_operation_updates.js`
- `WebUI/core/dynamic_socket_controls.js`
- `WebUI/core/interaction.js`

Responsibility:
- Turn graph edits into the standard execution chain:
  - local state update
  - patch enqueue/dispatch
  - preview target request

Required helpers:
- `applyPreviewTrackedNodeEdit(...)`
  - For property changes and socket/value edits
- `enqueueConnectionGraphChange(...)`
  - For connection changes

Rules:
- Do not call `applyNodeEdit(...)` directly for new property/socket editing features.
- Do not call `enqueueIncrementalExecutionPatches(...)` directly for new connection editing features.
- `operation` switching must route through `node_operation_updates.js`.
- Dynamic socket controls must route through `dynamic_socket_controls.js`.

## Layer 3: Queued Execution Option Propagation

Files:
- `WebUI/core/queued_execution_options.js`
- `WebUI/core/editor.js`

Responsibility:
- Preserve preview target requests when patches are queued and flushed later.
- Merge multiple queued `executionOptions` into a single batch-safe payload.

Why this exists:
- Many frontend changes do not execute immediately.
- Patches first enter `GraphPatchQueue`.
- If preview target requests are not carried through the queue, the graph may recompute correctly but the target preview will not refresh.

Current helper:
- `QueuedExecutionOptionsAccumulator`
  - `queue(executionOptions)`
  - `consume()`
  - `clear()`

Rules:
- Any queued patch path that carries custom preview/output targets must route them through the accumulator.
- `resetGraphSession()` and graph replacement paths must clear both:
  - `patchQueue`
  - queued execution options

## Required Flow For Graph Changes

### Property change

Use:
- `graph_change_execution.js`
- `preview_target_router.js`
- `preview_output_state.js`

Typical examples:
- `value`
- `string`
- `load_mesh.path`
- `operation`

### Socket/value-count change

Use:
- `WebUI/core/dynamic_socket_controls.js`
- `WebUI/core/graph_change_execution.js`

Requirements:
- Update local `node.values`
- Rebuild inputs
- Emit `set_node_property(values)`
- Request the node's preview target through the router
- Sync local preview/meta when a cheap local preview is valid

### Connection change

Use:
- `enqueueConnectionGraphChange(...)`

Requirements:
- Request preview for affected downstream target nodes
- Pass those targets through queued execution option propagation

## Local Preview State

Files:
- `WebUI/core/preview_output_state.js`

Responsibility:
- Keep immediate local preview/meta updates consistent across editors and socket controls.

Rules:
- Do not rewrite `previewMeta` templates in multiple files.
- Reuse `syncLocalPreview(...)` when the edited value is already the correct preview value.

## Testing Rules

Files:
- `scripts/webui_execution_selftest.mjs`
- `scripts/test_preview_pipeline.mjs`

Minimum coverage:
- property edit updates preview target correctly
- dynamic socket change updates preview target correctly
- connection change requests downstream preview targets
- missing execution helpers fail fast
- missing preview socket contract fails fast
- queued execution options survive delayed flush

If a future change touches preview update behavior, add or update self-tests in these areas before merging.
