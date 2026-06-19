# Signal Component Runtime Extraction Design

## Goal

Move the pure runtime behavior for signal adapter and signal utility components out of `src/services/legacy-runtime.txt` and into a focused service module.

## Scope

This stage covers only pure signal component behavior:

- `flow_block` normal pass-through output
- `gain_block` scalar multiplication
- `sum_block` signed multi-input sum
- `mux_block` vector packing

Python-bound `flow_block` execution, property-panel rendering, node drawing, edge routing, fault injection, instruments, and subsystem behavior remain in `legacy-runtime.txt` for now.

## Design

Create `src/services/signalComponentRuntime.js` with deterministic pure functions:

- `sanitizeSignalValue(value)`
- `parseSignalScalar(value, fallback)`
- `normalizeSignalUtilityNode(node)`
- `evaluateFlowBlockOutputs(inputValues)`
- `evaluateSignalUtilityOutputs(node, inputValues)`
- `isSignalUtilityType(type)`

`legacyRuntimeBootstrap.js` exposes the module on `window.__GZ_SIGNAL_COMPONENT_RUNTIME__` before evaluating `legacy-runtime.txt`. Legacy runtime keeps its existing function names and state wiring, but delegates `flow_block` pass-through and signal utility evaluation to the new service.

## Testing

Add unit tests for the new service before changing production code. Keep existing app-level regression tests for signal routing and flight model import.

## Success Criteria

- The new unit tests cover gain, sum, mux, flow pass-through, scalar parsing, and node normalization.
- Existing signal routing tests pass unchanged.
- `legacy-runtime.txt` no longer owns the math for `gain_block`, `sum_block`, and `mux_block`.
