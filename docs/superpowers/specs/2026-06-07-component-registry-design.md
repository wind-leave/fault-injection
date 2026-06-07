# Component Registry Design

## Goal

Refactor the component system so new left-panel components can be added from a central registry instead of editing scattered branches in `src/services/legacy-runtime.txt` and static palette HTML.

## Current State

The current component surface is split across several places:

- `src/fragments/left-panel.html` defines the visible left-side palette groups and component entries.
- `src/services/legacy-runtime.txt` defines `COMPONENT_LIBRARY`, creates nodes through `createNode(type, x, y)`, renders ports, renders property panels, saves properties, and computes runtime behavior.
- Component instances are stored in the active canvas node list through `S.modelNodes`, which maps to `S.canvases[S.activeCanvasId].nodes`.

This works for a small number of components, but adding many components becomes error-prone because each component needs matching palette, node metadata, property, port, and runtime changes.

## Design

Add a focused component registry module:

```text
src/services/componentRegistry.js
```

The registry has two top-level exports:

```js
export const COMPONENT_GROUPS = [
  {
    id: 'signals',
    label: '系统信号',
    icon: '信',
    tone: 'system',
    defaultOpen: true
  }
];

export const COMPONENT_REGISTRY = {
  signal_source: {
    type: 'signal_source',
    group: 'signals',
    label: '信号源',
    badge: 'S',
    className: 'b-source',
    width: 164,
    height: 84,
    defaults: {
      name: '信号源',
      waveType: '正弦',
      amplitude: '1.0',
      frequency: '1.0',
      outputFormat: '标量'
    }
  }
};
```

`COMPONENT_GROUPS` owns left-panel grouping order and group-level display metadata. `COMPONENT_REGISTRY` owns each component type's basic node metadata and the group it belongs to.

## Initial Groups

The registry should include the left-panel groups that already exist in the application:

- `signals`: 系统信号
- `signal-ops`: 信号运算
- `simulation`: 仿真组件
- `subsystem`: 子系统
- `faults`: 故障组件
- `instruments`: 测量仪器
- `can-lines`: 总线与连接

The `tone` field maps each group to existing visual styles:

- `system` maps to `lgroup-head--system`
- `fault` maps to `lgroup-head--fault`
- `instrument` maps to `lgroup-head--instrument`
- `link` maps to the connection-line group styling

## Initial Components

The first implementation should register the existing components only. No new component behavior is introduced in this phase.

Required initial components:

- `signal_source`
- `middle_var_assign`
- `flow_block`
- `gain_block`
- `sum_block`
- `mux_block`
- `simulation_block`
- `subsystem_block`
- `subsystem_in_port`
- `subsystem_out_port`
- `physical_fault_injector`
- `electrical_fault_injector`
- `protocol_fault_injector`
- `instrument_scope`
- `instrument_spectrum`
- `instrument_logger`
- `link_normal`
- `link_can`

Each registered component should preserve the existing `label`, `badge`, `className`, `width`, `height`, and `defaults` used by the current runtime.

## Compatibility Layer

Stage 1 should keep `legacy-runtime.txt` behavior stable by generating the existing `COMPONENT_LIBRARY` shape from the registry:

```js
export function buildComponentLibraryFromRegistry(registry = COMPONENT_REGISTRY) {
  return Object.fromEntries(
    Object.entries(registry).map(([type, component]) => [
      type,
      {
        label: component.label,
        badge: component.badge,
        className: component.className,
        width: component.width,
        height: component.height,
        defaults: component.defaults
      }
    ])
  );
}
```

Because `legacy-runtime.txt` is evaluated as raw text, the registry should be imported by `src/services/legacyRuntimeBootstrap.js` and exposed before runtime evaluation:

```js
window.__GZ_COMPONENT_GROUPS__ = COMPONENT_GROUPS;
window.__GZ_COMPONENT_REGISTRY__ = COMPONENT_REGISTRY;
window.__GZ_COMPONENT_LIBRARY__ = buildComponentLibraryFromRegistry(COMPONENT_REGISTRY);
```

Then `legacy-runtime.txt` can use:

```js
const COMPONENT_LIBRARY = window.__GZ_COMPONENT_LIBRARY__ || {
  // legacy fallback
};
```

The fallback prevents standalone runtime evaluation from breaking if the bootstrap injection is unavailable.

## Phased Migration

### Stage 1: Registry And Compatibility

Create `componentRegistry.js`, expose registry globals in `legacyRuntimeBootstrap.js`, and wire `COMPONENT_LIBRARY` to use the injected library. Preserve all current behavior and keep legacy overrides in place.

### Stage 2: Palette Rendering

Replace the static component entries in `src/fragments/left-panel.html` with Vue-rendered groups generated from `getPaletteGroups(COMPONENT_GROUPS, COMPONENT_REGISTRY)`. Keep existing class names and `data-component` attributes.

### Stage 3: Port Registration

Allow a component to provide a `ports(node)` function. Runtime port lookup should first check the registry and then fall back to existing hard-coded logic.

### Stage 4: Inspector Registration

Allow a component to declare `inspector.kind`. Keep current property panel renderers, but dispatch through the registry instead of broad type conditionals.

### Stage 5: Runtime Behavior Registration

Allow simple components to declare `runtime.kind` or `runtime.compute`. Existing complex simulation and Python-bound block behavior should remain in the current runtime until it can be isolated safely.

## Testing

Stage 1 should add tests that prove:

- The registry builds a `COMPONENT_LIBRARY` entry compatible with the legacy runtime.
- Existing component labels and defaults are preserved.
- The runtime exposes the injected component globals after mounting.
- Existing signal routing and model package import tests still pass.

Recommended checks:

```powershell
npm.cmd test -- --run tests\component-registry.spec.js
npm.cmd test -- --run tests\signal-routing-app.spec.js
npm.cmd test -- --run tests\flight-model-package-app.spec.js
npm.cmd run build
```

## Non-Goals

Stage 1 does not add new components, change simulation behavior, change property panel behavior, or remove existing legacy runtime fallbacks.

## Success Criteria

The registry exists, all current components can be represented by it, the legacy runtime still receives the same `COMPONENT_LIBRARY` shape, and the application behavior remains unchanged after tests and production build.
