# Oscilloscope Upgrade Design

## Goal

Upgrade the current oscilloscope experience so it behaves like a simple real instrument:

- each oscilloscope node supports two channels
- each oscilloscope opens in its own floating window on the canvas
- waveforms render sharply instead of looking blurry
- users can see live numeric readings, not just curves
- users can compare an input and output signal directly and verify that a simulation block scales the signal to half amplitude

## Current Problems

The current implementation has four structural issues:

1. It uses one global `activeScopeId` and one global `ov-scope` overlay, so opening a scope behaves like switching to a dedicated layer instead of opening an instrument window.
2. Canvas rendering uses CSS pixel sizes directly, which makes the plot soft on high-DPI displays.
3. Scope UI shows only waveform and spectrum panels, with no live per-channel values or amplitude summary.
4. The scope node is effectively single-channel, so users cannot wire one scope to both the pre-block and post-block signal for direct comparison.

## Recommended Solution

Implement a dual-channel oscilloscope system based on per-scope floating windows.

### Why this approach

This is the smallest change that actually satisfies the requested experience:

- it preserves the existing canvas-centric modeling workflow
- it enables side-by-side comparison across multiple scopes
- it lets one scope compare two related signals using `CH1` and `CH2`
- it avoids introducing a second workspace or dashboard concept that would compete with the modeling canvas

## User Experience

### Scope node behavior

The `instrument_scope` node will expose two input ports:

- `CH1`
- `CH2`

Users can connect:

- only `CH1`
- only `CH2`
- both channels

The node subtitle and inspector should reflect channel wiring state clearly, for example:

- `CH1 已连接 · CH2 未连接`
- `CH1 输入 · CH2 输出`

Double-clicking the scope node opens a scope window for that node. Re-opening the same scope should focus the existing window rather than create duplicates.

### Floating scope windows

Each scope window lives above the canvas and can be displayed next to other scope windows.

Each window supports:

- drag to reposition
- close
- focus on click
- independent channel display mode

The initial placement should stagger new windows so multiple scopes do not stack exactly on top of each other.

### Scope display modes

Each scope window supports three waveform modes:

- `CH1`
- `CH2`
- `叠加`

`叠加` renders both channels on the same axes using distinct colors.

This allows the key verification path:

- connect the simulation block input to `CH1`
- connect the simulation block output to `CH2`
- run simulation
- switch to `叠加`
- visually confirm that `CH2` amplitude is half of `CH1`

### Live readings

Each scope window should show compact numeric readouts for both channels.

Per channel, show:

- current value
- min
- max
- peak-to-peak

If a channel is not connected, show a clear inactive state instead of zeroing silently.

### Visual quality

The scope window should feel like an instrument panel rather than a full-screen modal.

Key visual direction:

- darker plotting area for contrast
- brighter waveform strokes
- fixed channel colors, e.g. `CH1` amber and `CH2` cyan
- compact header and control strip
- visible axes and grid
- readable labels and numeric values

The plotting surface must render at device pixel ratio to stay sharp.

## Technical Design

### State model changes

Replace the single-scope global assumption with per-window scope state.

Add state for:

- open scope windows keyed by scope node id
- per-window position
- per-window z-index ordering
- per-window display mode (`ch1`, `ch2`, `overlay`)

The old `SIM.activeScopeId` should no longer drive the UI as the single source of truth for visible scope content. It may be retained only if needed for compatibility during migration, but the new window registry should drive rendering behavior.

### Node and port model changes

Upgrade `instrument_scope` port definitions so the node has two input ports.

Port labels should be:

- `CH1`
- `CH2`

This affects:

- node geometry
- connection compatibility
- inspector summaries
- snapshot persistence
- scope sampling logic

### Sampling model

Scope sampling must store channel data separately.

Per scope node, runtime data should become:

- `ch1.actual`
- `ch1.reference`
- `ch2.actual`
- `ch2.reference`

or an equivalent structure that separates the channels explicitly.

The implementation should not infer channels from array order in a fragile way. Channel identity should remain explicit from wiring through rendering.

### Rendering model

Each scope window will own:

- one sharp time-domain canvas
- one compact summary/readout panel

The frequency panel is lower priority than waveform verification. It can remain only if it does not complicate readability. The primary emphasis should move to waveform comparison and live numeric measurement.

Recommended rendering changes:

- compute canvas backing resolution using `devicePixelRatio`
- scale the drawing context once after resizing
- draw cleaner grid lines
- draw channel legends inline in the window
- draw optional zero line
- render channel traces with thicker, higher-contrast lines

### Window management

Add a lightweight window manager inside the canvas layer.

Behavior:

- opening a scope creates or focuses a window
- dragging a window updates its stored position
- clicking a window brings it to front
- closing a window removes it from the open-window registry but keeps node data intact

This should be implemented inside the existing canvas/runtime layer rather than as a Vue router-level concept.

## Verification Flow

The upgraded UX must make the following scenario obvious:

1. Place a signal source.
2. Place a simulation block configured to scale the signal by `0.5`.
3. Place one scope node with two channels.
4. Connect signal source or pre-block signal to `CH1`.
5. Connect simulation block output to `CH2`.
6. Start the simulation.
7. Open the scope window.
8. Select `叠加`.
9. Confirm visually and numerically that `CH2` is half of `CH1`.

The window should make this obvious through both:

- overlayed traces
- numeric channel summary

## Testing Strategy

Add regression coverage for:

- scope node exposes two input ports
- double-clicking two scope nodes opens two independent scope windows
- re-opening the same scope focuses the existing window instead of duplicating it
- display mode toggles between `CH1`, `CH2`, and `叠加`
- channel readout panel shows live values when samples exist
- scope canvas resizes using device-pixel-ratio-aware sizing logic

## Out of Scope

These are not part of this upgrade:

- full oscilloscope trigger modes
- waveform cursor measurements
- persistent scope screenshots or exports
- arbitrary probe math beyond simple dual-channel overlay
- a full desktop windowing framework

## Implementation Notes

The current codebase still relies on `src/services/legacy-runtime.txt` as the runtime bridge, so the first implementation should stay consistent with that architecture instead of trying to migrate the scope system to an unrelated Vue-only design in the same pass.

The fragments under `src/fragments/dialogs/` contain older duplicated scope markup; if there is mismatch, the active source of truth should be updated so the rendered scope UI and runtime code stay aligned.
