# Subsystem Hierarchy Design

## Goal

Add Simulink-style hierarchical subsystems to the fault-platform workbench so a crowded top-level model can be split into nested child canvases without losing stable ports, stable wiring, save/load support, or simulation behavior.

The final result must support:

- creating a new `subsystem_block` from the left palette
- double-clicking that block to enter a nested child canvas
- navigating back to parent canvases through breadcrumbs
- showing the subsystem as a single block with stable input/output ports on the parent canvas
- modeling the subsystem interior with explicit boundary nodes
- saving and restoring hierarchical canvases in workbench snapshots and flight-model packages
- progressively adding a “wrap selection into subsystem” workflow after the base hierarchy is stable

## Current Platform Reality

The current workbench is fundamentally single-layer:

- `S.modelNodes` and `S.modelEdges` hold one flat graph
- `renderModelNodes()` and `renderPropertyPanel()` assume a single active canvas
- node selection is single-select only through `S.selBlk` and `S.selEdge`
- all import/export paths serialize one `modelNodes/modelEdges` pair
- simulation and signal propagation evaluate one flat graph

That means subsystem support cannot be implemented as a pure visual fold. It needs a real hierarchical graph model.

## Chosen Direction

Use a real layered canvas model with a dedicated `subsystem_block` node type plus explicit internal boundary nodes:

- `subsystem_block`
- `subsystem_in_port`
- `subsystem_out_port`

This keeps parent/child responsibilities clean:

- parent canvases only know the subsystem shell and its exposed interface
- child canvases contain the internal implementation and explicit boundary anchors

## Why This Direction

This is the most stable match for the existing platform:

- it does not overload `simulation_block` with container semantics
- it keeps Python-bound simulation blocks distinct from subsystem containers
- it gives save/load a clear recursive structure
- it gives simulation a deterministic parent-to-child signal mapping path
- it keeps future “wrap selection into subsystem” as a second-layer feature instead of making it a prerequisite

Rejected alternatives:

- **Reuse `simulation_block` as subsystem container**: mixes Python-function semantics with hierarchy-container semantics and will complicate binding/runtime logic.
- **Visual collapse only**: would keep one flat graph underneath and create fragile hidden-node behavior during routing, save/load, and simulation.
- **Auto-derived ports only**: too unstable for a first rollout; manual, explicit boundary ports are safer.

## Product Shape

The feature is introduced in two phases.

### Phase 1: Stable manual hierarchy

- add `subsystem_block` to the palette
- create an empty subsystem manually
- double-click to enter the subsystem canvas
- define parent-visible interface ports through the subsystem inspector
- inside the subsystem, connect `subsystem_in_port` / `subsystem_out_port` nodes to internal logic

### Phase 2: Encapsulation workflow

- add multi-select support
- add `封装为子系统`
- move selected nodes/edges into a newly created child canvas
- infer boundary ports from crossing edges
- generate internal boundary nodes automatically

Phase 2 depends on Phase 1 data structures. It should not block the initial rollout.

## Data Model

### New top-level workbench shape

The flat graph becomes a canvas registry:

```json
{
  "version": 2,
  "rootCanvasId": "canvas-root",
  "activeCanvasId": "canvas-root",
  "canvasTrail": ["canvas-root"],
  "canvases": {
    "canvas-root": {
      "id": "canvas-root",
      "name": "顶层",
      "parentSubsystemNodeId": null,
      "viewport": {
        "scale": 1,
        "offsetX": 0,
        "offsetY": 0
      },
      "nodes": [],
      "edges": []
    }
  }
}
```

### `subsystem_block`

Parent-canvas subsystem shell node:

```json
{
  "id": "node-12",
  "type": "subsystem_block",
  "canvasId": "canvas-root",
  "x": 420,
  "y": 220,
  "w": 210,
  "h": 108,
  "props": {
    "name": "姿态控制子系统",
    "targetCanvasId": "canvas-subsystem-12",
    "interface": {
      "inputs": [
        { "id": "in-1", "name": "姿态误差", "type": "标量", "order": 0 }
      ],
      "outputs": [
        { "id": "out-1", "name": "控制输出", "type": "标量", "order": 0 }
      ]
    }
  }
}
```

### Boundary nodes inside child canvas

```json
{
  "id": "node-in-1",
  "type": "subsystem_in_port",
  "canvasId": "canvas-subsystem-12",
  "props": {
    "interfacePortId": "in-1",
    "name": "姿态误差",
    "type": "标量"
  }
}
```

```json
{
  "id": "node-out-1",
  "type": "subsystem_out_port",
  "canvasId": "canvas-subsystem-12",
  "props": {
    "interfacePortId": "out-1",
    "name": "控制输出",
    "type": "标量"
  }
}
```

The child-canvas boundary nodes are explicit and durable. Parent ports never depend on hidden inference.

## Navigation

### Entry

- double-click `subsystem_block` to enter its `targetCanvasId`
- current canvas switches to the child canvas
- viewport, selection, and pending connection state reset for the new canvas only

### Exit

- breadcrumb path above the canvas, e.g. `顶层 / 飞控主控 / 姿态控制`
- click any breadcrumb segment to jump back to that canvas
- also provide a compact `返回上层` action for speed

### Scope of state

Each canvas owns:

- nodes
- edges
- viewport scale/offset
- selection context

Global workbench still owns:

- model package metadata
- imported fault libraries
- simulation mode and runtime caches

## Port and Wiring Semantics

### Parent side

`subsystem_block` exposes ports from `props.interface.inputs/outputs`.

These are rendered exactly like other node ports:

- inputs on the left
- outputs on the right
- stable order controlled by `order`

### Child side

Inside the subsystem:

- `subsystem_in_port` behaves like a source node with one output
- `subsystem_out_port` behaves like a sink node with one input

This gives a stable signal contract:

- parent input edge -> subsystem input value
- subsystem input value -> child `subsystem_in_port` output
- child graph propagates normally
- child `subsystem_out_port` input -> parent subsystem output value

No cross-canvas edge objects are stored. Cross-layer mapping happens through the subsystem interface contract.

## Encapsulation Flow

Phase 2 adds `封装为子系统`.

### Selection rules

- allow multi-select of nodes
- selected nodes must all belong to the same canvas
- selected edges are inferred from selected node membership

### Wrap algorithm

1. Create a new child canvas
2. Create a new `subsystem_block` in the parent canvas
3. Move selected nodes into the child canvas
4. Move fully internal edges into the child canvas
5. Detect crossing parent edges:
   - parent edge into selected set -> create subsystem input port + `subsystem_in_port`
   - parent edge out of selected set -> create subsystem output port + `subsystem_out_port`
6. Rewire parent edges to the subsystem shell
7. Rewire child edges to the generated boundary nodes

Initial port names may be auto-generated from source/target labels, but users can rename them manually afterward.

## Rendering and Inspector Behavior

### Parent canvas subsystem shell

The subsystem shell should visually read as a container:

- slightly larger card than a normal simulation block
- a small hierarchy marker such as `子系统`
- summary text like `3 输入 · 2 输出 · 8 内部模块`

### Subsystem inspector

Inspector must support:

- subsystem name
- child canvas name
- editable input port list
- editable output port list
- open / enter action

### Boundary-port inspector

`subsystem_in_port` and `subsystem_out_port` inside the child canvas should show:

- linked interface port id
- display name
- type
- owning parent subsystem

## Save / Load / Import / Export

### Workbench snapshots

`createWorkbenchSnapshot()` and `restoreWorkbenchSnapshot()` must be upgraded to understand:

- `rootCanvasId`
- `activeCanvasId`
- `canvasTrail`
- `canvases`

Backward compatibility:

- if an imported snapshot still contains only flat `modelNodes/modelEdges`, wrap it into `canvas-root`

### Flight-model packages

`workbenchSnapshot` inside model packages must support the same hierarchical structure. Existing packages remain importable through the legacy flat-graph compatibility path.

## Simulation Behavior

The first acceptable implementation must evaluate subsystems recursively.

### Required behavior

- evaluating a parent subsystem block pulls its input values from parent incoming edges
- those values are injected into the child canvas boundary nodes
- child graph evaluates using existing signal propagation logic
- values arriving at `subsystem_out_port` become the parent subsystem outputs

### Important constraint

The runtime must not silently flatten the graph for storage while pretending hierarchy only exists in UI. That would create long-term maintenance debt.

## Testing Strategy

### Unit tests

- snapshot compatibility: flat -> layered restore
- subsystem interface normalization
- subsystem wrap algorithm
- recursive subsystem evaluation
- package import/export with layered workbench snapshots

### App tests

- create subsystem from palette
- double-click enter child canvas
- breadcrumb return to parent
- parent-visible ports stay stable after save/load
- child boundary nodes carry parent interface mapping
- wrap selection into subsystem preserves wiring

## Risks

### Risk 1: Legacy runtime overrides are already large

Mitigation:

- keep hierarchy helpers grouped in a dedicated override section
- avoid broad refactors of unrelated node types in the same pass

### Risk 2: Port identity drift after rename or reorder

Mitigation:

- use stable `interfacePortId`
- treat display name as editable but not identity

### Risk 3: Phase 2 selection work bloats the first rollout

Mitigation:

- build Phase 1 and Phase 2 as separate implementation tasks with passing checkpoints between them

## Acceptance Criteria

The feature is acceptable when:

- a user can drag in a `子系统` block
- double-clicking enters a nested child canvas
- breadcrumbs return to parent canvases
- parent-visible subsystem ports remain stable after renaming, save/load, and re-import
- internal `subsystem_in_port` / `subsystem_out_port` nodes carry the boundary contract
- recursive simulation returns child outputs to the parent subsystem shell
- a saved hierarchical model can be exported and restored
- a later pass can wrap multiple selected nodes into a subsystem without redesigning the underlying data model
