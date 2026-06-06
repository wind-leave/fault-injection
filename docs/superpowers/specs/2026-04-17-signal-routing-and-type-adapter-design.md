# Signal Routing And Type Adapter Design

## Goal

Upgrade the workbench from single-output-single-connection behavior to a routing model closer to Simulink while keeping signal semantics stable for Python-bound simulation.

The final direction must support:

- one output port driving multiple downstream inputs
- scopes, loggers, and multiple downstream blocks observing the same source signal without workarounds
- one input port continuing to accept only one upstream signal by default
- explicit signal-composition blocks when multiple signals need to be merged
- stable type and shape checking before signals enter `simulation_block`
- a clear retained role for `flow_block` so it solves type consistency instead of remaining a vague placeholder

## Current Platform Reality

The current workbench wiring behavior is stricter than a usable modeling platform:

- `handlePortClick()` rejects any second connection into the same input port
- output ports are also effectively treated as one logical path in user expectations because the interaction does not emphasize branching
- scopes, loggers, and parallel observers become awkward because users expect one signal to be reusable
- type checking exists, but the role boundaries between `flow_block` and `simulation_block` are still blurry
- `flow_block` currently reads like a general-purpose process box rather than a dedicated signal adaptation stage

This makes simple control diagrams harder to express and encourages overloading `simulation_block` with responsibilities that should be explicit in the graph.

## Chosen Direction

Adopt a two-rule routing model:

1. **Output ports allow one-to-many branching**
2. **Input ports remain one-to-one unless a dedicated composition block is used**

At the same time, redefine `flow_block` as a **signal adapter block** instead of a generic process block.

This gives the platform a stable signal model:

- branching is cheap and natural
- merging is explicit and readable
- type normalization happens before Python execution
- `simulation_block` remains the place for algorithm logic, not input cleanup

## Why This Direction

This is the best balance between modeling flexibility and execution determinism.

### Accepted behavior

- one sensor output can feed a controller, a scope, and a logger
- one subsystem output can fan out to multiple consumers
- a scope can observe an already-used signal without forcing an extra helper node

### Rejected behavior

- allowing multiple upstream outputs into a single input port by default

That rejected behavior is too ambiguous:

- should signals be summed?
- should latest value win?
- should values be packed into a vector?
- should one source override another?

If the graph does not make that rule explicit, simulation semantics become unreliable and fault propagation becomes harder to interpret.

## Routing Semantics

### Rule 1: Output branching is allowed

A single output port may connect to multiple downstream input ports.

Examples:

- signal source -> scope
- signal source -> simulation block input 1
- signal source -> logger

All three edges are valid and carry the same upstream signal.

### Rule 2: Input ports remain single-source

An input port may accept only one upstream edge unless the destination block type explicitly declares different behavior.

This stays true for:

- `flow_block`
- `simulation_block`
- `instrument_scope`
- `instrument_logger`
- `instrument_spectrum`
- `subsystem_in_port`

### Rule 3: Signal merging must be explicit

If users want to combine multiple signals, they must insert a dedicated block.

First-stage supported composition blocks:

- `sum_block`
- `mux_block`
- `gain_block`

Second-stage candidates:

- `demux_block`
- `merge_block`
- `switch_block`
- `bus_creator`
- `bus_selector`

## `flow_block` Redefinition

`flow_block` is retained, but its purpose is narrowed and clarified.

It becomes a **signal adapter block**.

### Responsibilities

- cast or normalize scalar data types before Python execution
- adapt shape metadata such as scalar vs vector
- prepare a signal for a `simulation_block` contract
- express explicit interface cleanup in the model graph

### Non-responsibilities

- major control-law logic
- plant dynamics
- arbitrary algorithm scripting
- implicit multi-signal merging

That work belongs in:

- `simulation_block` for algorithm logic
- `sum_block` / `mux_block` for signal composition

### UI wording

Internal type may remain `flow_block` for compatibility, but palette and property copy should move toward:

- `信号适配块`
- or `适配块`

This avoids breaking existing snapshots and model packages while improving user understanding.

## Type Contract Model

Every connectable port should move toward a richer contract.

### Proposed port metadata

```json
{
  "domain": "numeric",
  "shape": "scalar",
  "dtype": "float",
  "dims": [1]
}
```

### Meaning

- `domain`: `numeric | boolean | event | bus`
- `shape`: `scalar | vector | matrix`
- `dtype`: `float | int | bool`
- `dims`: concrete shape information such as `[1]`, `[3]`, `[3, 3]`

### Connection behavior

- exact match: connect directly
- safely adaptable: allow but recommend or auto-insert `flow_block` in a future phase
- incompatible: reject connection and explain why

The first phase does not need full auto-conversion. It only needs:

- metadata preservation
- clearer compatibility checks
- better user-facing messages

## New Minimal Block Set

The first meaningful extension beyond routing is a very small set of explicit signal utility blocks.

### `gain_block`

Purpose:

- apply scalar multiplication to one signal

Why first:

- validates the branch model quickly
- gives users an immediate way to compare pre/post scaling in scopes

### `sum_block`

Purpose:

- sum multiple explicit inputs into one output

Why first:

- replaces the temptation to connect multiple edges into one input port
- keeps merge semantics legible

### `mux_block`

Purpose:

- pack multiple scalar signals into one vector-like output

Why first:

- supports Python functions that expect grouped inputs
- complements the `flow_block` type-normalization role

## Data Model Impact

### Edge model

No major schema change is required for one-to-many branching.

The current edge structure already supports it:

```json
{
  "id": "edge-10",
  "lineType": "normal",
  "sourceNodeId": "node-1",
  "targetNodeId": "node-8",
  "sourcePortIndex": 0,
  "targetPortIndex": 0
}
```

The change is in validation rules:

- keep duplicate-edge protection for exact same source/target port tuple
- remove the assumption that one source output should only feed one edge
- keep occupied-target protection for block types that declare single-source inputs

### Port metadata

Port metadata must remain preserved on edges for diagnostics and import/export stability.

That includes:

- source port name
- target port name
- source port type metadata
- target port type metadata

## Interaction Model

### First-phase user flow

1. User clicks an output port
2. Pending connection starts from that output
3. User clicks any compatible input port
4. Edge is created even if the same output already feeds other targets

### Still forbidden

- exact duplicate edge
- second upstream edge into a single-source input
- incompatible type connection

### Future interaction enhancement

Simulink-style branch creation from an existing edge can be added later.

That should be a second-phase UX enhancement, not part of the first semantic upgrade.

The important first step is that repeating the same source-output action must already create multiple legal downstream edges.

## Runtime Impact

### Evaluation model

One-to-many branching does not change signal evaluation complexity significantly.

Current graph evaluation already resolves node outputs by edge traversal. Multiple consumers can safely read the same resolved upstream output.

### Multi-input composition

`sum_block` and `mux_block` introduce explicit evaluation behavior:

- `sum_block`: accumulate all declared inputs
- `mux_block`: return ordered grouped values

These blocks must define their own contracts clearly so `simulation_block` does not need to infer merge behavior.

## Import / Export / Model Packages

No package format break is required for routing branching.

What must change:

- exported models must preserve multiple edges from the same source port
- import validation must allow those structures
- type metadata on edges should survive round-trip export/import

For `flow_block`, existing snapshots remain valid because the internal type name does not change.

## Testing Strategy

### Routing tests

- one output connects to two different input ports successfully
- one output connects to two different scopes successfully
- exact duplicate edge is still rejected
- second upstream edge into the same single-source input is still rejected

### Type tests

- compatible `flow_block -> simulation_block` connection succeeds
- incompatible port contract is rejected with a clear message

### Block tests

- `gain_block` scales one signal deterministically
- `sum_block` adds multiple inputs deterministically
- `mux_block` preserves input ordering

### Package tests

- branching graph exports and imports without topology loss

## First-Phase Scope

This design is intentionally staged.

### Included now

- output one-to-many branching
- input one-to-one policy retained
- `flow_block` formally redefined as signal adapter
- improved type-compatibility messaging
- minimal utility blocks: `gain_block`, `sum_block`, `mux_block`

### Not included yet

- auto-insert adapter blocks
- branch creation by dragging from an existing edge
- bus creator / selector system
- polymorphic multi-source destination inputs

## Acceptance Criteria

The first phase is successful when:

- a single source output can feed multiple downstream inputs
- a single source output can feed multiple scopes or loggers
- the same input port still rejects a second upstream edge
- users can express signal merge explicitly through `sum_block` or `mux_block`
- `flow_block` is presented and documented as a signal adaptation stage
- branching topologies survive save/load and package import/export
- runtime evaluation remains stable for both flat and hierarchical canvases
