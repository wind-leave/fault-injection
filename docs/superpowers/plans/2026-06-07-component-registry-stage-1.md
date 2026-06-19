# Component Registry Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a central component registry and inject a legacy-compatible `COMPONENT_LIBRARY` into the existing runtime without changing current palette, property panel, port, or simulation behavior.

**Architecture:** Create a new ESM registry module that owns component groups and component metadata. `legacyRuntimeBootstrap.js` imports that registry and exposes it on `window` before evaluating `legacy-runtime.txt`. The raw legacy runtime keeps its existing fallback object and later overrides, but prefers the injected library when available.

**Tech Stack:** Vue 3, Vite raw text runtime loading, Vitest, existing legacy browser runtime in `src/services/legacy-runtime.txt`.

---

## File Structure

- Create: `src/services/componentRegistry.js`
  - Owns `COMPONENT_GROUPS`, `COMPONENT_REGISTRY`, `buildComponentLibraryFromRegistry()`, and `getPaletteGroups()`.
- Create: `tests/component-registry.spec.js`
  - Unit tests for registry shape, legacy library conversion, and palette grouping.
- Modify: `src/services/legacyRuntimeBootstrap.js`
  - Imports registry helpers and exposes `window.__GZ_COMPONENT_GROUPS__`, `window.__GZ_COMPONENT_REGISTRY__`, and `window.__GZ_COMPONENT_LIBRARY__` before `window.eval(runtimeSource)`.
- Modify: `src/services/legacy-runtime.txt`
  - Changes the initial `COMPONENT_LIBRARY` declaration to prefer `window.__GZ_COMPONENT_LIBRARY__` with the current object as fallback.
- Modify: `tests/flight-model-package-app.spec.js`
  - Adds one app integration test proving the runtime globals are visible after mount and still compatible with imported model package behavior.

---

### Task 1: Registry Unit Tests

**Files:**
- Create: `tests/component-registry.spec.js`

- [ ] **Step 1: Write the failing registry test**

Create `tests/component-registry.spec.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_GROUPS,
  COMPONENT_REGISTRY,
  buildComponentLibraryFromRegistry,
  getPaletteGroups
} from '../src/services/componentRegistry.js';

describe('component registry', () => {
  it('defines the existing left palette groups in display order', () => {
    expect(COMPONENT_GROUPS.map((group) => group.id)).toEqual([
      'signals',
      'signal-ops',
      'simulation',
      'subsystem',
      'faults',
      'instruments',
      'can-lines'
    ]);
    expect(COMPONENT_GROUPS.find((group) => group.id === 'faults')).toMatchObject({
      label: '故障组件',
      tone: 'fault',
      defaultOpen: true
    });
  });

  it('registers the existing draggable component types', () => {
    expect(Object.keys(COMPONENT_REGISTRY).sort()).toEqual([
      'electrical_fault_injector',
      'flow_block',
      'gain_block',
      'instrument_logger',
      'instrument_scope',
      'instrument_spectrum',
      'link_can',
      'link_normal',
      'middle_var_assign',
      'mux_block',
      'physical_fault_injector',
      'protocol_fault_injector',
      'signal_source',
      'simulation_block',
      'subsystem_block',
      'subsystem_in_port',
      'subsystem_out_port',
      'sum_block'
    ]);
  });

  it('builds legacy component library entries from registered components', () => {
    const library = buildComponentLibraryFromRegistry();

    expect(library.signal_source).toMatchObject({
      label: '信号源',
      badge: '信号',
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
    });

    expect(library.flow_block).toMatchObject({
      label: '信号适配块',
      badge: '适配',
      className: 'b-flow',
      defaults: {
        name: '信号适配块',
        inputName: '输入信号',
        outputName: '输出信号'
      }
    });

    expect(library.physical_fault_injector).toMatchObject({
      label: '物理层注入',
      badge: '故障',
      className: 'b-fault',
      width: 196,
      height: 96
    });
  });

  it('groups palette components by registry group without mutating registry entries', () => {
    const paletteGroups = getPaletteGroups();
    const signalOps = paletteGroups.find((group) => group.id === 'signal-ops');
    const faults = paletteGroups.find((group) => group.id === 'faults');
    const canLines = paletteGroups.find((group) => group.id === 'can-lines');

    expect(signalOps.components.map((item) => item.type)).toEqual([
      'flow_block',
      'gain_block',
      'sum_block',
      'mux_block'
    ]);
    expect(faults.components.map((item) => item.type)).toEqual([
      'physical_fault_injector',
      'electrical_fault_injector',
      'protocol_fault_injector'
    ]);
    expect(canLines.components.map((item) => item.type)).toEqual([
      'link_normal',
      'link_can'
    ]);
    expect(signalOps.components[0]).not.toBe(COMPONENT_REGISTRY.flow_block);
  });
});
```

- [ ] **Step 2: Run the failing unit test**

Run:

```powershell
npm.cmd test -- --run tests\component-registry.spec.js
```

Expected: FAIL because `src/services/componentRegistry.js` does not exist.

---

### Task 2: Component Registry Module

**Files:**
- Create: `src/services/componentRegistry.js`
- Test: `tests/component-registry.spec.js`

- [ ] **Step 1: Implement the registry module**

Create `src/services/componentRegistry.js`:

```js
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export const COMPONENT_GROUPS = [
  { id: 'signals', label: '系统信号', icon: '信', tone: 'system', defaultOpen: true },
  { id: 'signal-ops', label: '信号运算', icon: '算', tone: 'system', defaultOpen: true },
  { id: 'simulation', label: '仿真组件', icon: '仿', tone: 'system', defaultOpen: true },
  { id: 'subsystem', label: '子系统', icon: '子', tone: 'system', defaultOpen: true },
  { id: 'faults', label: '故障组件', icon: '故', tone: 'fault', defaultOpen: true },
  { id: 'instruments', label: '测量仪器', icon: '测', tone: 'instrument', defaultOpen: true },
  { id: 'can-lines', label: '总线与连接', icon: '线', tone: 'link', defaultOpen: true }
];

export const COMPONENT_REGISTRY = {
  signal_source: {
    type: 'signal_source',
    group: 'signals',
    label: '信号源',
    badge: '信号',
    className: 'b-source',
    width: 164,
    height: 84,
    defaults: { name: '信号源', waveType: '正弦', amplitude: '1.0', frequency: '1.0', outputFormat: '标量' }
  },
  middle_var_assign: {
    type: 'middle_var_assign',
    group: 'signals',
    label: '中间变量赋值块',
    badge: '赋值',
    className: 'b-assign',
    width: 176,
    height: 82,
    defaults: { name: '中间变量赋值块', targetNodeId: '', targetVarName: '', assignMode: 'constant', constantValue: '0' }
  },
  flow_block: {
    type: 'flow_block',
    group: 'signal-ops',
    label: '信号适配块',
    badge: '适配',
    className: 'b-flow',
    width: 168,
    height: 88,
    title: '统一输入输出的数据类型和格式',
    defaults: { name: '信号适配块', inputName: '输入信号', inputFormat: '标量', outputName: '输出信号', outputFormat: '标量' }
  },
  gain_block: {
    type: 'gain_block',
    group: 'signal-ops',
    label: '增益块',
    badge: '增益',
    className: 'b-gain',
    width: 156,
    height: 84,
    defaults: { name: '增益块', gain: '1.0', inputFormat: '标量', outputFormat: '标量' }
  },
  sum_block: {
    type: 'sum_block',
    group: 'signal-ops',
    label: '求和块',
    badge: '求和',
    className: 'b-sum',
    width: 164,
    height: 88,
    defaults: { name: '求和块', inputCount: 2, signs: ['+', '+'], outputFormat: '标量' }
  },
  mux_block: {
    type: 'mux_block',
    group: 'signal-ops',
    label: 'Mux 块',
    badge: 'Mux',
    className: 'b-mux',
    width: 164,
    height: 88,
    defaults: { name: 'Mux 块', inputCount: 2, outputFormat: '向量' }
  },
  simulation_block: {
    type: 'simulation_block',
    group: 'simulation',
    label: '仿真块',
    badge: '仿真',
    className: 'b-sim',
    width: 174,
    height: 92,
    defaults: {
      name: '仿真块',
      moduleType: '一阶函数',
      inputs: [{ name: '输入 1', type: '标量' }],
      outputs: [{ name: '输出 1', type: '标量' }],
      middleVars: [{ name: '中间量 1', type: '标量' }],
      ffunctionNote: '当前预留 Python 函数接口，可在后续导入函数定义。'
    }
  },
  subsystem_block: {
    type: 'subsystem_block',
    group: 'subsystem',
    label: '子系统块',
    badge: '子系统',
    className: 'b-subsystem',
    width: 180,
    height: 92,
    defaults: { name: '子系统块', description: '', targetCanvasId: '' }
  },
  subsystem_in_port: {
    type: 'subsystem_in_port',
    group: 'subsystem',
    label: '子系统输入口',
    badge: 'IN',
    className: 'b-subsystem-port-in',
    width: 132,
    height: 72,
    defaults: { name: '子系统输入口' }
  },
  subsystem_out_port: {
    type: 'subsystem_out_port',
    group: 'subsystem',
    label: '子系统输出口',
    badge: 'OUT',
    className: 'b-subsystem-port-out',
    width: 132,
    height: 72,
    defaults: { name: '子系统输出口' }
  },
  physical_fault_injector: {
    type: 'physical_fault_injector',
    group: 'faults',
    label: '物理层注入',
    badge: '故障',
    className: 'b-fault',
    width: 196,
    height: 96,
    defaults: { name: '物理层注入', faultType: '物理参数故障', layer: '物理层', layerKey: 'physical' }
  },
  electrical_fault_injector: {
    type: 'electrical_fault_injector',
    group: 'faults',
    label: '电气层注入',
    badge: '故障',
    className: 'b-fault',
    width: 196,
    height: 96,
    defaults: { name: '电气层注入', faultType: '电气信号故障', layer: '电气层', layerKey: 'electrical' }
  },
  protocol_fault_injector: {
    type: 'protocol_fault_injector',
    group: 'faults',
    label: '协议层注入',
    badge: '故障',
    className: 'b-fault',
    width: 196,
    height: 96,
    defaults: { name: '协议层注入', faultType: '数字协议故障', layer: '协议层', layerKey: 'protocol' }
  },
  instrument_scope: {
    type: 'instrument_scope',
    group: 'instruments',
    label: '示波器',
    badge: '仪器',
    className: 'b-inst',
    width: 150,
    height: 74,
    defaults: { name: '示波器', instrumentType: '波形监测', sampleRate: '64kHz', signal: '流程块输出' }
  },
  instrument_spectrum: {
    type: 'instrument_spectrum',
    group: 'instruments',
    label: '频谱分析仪',
    badge: '仪器',
    className: 'b-inst',
    width: 158,
    height: 74,
    defaults: { name: '频谱分析仪', instrumentType: '频谱分析', sampleRate: '32kHz', signal: '仿真块输出' }
  },
  instrument_logger: {
    type: 'instrument_logger',
    group: 'instruments',
    label: '数据记录仪',
    badge: '仪器',
    className: 'b-inst',
    width: 158,
    height: 74,
    defaults: { name: '数据记录仪', instrumentType: '数据记录', sampleRate: '10Hz', signal: '系统总线' }
  },
  link_normal: {
    type: 'link_normal',
    group: 'can-lines',
    paletteKind: 'line-tool',
    lineType: 'normal',
    label: '普通连接线',
    badge: '连接',
    className: 'b-link',
    width: 154,
    height: 64,
    defaults: { name: '普通连接线', linkType: '普通连接线', sourcePort: '源端口', targetPort: '目标端口' }
  },
  link_can: {
    type: 'link_can',
    group: 'can-lines',
    paletteKind: 'line-tool',
    lineType: 'can',
    label: 'CAN 总线',
    badge: '连接',
    className: 'b-link',
    width: 154,
    height: 64,
    defaults: { name: 'CAN 总线', linkType: 'CAN 总线', sourcePort: '节点 A', targetPort: '节点 B' }
  }
};

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
        defaults: clone(component.defaults)
      }
    ])
  );
}

export function getPaletteGroups(groups = COMPONENT_GROUPS, registry = COMPONENT_REGISTRY) {
  const components = Object.values(registry);
  return groups.map((group) => ({
    ...group,
    components: components
      .filter((component) => component.group === group.id)
      .map((component) => ({ ...component, defaults: clone(component.defaults) }))
  }));
}
```

Register `link_normal` and `link_can` with `paletteKind: 'line-tool'` so Stage 2 can distinguish connection tools from draggable node components. Stage 1 still leaves the static line-tool HTML unchanged.

- [ ] **Step 2: Run registry unit test**

Run:

```powershell
npm.cmd test -- --run tests\component-registry.spec.js
```

Expected: PASS.

- [ ] **Step 3: Commit registry module and tests**

Run:

```powershell
git add src\services\componentRegistry.js tests\component-registry.spec.js
git commit -m "Add component registry module"
```

---

### Task 3: Bootstrap Injection

**Files:**
- Modify: `src/services/legacyRuntimeBootstrap.js`
- Test: `tests/flight-model-package-app.spec.js`

- [ ] **Step 1: Write failing app integration test**

In `tests/flight-model-package-app.spec.js`, add this test after the existing import/export bridge test:

```js
  it('exposes the component registry globals before evaluating the legacy runtime', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(window.__GZ_COMPONENT_GROUPS__.map((group) => group.id)).toContain('signal-ops');
    expect(window.__GZ_COMPONENT_REGISTRY__.flow_block).toMatchObject({
      type: 'flow_block',
      group: 'signal-ops',
      label: '信号适配块'
    });
    expect(window.__GZ_COMPONENT_LIBRARY__.flow_block).toMatchObject({
      label: '信号适配块',
      badge: '适配',
      className: 'b-flow'
    });

    wrapper.unmount();
  });
```

- [ ] **Step 2: Run focused failing test**

Run:

```powershell
npm.cmd test -- --run tests\flight-model-package-app.spec.js -t "component registry globals"
```

Expected: FAIL because the bootstrap does not expose the component registry globals yet.

- [ ] **Step 3: Import registry helpers in bootstrap**

Modify the top of `src/services/legacyRuntimeBootstrap.js`:

```js
import runtimeSource from './legacy-runtime.txt?raw';
import {
  COMPONENT_GROUPS,
  COMPONENT_REGISTRY,
  buildComponentLibraryFromRegistry
} from './componentRegistry.js';
import {
  applyFlightModelPackage,
  exportFlightModelPackage,
  validateFlightModelPackage
} from './flightModelPackageService.js';
```

- [ ] **Step 4: Expose registry globals before runtime eval**

In `mountLegacyRuntime()`, add these assignments after `window.__GZ_FAULT_TYPE_CATALOG__ = faultTypeCatalog;` and before `window.__GZ_FLIGHT_MODEL_PACKAGE__ = { ... }`:

```js
  window.__GZ_COMPONENT_GROUPS__ = COMPONENT_GROUPS;
  window.__GZ_COMPONENT_REGISTRY__ = COMPONENT_REGISTRY;
  window.__GZ_COMPONENT_LIBRARY__ = buildComponentLibraryFromRegistry(COMPONENT_REGISTRY);
```

- [ ] **Step 5: Run focused app test**

Run:

```powershell
npm.cmd test -- --run tests\flight-model-package-app.spec.js -t "component registry globals"
```

Expected: PASS.

---

### Task 4: Legacy Runtime Compatibility Hook

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/flight-model-package-app.spec.js`
- Test: `tests/signal-routing-app.spec.js`

- [ ] **Step 1: Prefer injected component library with fallback**

In `src/services/legacy-runtime.txt`, change the first component library declaration from:

```js
const COMPONENT_LIBRARY={
```

to:

```js
const COMPONENT_LIBRARY=window.__GZ_COMPONENT_LIBRARY__||{
```

Leave the entire existing object body intact as fallback. Leave later overrides such as `COMPONENT_LIBRARY.flow_block = ...`, `COMPONENT_LIBRARY.gain_block = ...`, and layered fault injector registration intact.

- [ ] **Step 2: Prove current node creation still uses compatible metadata**

Run:

```powershell
npm.cmd test -- --run tests\signal-routing-app.spec.js -t "flow_block|gain, sum, and mux"
```

Expected: PASS. This proves the signal adapter and signal utility blocks still render and create nodes.

- [ ] **Step 3: Prove package import still works with injected registry**

Run:

```powershell
npm.cmd test -- --run tests\flight-model-package-app.spec.js -t "imports and exports|component registry globals|enables the run button"
```

Expected: PASS.

- [ ] **Step 4: Commit bootstrap and runtime compatibility changes**

Run:

```powershell
git add src\services\legacyRuntimeBootstrap.js src\services\legacy-runtime.txt tests\flight-model-package-app.spec.js
git commit -m "Inject component registry into legacy runtime"
```

---

### Task 5: Verification

**Files:**
- Validate all modified files.

- [ ] **Step 1: Run registry unit tests**

Run:

```powershell
npm.cmd test -- --run tests\component-registry.spec.js
```

Expected: PASS.

- [ ] **Step 2: Run signal routing app tests**

Run:

```powershell
npm.cmd test -- --run tests\signal-routing-app.spec.js
```

Expected: PASS.

- [ ] **Step 3: Run flight model package app tests**

Run:

```powershell
npm.cmd test -- --run tests\flight-model-package-app.spec.js
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```powershell
npm.cmd run build
```

Expected: build exits 0. A Vite chunk-size warning is acceptable if no error is reported.

- [ ] **Step 5: Check final diff**

Run:

```powershell
git status -sb
git diff --stat
```

Expected: only the intended registry, bootstrap, runtime, and test files changed.

---

## Plan Self-Review

- Spec coverage: Stage 1 creates the registry, exposes globals, generates legacy-compatible library entries, and keeps legacy behavior stable.
- No new components are introduced.
- Left-panel rendering, port registration, inspector registration, and runtime behavior registration are deliberately deferred to later stages.
- The test plan covers unit conversion, runtime global exposure, signal routing, model package import, and production build.
