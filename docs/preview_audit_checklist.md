# Preview Audit Checklist

Current preview mechanism:

- Preview is shown while holding the node preview icon.
- While visible, the preview should fetch the node's current output from the backend.
- `inline` outputs should refresh immediately.
- `paged` outputs should refresh the descriptor first, then fetch page 0.
- `chunked` outputs should refresh lightweight metadata, then stream payload data.

## Self-Test Stability Rules

- Prefer `/outputs` and `/output-page` for preview correctness checks.
- Use direct patch-delta assertions only when the test is explicitly about patch propagation.
- When a route depends on session-local visibility, use short retries instead of assuming the first response always carries the target delta.
- For writer nodes, wait for the output file to appear before validating exported contents.
- For pure operator coverage, prefer building the graph directly in the target operation mode instead of adding an extra patch hop inside the self-test.

## Round 1: Basic Inputs And Operators

Status:
- `value`: covered by automated self-test
- `string`: covered by automated self-test
- `vector`: covered by automated self-test
- `list`: covered by automated self-test
- `matrix`: covered by automated self-test
- `value_math`: covered by automated self-test
- `vector_math`: covered by automated self-test
- `vector_unary`: covered by automated self-test
- `vector_scalar`: covered by automated self-test
- `list_math`: covered by automated self-test
- `list_unary`: covered by automated self-test
- `list_scalar`: covered by automated self-test
- `matrix_math`: covered by automated self-test
- `matrix_unary`: covered by automated self-test
- `matrix_scalar`: covered by automated self-test

Checks for each node:
1. Build the smallest graph that produces the target output.
2. Hold the preview icon and confirm the preview opens.
3. Change an upstream value or editable property.
4. Hold the preview icon again and confirm the latest output is fetched.
5. Verify the transport mode matches expectations:
   - `inline` for scalar/string
   - `paged` for top-level arrays

## Round 2: Dynamic Input Nodes

Targets:
- `vector`
- `list`
- `geometry`

Status:
- `vector`: covered by automated self-test for local component-count changes + snapshot-sync preview fetch
- `list`: covered by automated self-test for local element-count changes + snapshot-sync preview fetch
- `geometry`: covered by automated self-test for dynamic point-input expansion + snapshot-sync preview fetch

Checks:
1. Add/remove inputs locally.
2. Hold preview and confirm the latest descriptor is fetched.
3. Verify page 0 or streamed geometry matches the current socket layout.

## Round 3: Geometry And Chunked Nodes

Targets:
- `geometry`
- `geometry_viewer`
- `points`
- `lines`
- `mesh`
- `mesh_attributes`
- `texture`
- `laplacian_deform`
- `scalar_curvature`

Status:
- `geometry`: covered by automated self-test for chunked stream metadata
- `geometry_viewer`: covered by automated self-test for chunked stream metadata
- `points`: covered by automated self-test for latest inline preview refresh
- `lines`: covered by automated self-test for latest inline preview refresh
- `mesh`: covered by automated self-test for latest inline preview refresh
- `mesh_attributes`: covered by automated self-test for current paged/inline mixed preview outputs
- `texture`: covered by automated self-test for latest inline preview refresh
- `laplacian_deform`: covered by automated self-test for latest inline mesh preview refresh
- `scalar_curvature`: covered by automated self-test for current paged preview outputs

Checks:
1. Hold preview and confirm the backend returns the expected transport for the node:
   - `chunked` for `geometry` and `geometry_viewer`
   - `inline` for `points`, `lines`, and `mesh`
2. Verify the payload matches current geometry.
3. Confirm no stale inline geometry arrays are used for stream-backed nodes.

## Round 4: Interaction Nodes

Targets:
- `interaction_state`
- interaction outputs from `geometry_viewer`

Status:
- `interaction_state`: covered by automated self-test for latest inline interaction payload refresh
- `geometry_viewer` interaction output: covered by automated self-test for latest inline interaction payload refresh
- `camera` interaction rule: covered by automated self-test on both frontend and server execution rules

Checks:
1. Hold preview during relevant interaction.
2. Confirm the latest inline interaction payload is fetched.
3. Confirm `camera` interactions do not force graph recompute.

## Round 5: IO Nodes

Targets:
- `load_points`
- `write_points`
- `load_lines`
- `write_lines`
- `load_mesh`
- `write_mesh`

Status:
- `load_points`: covered by automated self-test for latest inline preview refresh
- `write_points`: covered by automated self-test for latest export result preview
- `load_lines`: covered by automated self-test for latest inline preview refresh
- `write_lines`: covered by automated self-test for latest export result preview
- `load_mesh`: covered by automated self-test for latest inline preview refresh
- `write_mesh`: covered by automated self-test for latest export result preview

Checks:
1. Hold preview after changing path or upstream data.
2. Confirm preview reflects the latest execution result.
