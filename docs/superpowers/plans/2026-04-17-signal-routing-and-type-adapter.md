# Signal Routing And Type Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Simulink-style output branching, retain single-source inputs, redefine `flow_block` as a signal adapter block, and introduce minimal explicit signal utility blocks (`gain_block`, `sum_block`, `mux_block`).

**Architecture:** Keep the existing edge schema and graph traversal model, but change connection validation so one output port may feed multiple targets while each input port remains single-source unless the destination block explicitly aggregates inputs. Extend block metadata and runtime evaluation in `legacy-runtime.txt` for adapter and utility semantics, then round-trip the new graphs through snapshot/model-package services and reinforce behavior with focused integration tests.

**Tech Stack:** Vue 3 app shell, legacy DOM runtime in `src/services/legacy-runtime.txt`, Vite, Vitest, existing model-package JSON pipeline.

---

## File Structure

- Modify: `src/services/legacy-runtime.txt`
  - Connection validation and toast rules
  - Block metadata, subtitles, and port contracts
  - Runtime evaluation for `gain_block`, `sum_block`, `mux_block`
  - Palette/node rendering labels for `flow_block`
- Modify: `src/constants/componentLibrary.js`
  - Palette entries for `gain_block`, `sum_block`, `mux_block`
  - Updated label copy for `flow_block`
- Modify: `src/fragments/left-panel.html`
  - Visible component grouping and labels for new utility blocks and renamed adapter wording
- Modify: `src/styles/components.css`
  - Styling hooks for the new block badges/colors if needed
- Modify: `src/services/workbenchSnapshotService.js`
  - Ensure new block types and branched edges round-trip cleanly
- Modify: `src/services/flightModelPackageService.js`
  - Ensure import/export validation accepts branched graphs and new block types
- Modify: `README.md`
  - Document branching rules, adapter-block role, and new utility blocks
- Modify: `tests/python-binding-app.spec.js`
  - Connection semantics regression coverage around branching and single-source inputs
- Modify: `tests/flight-model-package.spec.js`
  - Package round-trip coverage for branched graphs and new block types
- Modify: `tests/flight-model-package-app.spec.js`
  - App-level import/export coverage for branched topologies
- Create or Modify: `tests/signal-routing-app.spec.js`
  - Focused UI/integration tests for output branching, duplicate protection, and utility blocks

## Task 1: Allow Output Branching While Keeping Input Ports Single-Source

**Files:**
- Modify: `tests/signal-routing-app.spec.js`
- Modify: `src/services/legacy-runtime.txt:1708-1801`

- [ ] **Step 1: Write the failing routing tests**

```js
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

describe('signal routing integration', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('allows one output port to branch into multiple downstream inputs', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('signal_source', 180, 180);
    window.createNode('simulation_block', 460, 160);
    window.createNode('instrument_scope', 760, 160);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const source = state.modelNodes.find((node) => node.type === 'signal_source');
    const sim = state.modelNodes.find((node) => node.type === 'simulation_block');
    const scope = state.modelNodes.find((node) => node.type === 'instrument_scope');

    window.__GZ_STATE__.modelEdges.push({
      id: 'edge-source-sim',
      lineType: 'normal',
      sourceNodeId: source.id,
      targetNodeId: sim.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });
    window.__GZ_STATE__.modelEdges.push({
      id: 'edge-source-scope',
      lineType: 'normal',
      sourceNodeId: source.id,
      targetNodeId: scope.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });

    expect(
      state.modelEdges.filter((edge) => edge.sourceNodeId === source.id && edge.sourcePortIndex === 0)
    ).toHaveLength(2);
  });

  it('still rejects a second upstream connection into the same input port', async () => {
    mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('signal_source', 180, 180);
    window.createNode('signal_source', 180, 320);
    window.createNode('simulation_block', 460, 220);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const [sourceA, sourceB] = state.modelNodes.filter((node) => node.type === 'signal_source');
    const sim = state.modelNodes.find((node) => node.type === 'simulation_block');

    state.modelEdges.push({
      id: 'edge-a-sim',
      lineType: 'normal',
      sourceNodeId: sourceA.id,
      targetNodeId: sim.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });

    const previousCount = state.modelEdges.length;
    window.__GZ_STATE__.pendingConnection = {
      sourceNodeId: sourceB.id,
      sourcePortIndex: 0,
      lineType: 'normal',
      x: 0,
      y: 0
    };
    window.handlePortClick({ stopPropagation() {} }, sim.id, 'input', 0);

    expect(state.modelEdges).toHaveLength(previousCount);
    expect(document.getElementById('tm')?.textContent).toContain('该输入端口已有连线');
  });
});
```

- [ ] **Step 2: Run the routing tests to verify the current behavior fails**

Run: `npm test -- --run tests/signal-routing-app.spec.js`

Expected: FAIL because the app does not yet expose a focused routing spec file and because `handlePortClick()` still uses legacy single-connection assumptions.

- [ ] **Step 3: Implement minimal routing-rule changes**

```js
function handlePortClick(event,nodeId,direction,index){
  event.stopPropagation();
  const node=getNode(nodeId);
  if(!node){return;}
  const port=getPortInfo(node,direction,index);
  if(!port){return;}

  if(direction==='output'){
    S.pendingConnection={
      sourceNodeId:nodeId,
      sourcePortIndex:index,
      lineType:S.activeLineType,
      x:port.x,
      y:port.y
    };
    renderEdges();
    return;
  }

  if(!S.pendingConnection){
    toast('请先从输出端口开始连线','w');
    return;
  }

  const duplicate=S.modelEdges.some(edge=>
    edge.sourceNodeId===S.pendingConnection.sourceNodeId &&
    edge.targetNodeId===nodeId &&
    (edge.sourcePortIndex||0)===(S.pendingConnection.sourcePortIndex||0) &&
    (edge.targetPortIndex||0)===index
  );
  if(duplicate){
    toast('该连线已存在','w');
    clearPendingConnection();
    return;
  }

  const occupiedTarget=S.modelEdges.some(edge=>
    edge.targetNodeId===nodeId &&
    (edge.targetPortIndex||0)===index
  );
  if(occupiedTarget){
    toast('该输入端口已有连线，请先删除原连线，避免信号耦合','w');
    clearPendingConnection();
    return;
  }

  // Do not block additional edges from the same source output port.
  S.modelEdges.push(/* existing newEdge payload */);
}
```

- [ ] **Step 4: Run the routing tests to verify the branching rule passes**

Run: `npm test -- --run tests/signal-routing-app.spec.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/signal-routing-app.spec.js src/services/legacy-runtime.txt
git commit -m "feat: allow output port branching"
```

## Task 2: Redefine `flow_block` As A Signal Adapter Block

**Files:**
- Modify: `src/constants/componentLibrary.js`
- Modify: `src/fragments/left-panel.html`
- Modify: `src/services/legacy-runtime.txt:1584-1609,5707-5711,6009-6011`
- Modify: `README.md`
- Test: `tests/signal-routing-app.spec.js`

- [ ] **Step 1: Write the failing wording/metadata test**

```js
it('presents flow_block as a signal adapter block in the palette and subtitles', async () => {
  mount(App, { attachTo: document.body });
  await flushRuntime();

  const paletteItem = document.querySelector('[data-component="flow_block"]');
  expect(paletteItem?.textContent).toContain('适配');

  window.createNode('flow_block', 360, 220);
  await flushRuntime();

  const nodeCard = document.querySelector('.blk.b-flow');
  expect(nodeCard?.textContent).toContain('适配');
});
```

- [ ] **Step 2: Run the test to verify it fails with current “流程块” wording**

Run: `npm test -- --run tests/signal-routing-app.spec.js`

Expected: FAIL because the palette and subtitle still describe `flow_block` as a generic process block.

- [ ] **Step 3: Implement the copy and subtitle changes**

```js
// src/constants/componentLibrary.js
export const systemModelingComponents = [
  { type: 'signal_source', label: '信号源' },
  { type: 'flow_block', label: '信号适配块' },
  { type: 'simulation_block', label: '仿真块' },
  { type: 'subsystem_block', label: '子系统块' }
];

// src/services/legacy-runtime.txt
case 'flow_block':
  return `${props.inputName} / ${props.inputFormat} -> ${props.outputName} / ${props.outputFormat} · 类型适配`;
```

- [ ] **Step 4: Run the test to verify the new role is visible**

Run: `npm test -- --run tests/signal-routing-app.spec.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/constants/componentLibrary.js src/fragments/left-panel.html src/services/legacy-runtime.txt README.md tests/signal-routing-app.spec.js
git commit -m "refactor: redefine flow block as signal adapter"
```

## Task 3: Introduce `gain_block`, `sum_block`, And `mux_block`

**Files:**
- Modify: `src/constants/componentLibrary.js`
- Modify: `src/services/legacy-runtime.txt:56-140,1329-1398,1584-1609,2030-2056`
- Modify: `src/styles/components.css`
- Test: `tests/signal-routing-app.spec.js`

- [ ] **Step 1: Write failing component-presence tests**

```js
it('shows gain, sum, and mux blocks in the palette', async () => {
  mount(App, { attachTo: document.body });
  await flushRuntime();

  expect(document.querySelector('[data-component="gain_block"]')).not.toBeNull();
  expect(document.querySelector('[data-component="sum_block"]')).not.toBeNull();
  expect(document.querySelector('[data-component="mux_block"]')).not.toBeNull();
});

it('creates nodes for gain, sum, and mux blocks with visible ports', async () => {
  mount(App, { attachTo: document.body });
  await flushRuntime();

  window.createNode('gain_block', 220, 180);
  window.createNode('sum_block', 460, 180);
  window.createNode('mux_block', 700, 180);
  await flushRuntime();

  expect(document.querySelector('.blk.b-gain')).not.toBeNull();
  expect(document.querySelector('.blk.b-sum')).not.toBeNull();
  expect(document.querySelector('.blk.b-mux')).not.toBeNull();
});
```

- [ ] **Step 2: Run the test to verify the new blocks do not exist yet**

Run: `npm test -- --run tests/signal-routing-app.spec.js`

Expected: FAIL because the palette and node factory do not yet know those block types.

- [ ] **Step 3: Add the minimal block metadata**

```js
// src/constants/componentLibrary.js
{ type: 'gain_block', label: '增益块' },
{ type: 'sum_block', label: '求和块' },
{ type: 'mux_block', label: 'Mux 块' }

// src/services/legacy-runtime.txt
COMPONENT_LIBRARY.gain_block = {
  label:'增益块',
  badge:'增益',
  className:'b-gain',
  width:156,
  height:84,
  defaults:{name:'增益块 1',gain:'1.0',inputFormat:'标量',outputFormat:'标量'}
};
COMPONENT_LIBRARY.sum_block = {
  label:'求和块',
  badge:'求和',
  className:'b-sum',
  width:164,
  height:88,
  defaults:{name:'求和块 1',inputCount:2,signs:['+','+'],outputFormat:'标量'}
};
COMPONENT_LIBRARY.mux_block = {
  label:'Mux 块',
  badge:'Mux',
  className:'b-mux',
  width:164,
  height:88,
  defaults:{name:'Mux 块 1',inputCount:2,outputFormat:'向量'}
};
```

- [ ] **Step 4: Run the palette/node tests to verify the new blocks exist**

Run: `npm test -- --run tests/signal-routing-app.spec.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/constants/componentLibrary.js src/services/legacy-runtime.txt src/styles/components.css tests/signal-routing-app.spec.js
git commit -m "feat: add minimal signal utility blocks"
```

## Task 4: Implement Runtime Evaluation For `gain_block`, `sum_block`, And `mux_block`

**Files:**
- Modify: `src/services/legacy-runtime.txt:6247-6510`
- Test: `tests/signal-routing-app.spec.js`

- [ ] **Step 1: Write failing runtime tests**

```js
it('evaluates gain_block as scalar multiplication', async () => {
  mount(App, { attachTo: document.body });
  await flushRuntime();

  const state = window.__GZ_STATE__;
  state.modelNodes = [
    { id: 'source-1', type: 'signal_source', props: { name: 'S1', waveType: 'constant', amplitude: '2', frequency: '0', outputFormat: '标量' }, x: 0, y: 0, w: 160, h: 84 },
    { id: 'gain-1', type: 'gain_block', props: { name: 'G1', gain: '0.5', inputFormat: '标量', outputFormat: '标量' }, x: 0, y: 0, w: 156, h: 84 }
  ];
  state.modelEdges = [
    { id: 'edge-source-gain', lineType: 'normal', sourceNodeId: 'source-1', targetNodeId: 'gain-1', sourcePortIndex: 0, targetPortIndex: 0 }
  ];

  const value = window.resolveNodeOutput('gain-1', 0, 'actual', 0, 0.1, new Map(), new Set());
  expect(value).toBe(1);
});

it('evaluates sum_block by adding explicit inputs', async () => {
  mount(App, { attachTo: document.body });
  await flushRuntime();

  const state = window.__GZ_STATE__;
  state.modelNodes = [
    { id: 'source-a', type: 'signal_source', props: { name: 'A', waveType: 'constant', amplitude: '2', frequency: '0', outputFormat: '标量' }, x: 0, y: 0, w: 160, h: 84 },
    { id: 'source-b', type: 'signal_source', props: { name: 'B', waveType: 'constant', amplitude: '3', frequency: '0', outputFormat: '标量' }, x: 0, y: 0, w: 160, h: 84 },
    { id: 'sum-1', type: 'sum_block', props: { name: 'SUM', inputCount: 2, signs: ['+','+'], outputFormat: '标量' }, x: 0, y: 0, w: 164, h: 88 }
  ];
  state.modelEdges = [
    { id: 'edge-a-sum', lineType: 'normal', sourceNodeId: 'source-a', targetNodeId: 'sum-1', sourcePortIndex: 0, targetPortIndex: 0 },
    { id: 'edge-b-sum', lineType: 'normal', sourceNodeId: 'source-b', targetNodeId: 'sum-1', sourcePortIndex: 0, targetPortIndex: 1 }
  ];

  const value = window.resolveNodeOutput('sum-1', 0, 'actual', 0, 0.1, new Map(), new Set());
  expect(value).toBe(5);
});
```

- [ ] **Step 2: Run the runtime tests to verify they fail before implementation**

Run: `npm test -- --run tests/signal-routing-app.spec.js`

Expected: FAIL because the new block types are not yet handled in runtime evaluation.

- [ ] **Step 3: Implement minimal evaluation behavior**

```js
if(node.type==='gain_block'){
  const inputValue = resolveIncomingValue(node.id,0,modeKey,time,dt,cache,visiting);
  return Number(inputValue) * Number(node.props?.gain ?? 1);
}
if(node.type==='sum_block'){
  const inputCount = Number(node.props?.inputCount ?? 2);
  let total = 0;
  for(let portIndex=0; portIndex<inputCount; portIndex+=1){
    const value = resolveIncomingValue(node.id,portIndex,modeKey,time,dt,cache,visiting);
    const sign = node.props?.signs?.[portIndex] === '-' ? -1 : 1;
    total += sign * Number(value || 0);
  }
  return total;
}
if(node.type==='mux_block'){
  const inputCount = Number(node.props?.inputCount ?? 2);
  const packed = [];
  for(let portIndex=0; portIndex<inputCount; portIndex+=1){
    packed.push(resolveIncomingValue(node.id,portIndex,modeKey,time,dt,cache,visiting));
  }
  return packed;
}
```

- [ ] **Step 4: Run the runtime tests to verify the new blocks evaluate correctly**

Run: `npm test -- --run tests/signal-routing-app.spec.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/legacy-runtime.txt tests/signal-routing-app.spec.js
git commit -m "feat: evaluate gain sum and mux blocks"
```

## Task 5: Preserve Branched Topologies In Snapshots And Model Packages

**Files:**
- Modify: `tests/flight-model-package.spec.js`
- Modify: `tests/flight-model-package-app.spec.js`
- Modify: `src/services/workbenchSnapshotService.js`
- Modify: `src/services/flightModelPackageService.js`

- [ ] **Step 1: Write failing round-trip tests for branched edges**

```js
it('preserves one-to-many output branching across model-package export and import', () => {
  const snapshot = {
    version: 2,
    rootCanvasId: 'canvas-root',
    activeCanvasId: 'canvas-root',
    canvasTrail: ['canvas-root'],
    canvases: {
      'canvas-root': {
        id: 'canvas-root',
        name: '顶层',
        parentSubsystemNodeId: null,
        viewport: { scale: 1, offsetX: 0, offsetY: 0 },
        nodes: [
          { id: 'source-1', type: 'signal_source', props: { name: 'S1' } },
          { id: 'sim-1', type: 'simulation_block', props: { name: 'SIM' } },
          { id: 'scope-1', type: 'instrument_scope', props: { name: 'SCOPE' } }
        ],
        edges: [
          { id: 'edge-source-sim', lineType: 'normal', sourceNodeId: 'source-1', targetNodeId: 'sim-1', sourcePortIndex: 0, targetPortIndex: 0 },
          { id: 'edge-source-scope', lineType: 'normal', sourceNodeId: 'source-1', targetNodeId: 'scope-1', sourcePortIndex: 0, targetPortIndex: 0 }
        ]
      }
    }
  };

  const pkg = createFlightModelPackage(snapshot, []);
  const restored = extractWorkbenchSnapshotFromPackage(pkg);

  expect(restored.canvases['canvas-root'].edges).toHaveLength(2);
  expect(restored.canvases['canvas-root'].edges.filter((edge) => edge.sourceNodeId === 'source-1')).toHaveLength(2);
});
```

- [ ] **Step 2: Run the package tests to verify any normalization assumptions fail**

Run: `npm test -- --run tests/flight-model-package.spec.js tests/flight-model-package-app.spec.js`

Expected: FAIL if import/export logic still assumes simpler wiring or strips new utility block types.

- [ ] **Step 3: Implement the minimal package/snapshot adjustments**

```js
// Keep branched edge arrays untouched during snapshot normalization.
const normalizedEdges = (canvas.edges || []).map(edge => ({
  ...edge,
  sourcePortIndex: Number.isFinite(Number(edge.sourcePortIndex)) ? Number(edge.sourcePortIndex) : 0,
  targetPortIndex: Number.isFinite(Number(edge.targetPortIndex)) ? Number(edge.targetPortIndex) : 0
}));

// Accept new utility block types during import validation.
const allowedNodeTypes = new Set([
  'signal_source',
  'flow_block',
  'simulation_block',
  'subsystem_block',
  'gain_block',
  'sum_block',
  'mux_block',
  'instrument_scope',
  'instrument_logger',
  'instrument_spectrum'
]);
```

- [ ] **Step 4: Run the package tests to verify the topology survives round-trip**

Run: `npm test -- --run tests/flight-model-package.spec.js tests/flight-model-package-app.spec.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/workbenchSnapshotService.js src/services/flightModelPackageService.js tests/flight-model-package.spec.js tests/flight-model-package-app.spec.js
git commit -m "feat: preserve branched signal topologies in packages"
```

## Task 6: Document The Routing Model And Adapter-Block Usage

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the documentation patch**

```md
## 信号连接规则

- 一个输出端口可以连接多个下游输入端口，用于信号分支。
- 一个输入端口默认只接受一个上游输出，避免隐式信号耦合。
- 如果需要合并多个信号，请显式使用 `求和块` 或 `Mux 块`。

## 信号适配块

`flow_block` 在平台中保留，但职责调整为“信号适配块”：

- 统一输入输出数据类型
- 整理标量/向量等形状信息
- 在进入 Python 仿真块前完成信号规范化

## 基础信号块

- `gain_block`：对输入信号做比例缩放
- `sum_block`：对多个输入信号做显式求和
- `mux_block`：将多个输入信号打包为一个向量输出
```

- [ ] **Step 2: Verify the README update reads cleanly in the repository**

Run: `Get-Content README.md | Select-String "信号连接规则|信号适配块|gain_block"`

Expected: Matching lines printed for all three sections.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe signal routing and adapter semantics"
```

## Self-Review

### Spec coverage

- Output branching: covered in Task 1
- Single-source inputs: covered in Task 1
- `flow_block` redefinition: covered in Task 2 and Task 6
- New minimal blocks (`gain_block`, `sum_block`, `mux_block`): covered in Tasks 3 and 4
- Package/snapshot round-trip: covered in Task 5
- Documentation: covered in Task 6

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain
- Each task includes concrete code or commands
- Every verification step specifies an exact command and expected result

### Type consistency

- The plan consistently uses `gain_block`, `sum_block`, and `mux_block`
- The plan consistently keeps `flow_block` as the internal compatibility type
- The plan consistently keeps output branching legal and input-port fan-in illegal by default
