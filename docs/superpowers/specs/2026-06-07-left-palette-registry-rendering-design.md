# Left Palette Registry Rendering Design

## Goal

Make the left component palette render from `src/services/componentRegistry.js` instead of the static `src/fragments/left-panel.html` markup.

## Scope

This stage changes only the palette presentation layer. Existing node creation, drag/drop handling, simulation behavior, fault injection behavior, and component defaults remain unchanged.

## Design

`LeftPalette.vue` imports `getPaletteGroups()` and renders the palette with Vue template loops. Rendered markup keeps the legacy runtime contract:

- Group headers keep `data-palette-group`.
- Group bodies keep `data-palette-body`.
- Draggable component items keep `.citem-draggable`, `draggable="true"`, and `data-component`.
- Line tools keep `.citem-line-tool`, `data-line-type`, and call `window.setConnectionTool(lineType)` on click.
- The simulation group keeps the existing “新增组件” authoring button.

The static `left-panel.html` fragment can remain in the repository during this stage, but `LeftPalette.vue` must not import it. This avoids breaking unrelated references while making the live app registry-driven.

## Testing

Update `tests/left-palette-taxonomy.spec.js` to mount `LeftPalette.vue` and inspect the rendered DOM. The test must verify group order, component placement, line tools, authoring action, and that `LeftPalette.vue` no longer imports `left-panel.html?raw`.

## Success Criteria

- Adding a normal component to `COMPONENT_REGISTRY` with an existing `group` makes it eligible for palette rendering without editing static HTML.
- Existing palette selectors used by legacy runtime remain present.
- Focused palette tests, signal routing tests, flight model app tests, and production build pass.
