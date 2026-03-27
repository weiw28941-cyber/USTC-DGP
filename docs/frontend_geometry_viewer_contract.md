# Frontend Geometry Viewer Contract

This document defines the intended module boundaries for the WebUI Geometry Viewer.

The goal is to keep `WebUI/ui/mesh_viewer_panel.js` focused on composition and runtime wiring.
Feature logic should live in dedicated modules.

## Main Rule

`mesh_viewer_panel.js` should primarily:
- build the panel shell
- own long-lived viewer state
- initialize WebGL runtime objects
- delegate feature logic to focused modules

Do not reintroduce large feature implementations directly into the panel file when a module boundary already exists.

## Viewer Delegate Contract

Geometry Viewer modules are allowed to call back into the panel instance through a fixed delegate surface.
That surface is defined in:

- `WebUI/ui/mesh_viewer_module_contracts.js`

This is a hard contract between:

- `mesh_viewer_panel.js`
- module files such as `mesh_viewer_rendering.js`, `mesh_viewer_lines.js`, `mesh_viewer_streaming.js`, and the other viewer modules

Rules:
- if a module calls `viewer.someMethod(...)`, that method must be declared in `mesh_viewer_module_contracts.js`
- `MeshViewerPanel` must provide a thin delegate implementation for every declared contract method
- do not let modules rely on undeclared implicit panel methods
- when adding a new module callback, update the contract file, the panel delegate, and self-tests in the same change

Why this exists:
- modularization bugs often show up as runtime errors like `viewer.someMethod is not a function`
- the delegate contract turns those into test failures before they reach the browser

Fail-fast expectation:
- missing delegate methods should be caught by self-tests
- do not rely on runtime fallback or optional chaining to hide a missing viewer delegate

## Current Module Boundaries

### Display State

File:
- `WebUI/ui/mesh_viewer_display_state.js`

Responsibility:
- point / line / face display flags
- object-level display toggles
- `lit / colormap / texture` mode switching
- color mode selection helpers

Use this module when changing:
- point/line/face visibility behavior
- color mode rules
- object display defaults

### LOD Selection

File:
- `WebUI/ui/mesh_viewer_lod.js`

Responsibility:
- face LOD choice
- line LOD choice
- point LOD choice

Use this module when changing:
- LOD heuristics
- screen-distance thresholds
- model-size based level selection

### Line Rendering Resources

File:
- `WebUI/ui/mesh_viewer_lines.js`

Responsibility:
- native line vs derived edge line source selection
- `edgeLods` construction
- line render resource scheduling

Rules:
- do not fold `edgeLods` back into generic auxiliary LOD code
- keep mesh-derived edge logic separate from native `lineIndices`

### Auxiliary LOD Precompute

File:
- `WebUI/ui/mesh_viewer_aux_lods.js`

Responsibility:
- auxiliary face LODs
- auxiliary line LODs
- auxiliary point LODs
- auxiliary arrow LODs
- scheduling of those background builds

Rules:
- this module is for general auxiliary LOD work
- it should not own mesh-derived edge LOD policy

### Streaming And Field Hydration

File:
- `WebUI/ui/mesh_viewer_streaming.js`

Responsibility:
- chunked payload resolution
- staged field loading
- `ensureFieldsForDisplay(...)`
- stream metadata helpers

Rules:
- keep streamed payload logic here
- do not re-spread ad hoc field-fetch rules through the panel
- prefer field-level hydration over deleting the full mesh cache

### Geometry Payload Parsing

File:
- `WebUI/ui/mesh_viewer_geometry.js`

Responsibility:
- convert transport payloads into normalized viewer geometry
- parse packed arrays for positions, colors, UVs, and index buffers

Rules:
- payload-to-geometry conversion belongs here
- do not duplicate geometry parsing in panel or handle code

### Handle And Buffer Management

File:
- `WebUI/ui/mesh_viewer_handles.js`

Responsibility:
- `bindMesh(...)`
- `getOrCreateHandleForPayload(...)`
- `hydrateHandleForPayload(...)`

Rules:
- handle creation and incremental GPU buffer hydration belong here
- display toggles should not directly rebuild full handles in unrelated files

### Handle Resource Lifecycle

File:
- `WebUI/ui/mesh_viewer_handle_resources.js`

Responsibility:
- vertex normal generation
- GPU buffer release helpers
- full handle creation from normalized geometry

Rules:
- GPU resource lifecycle helpers belong here
- do not duplicate normal generation or buffer release logic across panel and handles code
- full handle creation should stay separate from higher-level cache policy

### Handle Builder Utilities

File:
- `WebUI/ui/mesh_viewer_handle_builders.js`

Responsibility:
- directed arrow LOD creation
- face / line / point LOD index reduction helpers

Rules:
- reusable handle-construction helpers belong here
- avoid duplicating builder math between panel, handles, and auxiliary LOD code

### Geometry Mutation And Buffer Refresh

File:
- `WebUI/ui/mesh_viewer_geometry_updates.js`

Responsibility:
- push edited vertex positions back into handle geometry
- rebuild the shared vertex buffer after geometry edits
- rebuild triangle LOD index buffers after geometry edits

Rules:
- geometry edit refresh logic belongs here
- do not duplicate mesh-edit buffer rebuild code in the panel

### Prewarm And Deferred Show

File:
- `WebUI/ui/mesh_viewer_prewarm.js`

Responsibility:
- runtime warmup
- payload prewarm
- deferred show pipeline
- background precompute scheduling

Rules:
- warmup policy changes belong here
- do not add hidden prewarm logic back into result appliers or panel event code

### Window Behavior

File:
- `WebUI/ui/mesh_viewer_windowing.js`

Responsibility:
- dragging
- resizing
- viewport clamping
- mouseup cleanup tied to window movement

### Math And Camera Utilities

File:
- `WebUI/ui/mesh_viewer_math.js`

Responsibility:
- arcball projection
- quaternion math
- camera pan / rotate helpers
- matrix math (`identity`, `perspective`, `lookAt`, `multiplyMat4`)

Rules:
- keep camera math and matrix helpers out of the panel
- if render-camera behavior changes, prefer updating this module first

### Texture Resolution And Caching

File:
- `WebUI/ui/mesh_viewer_textures.js`

Responsibility:
- texture URL resolution
- checkerboard fallback creation
- WebGL texture cache lookup and population

Rules:
- texture loading and cache policy belong here
- avoid duplicating texture bootstrap code in the render loop

### Colorbar GL Resources

File:
- `WebUI/ui/mesh_viewer_colorbar_gl.js`

Responsibility:
- colorbar gradient texture allocation
- color stop interpolation into RGBA texture data
- WebGL upload for colorbar textures

Rules:
- colorbar texture generation belongs here
- avoid duplicating gradient interpolation in the panel or render helpers

### Shader Program Setup

File:
- `WebUI/ui/mesh_viewer_program.js`

Responsibility:
- compile and link the WebGL program
- resolve attribute and uniform locations

Rules:
- shader source and program bootstrap should stay out of the panel
- render-loop changes should not require editing shader bootstrap code in the panel

### Frame Rendering

File:
- `WebUI/ui/mesh_viewer_rendering.js`

Responsibility:
- per-frame camera/view-state calculation
- per-handle draw dispatch
- render-loop helper logic that should stay outside the panel body

Rules:
- keep the main `renderFrame()` method thin
- per-handle draw policy should live here rather than being duplicated in the panel
- if render scheduling stays in the panel, frame math and handle draw details should not

### Runtime Loop And Meta UI

File:
- `WebUI/ui/mesh_viewer_runtime.js`

Responsibility:
- render-loop scheduling
- viewer meta text formatting and updates

Rules:
- runtime loop helpers belong here
- avoid rebuilding meta strings or animation-loop control directly in the panel

### Panel Shell And Static UI Wiring

File:
- `WebUI/ui/mesh_viewer_shell.js`

Responsibility:
- panel DOM shell creation
- static toolbar and colorbar control wiring
- initial WebGL context bootstrap entry

Rules:
- panel shell markup belongs here
- avoid rebuilding long HTML strings and static control wiring inside the panel class

### Object UI

File:
- `WebUI/ui/mesh_viewer_object_ui.js`

Responsibility:
- object list UI
- object filter counts
- colorbar target synchronization
- bulk visibility actions

Rules:
- object list DOM generation belongs here
- avoid duplicating object-row creation in the panel

### Editing, Picking, And BVH

File:
- `WebUI/ui/mesh_viewer_editing.js`

Responsibility:
- picking
- ray helpers
- interaction geometry preparation
- BVH construction and traversal
- drag editing helpers

### Edit Toolbar And Selection UI

File:
- `WebUI/ui/mesh_viewer_edit_ui.js`

Responsibility:
- edit toolbar wiring
- selection payload generation
- selection count / button state refresh
- vertex edit list rendering

Rules:
- edit toolbar DOM behavior belongs here
- avoid duplicating selection payload formatting in the panel

Rules:
- picking math and BVH traversal must stay outside the panel
- if a new edit mode is added, prefer extending this module

### Selection Overlay Rendering

File:
- `WebUI/ui/mesh_viewer_selection_render.js`

Responsibility:
- selected vertex overlay rendering
- selected edge overlay rendering
- selected face overlay rendering

Rules:
- selection overlay draw helpers should stay out of the main render loop body
- keep temporary selection-buffer rendering centralized here

## Practical Change Rules

When modifying Geometry Viewer behavior:

1. Find the owning module first.
2. Change the module instead of adding another local implementation in the panel.
3. Keep `mesh_viewer_panel.js` as a thin delegate when possible.
4. If a new concern appears more than once, create a module instead of copying logic.

## Anti-Patterns

Avoid these:
- adding a second implementation after `return moduleFn(this, ...)`
- mixing streaming policy with display policy in the same function
- rebuilding object UI from multiple files
- handling native lines and derived mesh edges through unrelated generic paths
- hand-wiring prewarm behavior from random callers

## Self-Test Expectations

Relevant tests:
- `scripts/webui_execution_selftest.mjs`

Important coverage areas:
- auxiliary LOD code does not eagerly build edge LODs
- line module schedules edge LODs only when needed
- object UI initialization stays in the object UI module
- editing module can build interaction geometry without panel-local duplicate logic
- `MeshViewerPanel` satisfies the delegate surface declared in `mesh_viewer_module_contracts.js`

If module boundaries change, update self-tests together with the code.
