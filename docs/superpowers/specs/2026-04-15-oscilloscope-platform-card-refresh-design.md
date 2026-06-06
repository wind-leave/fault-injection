# Oscilloscope Platform Card Refresh Design

## Goal

Refresh the oscilloscope and Python-binding node visuals so they look native to the platform's existing light theme while preserving the recently added dual-channel scope behavior.

This upgrade must:

- replace the dark oscilloscope popup with a light "platform card" panel
- keep independent draggable scope windows on the canvas
- preserve `CH1`, `CH2`, and `overlay` waveform modes
- make waveform comparison easier when verifying that a simulation block halves signal amplitude
- declutter Python-binding node ports by shrinking the port markers and hiding long labels until hover

## Current Problems

The current scope functionality works, but its presentation is inconsistent with the rest of the modeling workspace.

### Visual mismatch

- The canvas, side panels, and node cards use a light blue-white theme.
- The oscilloscope window still uses a dark navy palette, so it looks like an embedded foreign widget rather than a native platform panel.

### Layout imbalance

- The scope toolbar uses deep filled pill buttons that do not match the platform's button language.
- The waveform area is visually compressed by the current two-card readout section.
- The header repeats connection state in both the meta line and the statistics area, making the information feel dense instead of precise.

### Node port clutter

- Python-binding nodes render every long port label directly on the card.
- For nodes with multiple inputs and outputs, the visible labels crowd the card and compete with the node title and subtype.

## Chosen Direction

Use the `A. Platform Card` direction that was approved during visual comparison.

### Why this direction

- It aligns the oscilloscope with the existing application theme instead of introducing a second visual system.
- It keeps the oscilloscope readable as a work panel rather than a full-screen diagnostic console.
- It solves the clutter problem with layout and hierarchy changes rather than by removing capabilities.

Alternative directions such as "light instrument" styling or a color-only patch were rejected because they either keep too much visual weight or fail to solve the layout issues.

## User Experience

### Scope window visual language

Each scope window remains an independent floating panel above the canvas, but its styling changes to a light card:

- panel background: `#ffffff`
- title strip / toolbar background: `#f0f5fb`
- plot background: `#f9fbfe`
- outer border: `#d6e4f0`
- primary text: `#1e3a5f`
- secondary text: `#7a9ab8`

The panel should read as part of the same family as the canvas-side cards, dialogs, and inspectors.

### Scope header

The header is reorganized into two functional zones.

Left side:

- scope title, for example `示波器 1`
- compact connection tags for `CH1` and `CH2`
- each tag shows the bound signal name when connected
- each tag shows `未连接` only inside the tag itself

Right side:

- display mode buttons: `叠加`, `CH1`, `CH2`
- a visually separated `关闭 ×` button

The header should not repeat the same connection state in a second sentence below the title.

### Scope waveform area

The waveform panel becomes the dominant area of the card.

- Its height should increase relative to the current layout.
- The grid should use subtle light-blue lines instead of dark instrument lines.
- A center line should remain visible for waveform reference.
- Empty state text should read: `连接 CH1 或 CH2 后开始仿真`

Channel colors are fixed:

- `CH1`: `#1d6fbf`
- `CH2`: `#16a34a`
- fault highlight: `#dc2626` with a translucent red fill band when fault-region emphasis is present

### Scope statistics area

The statistics section moves to a compact horizontal strip layout at the bottom of the panel.

There are always two rows:

- one row for `CH1`
- one row for `CH2`

Each row displays:

- current
- min
- max
- peak-to-peak

Formatting rules:

- labels use muted secondary text
- values use `JetBrains Mono`
- connected channel values use the channel's primary color or a strong platform blue
- disconnected channels display `--`

This layout removes the oversized card treatment and gives more room back to the waveform.

### Scope interaction rules

The refresh must preserve the interaction behavior delivered in the previous upgrade:

- each scope node opens its own floating window
- windows can be dragged independently
- windows can be closed independently
- clicking a window brings it to the front
- multiple scope windows can remain open side-by-side on the canvas

This refresh is visual and structural, not a rollback of the recent window-manager behavior.

## Node Port Refresh

### Port marker size and appearance

Python-binding node ports should become visually lighter:

- diameter: `6px` visual marker
- use a light fill derived from the port color
- keep a darker stroke so the port remains discoverable against pale cards

The visible marker is `6px`, but the clickable wrapper remains at the current larger hit target so drag-to-connect usability does not regress.

### Port labels

Long port labels should no longer be permanently rendered next to the node.

Instead:

- the node keeps the existing tooltip behavior through the `title` attribute
- visible inline labels are removed for Python-binding ports
- non-Python ports may keep their current behavior unless the implementation is simpler and safer by unifying the label policy

The goal is to make nodes such as `pid_controller.py` readable at a glance without losing port discoverability.

## Technical Design

### Runtime markup updates

The active scope markup in `src/services/legacy-runtime.txt` remains the source of truth for the scope floating window.

The scope window markup must be updated to support:

- a light header container
- channel connection tags
- the reordered mode buttons
- a compact two-row statistics strip

The implementation must not reintroduce the previous bug where clicking or focusing the window causes the close button to be replaced before the click lands.

### Style updates

The primary scope styles live in `src/styles/dialogs.css`.

These styles must be updated instead of adding a parallel competing style block elsewhere.

Expected changes:

- replace dark gradients with light card styling
- convert toolbar buttons to thin outlined platform-style controls
- rebalance spacing so the plot area grows and the statistics area shrinks
- define consistent colors for channel tags, traces, and readouts

Node port appearance continues to live in `src/styles/components.css` and the runtime-injected styles inside `src/services/legacy-runtime.txt`. Both locations must stay consistent.

### Node rendering updates

The active node renderer in `src/services/legacy-runtime.txt` currently uses `appendPortLabel(portEl, port)` to add visible labels beside each port.

For Python-binding nodes:

- keep tooltip text generation through `getPortTooltip`
- skip inline label insertion

For port visuals:

- shrink the rendered marker
- keep a larger clickable area if required for drag-connect usability
- ensure connected and active states still remain visible

### Compatibility constraints

This refresh must not change:

- the two-input scope node model
- channel sampling structure
- waveform display modes
- connection validation rules
- existing Python binding port metadata semantics

The work should stay within the current legacy-runtime architecture rather than attempting a broader Vue refactor.

## Verification Scenario

The refreshed scope should make the "amplitude halved by simulation block" case obvious.

1. Place a source signal.
2. Place a simulation block that scales output to `0.5`.
3. Connect the pre-block signal to scope `CH1`.
4. Connect the post-block signal to scope `CH2`.
5. Start simulation.
6. Open the scope window.
7. Keep the scope in `叠加` mode.
8. Compare the waveform heights and the two statistics rows.
9. Confirm that the displayed `CH2` peak-to-peak value is close to `0.5 * CH1`, within normal display rounding.

The user should be able to confirm this without switching pages or mentally reconciling a dark popup against a light canvas.

## Testing Strategy

Add or update regression coverage for:

- scope window renders the light-theme structure and mode buttons in the new order
- scope readouts render as compact per-channel strips instead of two oversized cards
- scope drag and close interactions still work after the markup change
- scope mode switching still works for `叠加`, `CH1`, and `CH2`
- waveform canvas remains device-pixel-ratio aware
- Python-binding nodes do not render inline port labels
- Python-binding ports still expose tooltip text and remain connectable

Manual verification should also check:

- multiple scope windows can be opened and visually compared side by side
- the new light theme looks consistent with the rest of the page
- reduced-size ports remain usable for wiring with a mouse

## Out of Scope

This refresh does not include:

- adding new oscilloscope measurement tools such as cursors or triggers
- changing the sampling math or simulation timing
- redesigning the entire node card component system
- introducing a custom tooltip framework just for port labels
- changing non-scope dialogs to the new layout in the same pass
