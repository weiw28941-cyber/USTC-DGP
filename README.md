# Frame

A node-based framework for geometry and numeric computation.

The repository has three main layers:
- `NodeSystem/`
  - C++ execution core
  - Handles node registration, graph model, patch application, incremental execution, caching, and output serialization
- `Server/`
  - Node.js session layer
  - Handles graph sessions, patch protocol, paged outputs, and streamed geometry transport
- `WebUI/`
  - Browser-based node editor
  - Handles canvas interaction, preview panel, Geometry Viewer, and execution result updates

## Current Architecture

The backend execution core is split into focused modules:
- `NodeSystem/graph_model.*`
  - Graph data, connection indexes, JSON loading
- `NodeSystem/graph_patch_applier.*`
  - Patch application, local invalidation, interaction patch normalization
- `NodeSystem/graph_executor.*`
  - Node execution, cache hits, incremental execution, output reads
- `NodeSystem/graph_runtime.*`
  - Worker and CLI request parsing and dispatch
- `NodeSystem/node_signature.*`
  - Input and property signatures
- `NodeSystem/output_transport.*`
  - Output transport descriptor generation
- `NodeSystem/patch_semantics.*`
  - Patch classification and execution semantics

The frontend execution pipeline is also split:
- `WebUI/core/graph_execution_rules.js`
- `WebUI/core/patch_queue.js`
- `WebUI/core/execution_session_client.js`
- `WebUI/core/execution_request_builder.js`
- `WebUI/core/execution_result_applier.js`
- `WebUI/core/output_transport.js`

Frontend preview update contract:
- `WebUI/core/preview_target_router.js`
  - Selects preview/output targets for property, socket, connection, and context-driven graph changes
- `WebUI/core/node_preview_contracts.js`
  - Declares and validates per-node `previewSocket` contract data at node type load time
- `WebUI/core/graph_change_execution.js`
  - Defines the standard frontend graph-change execution helpers for property/socket and connection changes
- `WebUI/core/queued_execution_options.js`
  - Preserves those targets when patches are queued and flushed later

See:
- [docs/frontend_preview_contract.md](/Users/lym29/Documents/Frame/docs/frontend_preview_contract.md)

Geometry Viewer frontend contract:
- `WebUI/ui/mesh_viewer_display_state.js`
- `WebUI/ui/mesh_viewer_lod.js`
- `WebUI/ui/mesh_viewer_lines.js`
- `WebUI/ui/mesh_viewer_aux_lods.js`
- `WebUI/ui/mesh_viewer_streaming.js`
- `WebUI/ui/mesh_viewer_handles.js`
- `WebUI/ui/mesh_viewer_prewarm.js`
- `WebUI/ui/mesh_viewer_windowing.js`
- `WebUI/ui/mesh_viewer_math.js`
- `WebUI/ui/mesh_viewer_object_ui.js`
- `WebUI/ui/mesh_viewer_editing.js`
- `WebUI/ui/mesh_viewer_selection_render.js`

See:
- [docs/frontend_geometry_viewer_contract.md](/Users/lym29/Documents/Frame/docs/frontend_geometry_viewer_contract.md)

## Schema

Node schema is now a first-class interface:
- Every registered node should implement `getSchema()`
- `NodeFactory::generateNodeTypesConfig()` builds `json/generated/node_types.json` from schema metadata
- The frontend uses schema for node labels, tooltips, editability, and `Op/Type` switching

For new nodes, start here:
- [CUSTOM_NODES_GUIDE.md](/Users/lym29/Documents/Frame/NodeSystem/CUSTOM_NODES_GUIDE.md)

## Incremental Execution

The following patch types trigger incremental execution by default:
- `add_node`
- `add_connection`
- `remove_connection`
- `set_node_property`
- `set_node_input_literal`
- non-`camera` `viewer_interaction`

Geometry Viewer interaction semantics:
- `mesh_edit` and `selection`
  - enter the graph execution pipeline
  - recompute only the affected subgraph
- `camera`
  - updates local viewer camera state only
  - does not trigger graph execution

## Preview And Output Transport

There are three output transport modes:

- `inline`
  - For small scalars, small objects, and compact interaction payloads
  - Examples: `interaction_state`, `viewer_camera_state`, small number/string/map results
- `paged`
  - For large top-level arrays
  - Examples: `vector`, `list`, `matrix`, and other array-shaped outputs
  - The first response returns a descriptor, and the frontend loads pages through `/graph/:sessionId/output-page`
- `chunked`
  - For large structured geometry payloads
  - Examples: `geometry`, `geometry_viewer`
  - The server returns lightweight metadata plus a `stream` descriptor, and the frontend fetches chunks on demand

Shared transport helpers live in:
- C++: `NodeSystem/output_transport.*`
- Server: `Server/output_transport.js`
- WebUI: `WebUI/core/output_transport.js`

Rules:
- Do not hand-roll `value.stream.mode === ...` branches in new code; use transport helpers
- Do not keep large arrays on direct inline preview paths
- `geometry` and mesh-like payloads should use `chunked`
- Large top-level arrays should use `paged`
- Only genuinely small results should stay `inline`

Preview transport semantics:
- Preview transport is controlled only by the shared `inline / paged / chunked` helpers
- `paged` uses a fixed preload page size
- `chunked` uses fixed stream chunk and parallel limits plus staged field loading
- Preview transport settings are no longer user-adjustable in the UI

Frontend preview update semantics:
- Preview target selection and queued patch propagation are separate layers
- Graph changes now have a standard execution layer as well
- Preview targets must be selected through `preview_target_router.js`
- New node property/socket edits must use `applyPreviewTrackedNodeEdit(...)`
- New connection edits must use `enqueueConnectionGraphChange(...)`
- Preview sockets must come from node type contract data, not runtime guesswork
- Queued graph changes must preserve custom preview targets through `queued_execution_options.js`
- Do not hand-roll `outputNodeIds` / `outputSockets` in multiple interaction paths

Important:
- The backend no longer recursively truncates arbitrary JSON payloads
- Do not build viewer or preview logic around truncated nested arrays

## Build

### Configure And Compile

```powershell
cmake -S . -B build
cmake --build build --config Release
```

Common targets:
- `processor`
- `processor_tests`
- `generate_node_config`

Build outputs:
- `build/bin/processor(.exe)`
- `build/bin/processor_tests(.exe)`
- `json/generated/node_types.json`

### Run Tests

```powershell
cmake --build build --target processor_tests --config Release
ctest --test-dir build --output-on-failure
```

Frontend execution self-test:

```powershell
node --experimental-default-type=module scripts/webui_execution_selftest.mjs
```

Preview pipeline self-test:

```powershell
node --experimental-default-type=module scripts/test_preview_pipeline.mjs
```

Self-test stability guidance:
- Prefer `/outputs` and `/output-page` assertions for preview correctness.
- Use direct patch-delta assertions only for patch-propagation behavior.
- For writer nodes, wait for exported files to appear before validating their contents.

## Run The Server

```powershell
cd Server
npm install
npm start
```

Default URL:
- `http://localhost:3000`

## Add A New Node

Use the scaffold script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\new_node.ps1 -Name demo_add
```

The scaffold generates:
- a header file
- a source file
- a default `getSchema()` implementation
- `NodeRegistrar<T>` registration code

You usually still need to implement:
- `execute()` logic
- `NodeUtils::registerAnyToJson<T>()` for `CUSTOM` outputs
- schema details such as `editor`, `description`, `color`, and `options`

## Interaction Flow

Recommended wiring:
- Viewer nodes output `interaction`
- Connect it to `interaction_state.event`
- Downstream nodes read structured state from `interaction_state`

Relevant files:
- `json/config/interaction_schema.json`
- `NodeSystem/Utils/src/node_interaction.cpp`
- `NodeSystem/Geometry/src/node_geometry.cpp`

## JSON Directory

JSON files are organized under `json/`:
- `json/generated/`
- `json/runtime/`
- `json/config/`
- `json/examples/`
- `json/tests/`

See:
- [json/README.md](/Users/lym29/Documents/Frame/json/README.md)

## Repository Layout

```text
Frame/
|-- CMakeLists.txt
|-- README.md
|-- json/
|-- NodeSystem/
|   |-- CUSTOM_NODES_GUIDE.md
|   |-- processor.cpp
|   |-- processor_tests.cpp
|   |-- graph_model.*
|   |-- graph_patch_applier.*
|   |-- graph_executor.*
|   |-- graph_runtime.*
|   |-- output_transport.*
|   |-- patch_semantics.*
|   |-- Utils/
|   `-- Geometry/
|-- Server/
|-- WebUI/
`-- scripts/
```

## FAQ

- New nodes compile but do not appear in the frontend
  - Rebuild and confirm that `json/generated/node_types.json` was regenerated
- Preview only shows `Object`
  - A `CUSTOM` output is probably missing `NodeUtils::registerAnyToJson<T>()`
- `interaction_state` stays empty
  - Check that the viewer `interaction` output is really connected to `interaction_state.event`
- Geometry Viewer rotation triggers recompute
  - Under the current design, it should not
  - Only `mesh_edit` and `selection` enter the graph execution pipeline
