# Component Fault Capability Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the UAV demo from a loose fault catalog workflow into a component-owned fault capability model where fault tags activate only faults supported by the selected component or signal link.

**Architecture:** Keep the existing legacy runtime as the integration layer, but introduce a clear authoring contract in the demo package: `faultTypeCatalog`, `faultCapabilityMap`, `faultInstances`, and `diagnosticModel`. Runtime code should derive old compatibility fields such as `injectedFault`, `faultBindings`, and `faultTags` from active fault instances so current simulation and diagnosis code keeps working during migration.

**Tech Stack:** Vue/Vite shell, legacy browser runtime in `src/services/legacy-runtime.txt`, Vitest, JSON demo package under `public/model-packages`.

---

## File Structure

- Modify: `public/model-packages/evtol_closed_loop_fault_demo.json`
  - Add schema 2.0 fields while preserving existing `workbenchSnapshot`, `faultLibrary`, and `diagnosticModel` compatibility.
  - Add Chinese target capability definitions for the current demo only.
- Modify: `src/services/legacy-runtime.txt`
  - Add helpers that read `faultCapabilityMap` and resolve compatible faults for a target.
  - Add a fault activation flow for a generic fault component/tag dropped or applied to a target.
  - Keep compatibility mirrors in `injectedFault`, `faultBindings`, `S.faultTags`, and `S.injectedFaultMap`.
  - Ensure reset/import clears `faultInstances` and derived visual state.
- Modify: `tests/flight-model-package.spec.js`
  - Add package-level schema checks for the new fault capability model.
- Modify: `tests/flight-model-package-app.spec.js`
  - Add browser-runtime interaction tests for compatible target fault activation, fault instance creation, and parameter application.
- Modify: `tests/diagnostic-testpoint-contract.spec.js`
  - Add diagnostic checks proving the D matrix can distinguish multiple fault forms on the same component.
- Optional modify: `src/styles/ibm-workbench.css`
  - Add only small visual states for the fault selection dialog if existing styles are insufficient.

Do not include `Jigui_demo/` in any command, test fixture, commit, or push.

## Current Data Anchors

The current primary demo package is `public/model-packages/evtol_closed_loop_fault_demo.json`. It already contains:

- `workbenchSnapshot.modelNodes[]`
- `workbenchSnapshot.modelEdges[]`
- `faultLibrary[]`
- `diagnosticModel.testPoints[]`
- `diagnosticModel.dMatrix`

The five first-class demo fault types are already present in the package under legacy IDs:

- `gyro_zero_bias_offset`: Gyro fixed zero-bias fault.
- `gyro_zero_bias_drift`: Gyro slow drift fault.
- `gyro_zero_bias_intermittent`: Gyro intermittent fault.
- `motor_1_stuck_position`: motor 1 stuck-position fault.
- `control_command_tamper`: motor 1 CAN command tamper fault.

The implementation should keep these IDs rather than renaming them in the first pass. If the UI needs a cleaner name, use `displayName`.

### Task 1: Add Demo Package Capability Contract

**Files:**
- Modify: `public/model-packages/evtol_closed_loop_fault_demo.json`
- Test: `tests/flight-model-package.spec.js`

- [ ] **Step 1: Write the failing package contract test**

Add this test near the existing `evtol_closed_loop_fault_demo.json` tests in `tests/flight-model-package.spec.js`:

```js
it('defines component-owned fault capabilities for the closed-loop demo', () => {
  const pkg = closedLoopPackage;
  const nodes = new Set(pkg.workbenchSnapshot.modelNodes.map((node) => node.id));
  const edges = new Set(pkg.workbenchSnapshot.modelEdges.map((edge) => edge.id));
  const faultIds = new Set(pkg.faultTypeCatalog.map((fault) => fault.id));

  expect(pkg.schemaVersion).toBe('2.0');
  expect(pkg.faultInstances).toEqual([]);
  expect(pkg.faultTypeCatalog).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'gyro_zero_bias_offset', displayName: 'Gyro 陀螺仪零偏 - 固定偏差' }),
    expect.objectContaining({ id: 'gyro_zero_bias_drift', displayName: 'Gyro 陀螺仪零偏 - 缓慢漂移' }),
    expect.objectContaining({ id: 'gyro_zero_bias_intermittent', displayName: 'Gyro 陀螺仪零偏 - 间歇故障' }),
    expect.objectContaining({ id: 'motor_1_stuck_position', displayName: '单电机卡死 - 1号电机卡位' }),
    expect.objectContaining({ id: 'control_command_tamper', displayName: '控制指令篡改 - 1号电机 CAN 指令' })
  ]));

  pkg.faultCapabilityMap.forEach((entry) => {
    expect(['node', 'edge']).toContain(entry.targetKind);
    expect(entry.targetKind === 'node' ? nodes.has(entry.targetId) : edges.has(entry.targetId)).toBe(true);
    expect(entry.targetName).toBeTruthy();
    expect(entry.faultSlots.length).toBeGreaterThan(0);
    entry.faultSlots.forEach((slot) => {
      expect(slot.slotId).toBeTruthy();
      expect(slot.slotName).toBeTruthy();
      expect(slot.allowedFaultIds.length).toBeGreaterThan(0);
      slot.allowedFaultIds.forEach((faultId) => expect(faultIds.has(faultId)).toBe(true));
    });
  });

  const imu = pkg.faultCapabilityMap.find((entry) => entry.targetId === 'node-imu');
  expect(imu.faultSlots[0].allowedFaultIds).toEqual([
    'gyro_zero_bias_offset',
    'gyro_zero_bias_drift',
    'gyro_zero_bias_intermittent'
  ]);

  const motor = pkg.faultCapabilityMap.find((entry) => entry.targetId === 'node-motor-1');
  expect(motor.faultSlots[0].allowedFaultIds).toEqual(['motor_1_stuck_position']);

  const can = pkg.faultCapabilityMap.find((entry) => entry.targetId === 'edge-allocator-motor1');
  expect(can.faultSlots[0].allowedFaultIds).toEqual(['control_command_tamper']);
});
```

- [ ] **Step 2: Run the failing package test**

Run:

```bash
npm test -- tests/flight-model-package.spec.js -t "defines component-owned fault capabilities" --run
```

Expected: FAIL because `faultTypeCatalog`, `faultCapabilityMap`, and `faultInstances` are missing.

- [ ] **Step 3: Add the minimal schema fields to the demo package**

In `public/model-packages/evtol_closed_loop_fault_demo.json`:

1. Change `schemaVersion` to `"2.0"`.
2. Add `faultTypeCatalog` by copying the five focused fault models from `faultLibrary`, preserving their existing IDs and parameters.
3. Add `faultCapabilityMap`:

```json
[
  {
    "targetId": "node-imu",
    "targetKind": "node",
    "targetName": "IMU 陀螺仪反馈",
    "faultSlots": [
      {
        "slotId": "imu-gyro-feedback",
        "slotName": "陀螺仪反馈信号",
        "signalId": "imu.pitch_rate",
        "allowedFaultIds": [
          "gyro_zero_bias_offset",
          "gyro_zero_bias_drift",
          "gyro_zero_bias_intermittent"
        ]
      }
    ]
  },
  {
    "targetId": "node-motor-1",
    "targetKind": "node",
    "targetName": "1号电机与旋翼",
    "faultSlots": [
      {
        "slotId": "motor1-output",
        "slotName": "1号电机执行输出",
        "signalId": "motor1.thrust",
        "allowedFaultIds": ["motor_1_stuck_position"]
      }
    ]
  },
  {
    "targetId": "edge-allocator-motor1",
    "targetKind": "edge",
    "targetName": "1号电机 CAN 指令",
    "faultSlots": [
      {
        "slotId": "motor1-can-command",
        "slotName": "1号电机控制指令",
        "signalId": "motor1.command",
        "allowedFaultIds": ["control_command_tamper"]
      }
    ]
  }
]
```

4. Add `"faultInstances": []`.

Keep the legacy `faultLibrary` array intact for compatibility.

- [ ] **Step 4: Run the package test again**

Run:

```bash
npm test -- tests/flight-model-package.spec.js -t "defines component-owned fault capabilities" --run
```

Expected: PASS.

- [ ] **Step 5: Commit task 1**

```bash
git add public/model-packages/evtol_closed_loop_fault_demo.json tests/flight-model-package.spec.js
git commit -m "feat: add component fault capability contract"
```

### Task 2: Add Runtime Capability Resolution

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/flight-model-package-app.spec.js`

- [ ] **Step 1: Write the failing runtime helper test**

Add this app test after the existing default package import tests in `tests/flight-model-package-app.spec.js`:

```js
it('resolves compatible fault choices from target fault capability slots', async () => {
  await importDefaultClosedLoopPackage();
  const state = window.__GZ_STATE__;

  const imu = state.modelNodes.find((node) => node.id === 'node-imu');
  const motor = state.modelNodes.find((node) => node.id === 'node-motor-1');
  const canEdge = state.modelEdges.find((edge) => edge.id === 'edge-allocator-motor1');
  const controller = state.modelNodes.find((node) => node.id === 'node-controller');

  expect(window.getFaultCapabilityForTarget(imu)).toMatchObject({
    targetId: 'node-imu',
    targetKind: 'node'
  });
  expect(window.getCompatibleFaultModelsForTarget(imu).map((fault) => fault.id)).toEqual([
    'gyro_zero_bias_offset',
    'gyro_zero_bias_drift',
    'gyro_zero_bias_intermittent'
  ]);
  expect(window.getCompatibleFaultModelsForTarget(motor).map((fault) => fault.id)).toEqual([
    'motor_1_stuck_position'
  ]);
  expect(window.getCompatibleFaultModelsForTarget(canEdge).map((fault) => fault.id)).toEqual([
    'control_command_tamper'
  ]);
  expect(window.getCompatibleFaultModelsForTarget(controller)).toEqual([]);
});
```

- [ ] **Step 2: Run the failing helper test**

Run:

```bash
npm test -- tests/flight-model-package-app.spec.js -t "resolves compatible fault choices" --run
```

Expected: FAIL because `window.getFaultCapabilityForTarget` is not defined.

- [ ] **Step 3: Implement capability resolution helpers**

In `src/services/legacy-runtime.txt`, add helpers near the current fault tag bridge section, before `createVisualFaultInjection`:

```js
function getActiveFaultCapabilityMap(){
  const pkg=S.activeModelPackage||{};
  return Array.isArray(pkg.faultCapabilityMap) ? pkg.faultCapabilityMap : [];
}

function inferFaultTargetKind(target){
  return target?.sourceNodeId && target?.targetNodeId ? 'edge' : 'node';
}

function getFaultCapabilityForTarget(target){
  if(!target?.id){return null;}
  const kind=inferFaultTargetKind(target);
  return getActiveFaultCapabilityMap().find((entry)=>(
    entry?.targetId===target.id && (entry.targetKind||kind)===kind
  ))||null;
}

function getActiveFaultTypeCatalog(){
  const pkg=S.activeModelPackage||{};
  if(Array.isArray(pkg.faultTypeCatalog)&&pkg.faultTypeCatalog.length){
    return pkg.faultTypeCatalog;
  }
  return Array.isArray(S.availableFaultModels) ? S.availableFaultModels : [];
}

function normalizeCapabilityFaultModel(model){
  if(!model){return null;}
  return {
    ...model,
    name:model.name||model.displayName||model.id,
    displayName:model.displayName||model.name||model.id,
    defaultParameters:model.defaultParameters||Object.fromEntries(
      Object.entries(model.parameters||{}).map(([key,value])=>[key,value?.default])
    )
  };
}

function getCompatibleFaultModelsForTarget(target){
  const capability=getFaultCapabilityForTarget(target);
  if(!capability){return [];}
  const allowedIds=new Set((capability.faultSlots||[]).flatMap((slot)=>slot.allowedFaultIds||[]));
  return getActiveFaultTypeCatalog()
    .filter((model)=>allowedIds.has(model?.id))
    .map(normalizeCapabilityFaultModel)
    .filter(Boolean);
}

Object.assign(window,{
  getFaultCapabilityForTarget,
  getCompatibleFaultModelsForTarget
});
```

- [ ] **Step 4: Ensure package import stores the new fields**

In the package import path that assigns `S.activeModelPackage`, ensure the full package object is retained. If `applyFlightModelPackage` currently strips unknown keys, add:

```js
S.activeModelPackage={
  ...(S.activeModelPackage||{}),
  faultTypeCatalog:Array.isArray(pkg.faultTypeCatalog)?cloneBridgeValue(pkg.faultTypeCatalog):[],
  faultCapabilityMap:Array.isArray(pkg.faultCapabilityMap)?cloneBridgeValue(pkg.faultCapabilityMap):[],
  faultInstances:Array.isArray(pkg.faultInstances)?cloneBridgeValue(pkg.faultInstances):[]
};
```

Place this immediately after the existing active package assignment, not in render code.

- [ ] **Step 5: Run the helper test again**

Run:

```bash
npm test -- tests/flight-model-package-app.spec.js -t "resolves compatible fault choices" --run
```

Expected: PASS.

- [ ] **Step 6: Commit task 2**

```bash
git add src/services/legacy-runtime.txt tests/flight-model-package-app.spec.js
git commit -m "feat: resolve target fault capabilities"
```

### Task 3: Create Fault Instances Instead of Catalog-Only Imports

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/flight-model-package-app.spec.js`

- [ ] **Step 1: Write the failing fault instance activation test**

Add this test in `tests/flight-model-package-app.spec.js` near the existing fault tag tests:

```js
it('activates a compatible fault as a target-owned fault instance', async () => {
  await importDefaultClosedLoopPackage();
  const state = window.__GZ_STATE__;
  const imu = state.modelNodes.find((node) => node.id === 'node-imu');

  const result = window.activateFaultForTarget(imu, 'gyro_zero_bias_drift', {
    rate: '0.01',
    start: '5'
  });

  expect(result.ok).toBe(true);
  expect(state.faultInstances).toHaveLength(1);
  expect(state.faultInstances[0]).toMatchObject({
    faultTypeId: 'gyro_zero_bias_drift',
    targetKind: 'node',
    targetId: 'node-imu',
    slotId: 'imu-gyro-feedback',
    active: true
  });
  expect(state.faultInstances[0].parameters).toMatchObject({ rate: '0.01', start: '5' });
  expect(imu.injectedFault).toMatchObject({ modelId: 'gyro_zero_bias_drift' });
  expect(imu.faultBindings.some((binding) => binding.faultModelId === 'gyro_zero_bias_drift')).toBe(true);
  expect(state.faultTags.some((tag) => tag.faultModelId === 'gyro_zero_bias_drift' && tag.targetId === 'node-imu')).toBe(true);
});
```

- [ ] **Step 2: Run the failing activation test**

Run:

```bash
npm test -- tests/flight-model-package-app.spec.js -t "activates a compatible fault" --run
```

Expected: FAIL because `window.activateFaultForTarget` is not defined.

- [ ] **Step 3: Implement fault instance creation**

In `src/services/legacy-runtime.txt`, add:

```js
function ensureFaultInstances(){
  if(!Array.isArray(S.faultInstances)){S.faultInstances=[];}
  return S.faultInstances;
}

function getFirstCompatibleSlotForFault(target,faultTypeId){
  const capability=getFaultCapabilityForTarget(target);
  return (capability?.faultSlots||[]).find((slot)=>(slot.allowedFaultIds||[]).includes(faultTypeId))||null;
}

function getCapabilityFaultModel(faultTypeId){
  return getActiveFaultTypeCatalog().map(normalizeCapabilityFaultModel).find((model)=>model?.id===faultTypeId)||null;
}

function createFaultInstanceForTarget(target,faultTypeId,parameterOverrides={}){
  const model=getCapabilityFaultModel(faultTypeId);
  const slot=getFirstCompatibleSlotForFault(target,faultTypeId);
  if(!target||!model||!slot){
    return {ok:false,error:'incompatible-target'};
  }
  const targetKind=inferFaultTargetKind(target);
  const parameters={
    ...(model.defaultParameters||{}),
    ...parameterOverrides
  };
  const instance={
    instanceId:`fault-inst-${Date.now()}-${Math.random().toString(16).slice(2,8)}`,
    faultTypeId:model.id,
    targetKind,
    targetId:target.id,
    slotId:slot.slotId,
    displayName:model.displayName||model.name||model.id,
    parameters,
    active:true,
    visual:{expanded:false}
  };
  ensureFaultInstances().push(instance);
  return {ok:true,instance,model,slot};
}

function mirrorFaultInstanceToRuntimeTarget(instance,model,target){
  const payload=getRuntimePayload(model,instance.parameters||{});
  payload.modelId=instance.faultTypeId;
  payload.instanceId=instance.instanceId;
  payload.name=instance.displayName||model.displayName||model.name||model.id;
  if(instance.targetKind==='edge'){
    target.injectedFault=payload;
    appendRuntimeFaultBinding(target,model,payload,'edge');
  }else{
    target.injectedFault=payload;
    appendRuntimeFaultBinding(target,model,payload,'node');
    if(!S.faultedBlks.includes(target.id)){S.faultedBlks.push(target.id);}
  }
  if(!Array.isArray(S.injectedFaults)){S.injectedFaults=[];}
  S.injectedFaults.push({...payload,faultId:payload.modelId,status:'active'});
  if(!S.injectedFaultMap||typeof S.injectedFaultMap!=='object'){S.injectedFaultMap={};}
  S.injectedFaultMap[payload.modelId]={...payload,status:'active'};
  createVisualFaultInjection(model,target,payload);
}

function activateFaultForTarget(target,faultTypeId,parameterOverrides={}){
  const created=createFaultInstanceForTarget(target,faultTypeId,parameterOverrides);
  if(!created.ok){return created;}
  mirrorFaultInstanceToRuntimeTarget(created.instance,created.model,target);
  markTopologyDirty('fault');
  renderModelNodes();
  renderEdges();
  updateUI();
  return created;
}

Object.assign(window,{activateFaultForTarget});
```

If `createVisualFaultInjection` currently creates visible auto blocks instead of hidden tags, keep its latest tag-based behavior and only call it as a compatibility bridge.

- [ ] **Step 4: Run the activation test again**

Run:

```bash
npm test -- tests/flight-model-package-app.spec.js -t "activates a compatible fault" --run
```

Expected: PASS.

- [ ] **Step 5: Add incompatible target protection test**

Add:

```js
it('rejects fault activation on targets without compatible capability slots', async () => {
  await importDefaultClosedLoopPackage();
  const state = window.__GZ_STATE__;
  const controller = state.modelNodes.find((node) => node.id === 'node-controller');

  const result = window.activateFaultForTarget(controller, 'gyro_zero_bias_drift');

  expect(result).toMatchObject({ ok: false, error: 'incompatible-target' });
  expect(state.faultInstances || []).toHaveLength(0);
  expect(controller.injectedFault).toBeUndefined();
});
```

- [ ] **Step 6: Run activation tests**

Run:

```bash
npm test -- tests/flight-model-package-app.spec.js -t "fault activation|compatible fault" --run
```

Expected: PASS.

- [ ] **Step 7: Commit task 3**

```bash
git add src/services/legacy-runtime.txt tests/flight-model-package-app.spec.js
git commit -m "feat: activate faults as target-owned instances"
```

### Task 4: Connect Fault Component UI to Capability Flow

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Optional modify: `src/styles/ibm-workbench.css`
- Test: `tests/flight-model-package-app.spec.js`

- [ ] **Step 1: Write the failing UI selection test**

Add:

```js
it('opens compatible fault choices for a selected target instead of importing arbitrary catalog faults', async () => {
  await importDefaultClosedLoopPackage();
  const state = window.__GZ_STATE__;
  const imu = state.modelNodes.find((node) => node.id === 'node-imu');

  window.selectNode(imu.id);
  window.openTargetFaultActivationDialog();

  const dialog = document.querySelector('[data-target-fault-dialog]');
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain('IMU 陀螺仪反馈');
  expect(dialog.textContent).toContain('Gyro 陀螺仪零偏 - 固定偏差');
  expect(dialog.textContent).toContain('Gyro 陀螺仪零偏 - 缓慢漂移');
  expect(dialog.textContent).toContain('Gyro 陀螺仪零偏 - 间歇故障');
  expect(dialog.textContent).not.toContain('单电机卡死');
});
```

- [ ] **Step 2: Run the failing UI selection test**

Run:

```bash
npm test -- tests/flight-model-package-app.spec.js -t "opens compatible fault choices" --run
```

Expected: FAIL because `openTargetFaultActivationDialog` is not defined.

- [ ] **Step 3: Implement selected-target activation dialog**

Add a runtime function that uses the selected node or edge:

```js
function getSelectedFaultActivationTarget(){
  if(S.selBlk){return getNode(S.selBlk);}
  if(S.selEdge){return getEdge(S.selEdge);}
  return null;
}

function renderTargetFaultActivationDialog(target){
  const models=getCompatibleFaultModelsForTarget(target);
  const existing=document.querySelector('[data-target-fault-dialog]');
  existing?.remove();
  const box=document.createElement('div');
  box.className='target-fault-dialog';
  box.dataset.targetFaultDialog='true';
  box.innerHTML=`
    <div class="target-fault-dialog__head">
      <strong>${escapeHtml(target?.props?.name||target?.label||target?.id||'目标对象')}</strong>
      <button type="button" data-close-target-fault-dialog>关闭</button>
    </div>
    <div class="target-fault-dialog__body">
      ${models.length?models.map((model)=>`
        <button type="button" class="target-fault-choice" data-activate-compatible-fault="${escapeHtml(model.id)}">
          <span>${escapeHtml(model.displayName||model.name)}</span>
          <small>${escapeHtml(getLayerLabel(model.layer))} · ${escapeHtml(model.faultClass||model.modelClass||model.runtimeBehavior||'故障')}</small>
        </button>
      `).join(''):'<div class="target-fault-empty">该对象没有可添加的故障</div>'}
    </div>`;
  document.body.appendChild(box);
  box.querySelector('[data-close-target-fault-dialog]')?.addEventListener('click',()=>box.remove());
  box.querySelectorAll('[data-activate-compatible-fault]').forEach((button)=>{
    button.addEventListener('click',()=>{
      const faultId=button.dataset.activateCompatibleFault||'';
      activateFaultForTarget(target,faultId,{});
      box.remove();
    });
  });
}

function openTargetFaultActivationDialog(){
  const target=getSelectedFaultActivationTarget();
  if(!target){
    toast('请先选择可添加故障的组件或连线','w');
    return false;
  }
  renderTargetFaultActivationDialog(target);
  return true;
}

Object.assign(window,{openTargetFaultActivationDialog});
```

Wire the existing left-panel fault component click or drag-drop completion to `openTargetFaultActivationDialog()` when there is a selected target. Do not remove the old catalog modal in this task; keep it as a secondary path until tests are updated.

- [ ] **Step 4: Add minimal dialog styling**

In `src/styles/ibm-workbench.css`, add square IBM-style styles:

```css
.target-fault-dialog{
  position:fixed;
  right:24px;
  top:96px;
  width:min(420px, calc(100vw - 48px));
  z-index:80;
  background:#fff;
  border:1px solid #d7e2ee;
  box-shadow:none;
}
.target-fault-dialog__head{
  min-height:48px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 16px;
  border-bottom:1px solid #d7e2ee;
}
.target-fault-dialog__head button,
.target-fault-choice{
  border:1px solid #d7e2ee;
  background:#fff;
  color:#0f62fe;
}
.target-fault-dialog__body{padding:12px;display:grid;gap:8px;}
.target-fault-choice{
  min-height:56px;
  text-align:left;
  padding:8px 12px;
  color:#161616;
}
.target-fault-choice span{display:block;font-weight:600;}
.target-fault-choice small{display:block;color:#525252;margin-top:4px;}
```

- [ ] **Step 5: Run the UI test again**

Run:

```bash
npm test -- tests/flight-model-package-app.spec.js -t "opens compatible fault choices" --run
```

Expected: PASS.

- [ ] **Step 6: Commit task 4**

```bash
git add src/services/legacy-runtime.txt src/styles/ibm-workbench.css tests/flight-model-package-app.spec.js
git commit -m "feat: choose faults from target capabilities"
```

### Task 5: Diagnostic Matrix Contract for Same-Component Fault Forms

**Files:**
- Modify: `public/model-packages/evtol_closed_loop_fault_demo.json`
- Modify: `tests/diagnostic-testpoint-contract.spec.js`

- [ ] **Step 1: Write D matrix distinction test**

Add:

```js
it('distinguishes multiple Gyro fault forms at the diagnostic matrix level', () => {
  const demo = JSON.parse(readWorkspaceFile('public/model-packages/evtol_closed_loop_fault_demo.json'));
  const matrix = demo.diagnosticModel.dMatrix;
  const byFault = new Map(matrix.map((row) => [row.faultId || row.faultTypeId, row]));

  const fixed = byFault.get('gyro_zero_bias_offset');
  const drift = byFault.get('gyro_zero_bias_drift');
  const intermittent = byFault.get('gyro_zero_bias_intermittent');

  expect(fixed.targetId).toBe('node-imu');
  expect(drift.targetId).toBe('node-imu');
  expect(intermittent.targetId).toBe('node-imu');

  expect(fixed.points.M3.detectable).toBe(true);
  expect(drift.points.M3.detectable).toBe(true);
  expect(intermittent.points.M3.detectable).toBe(true);
  expect(fixed.points.M10.detectable).toBe(false);
  expect(intermittent.points.M10.detectable).toBe(true);
  expect(intermittent.points.M10.signature).toContain('间歇');
});
```

- [ ] **Step 2: Run the failing D matrix test**

Run:

```bash
npm test -- tests/diagnostic-testpoint-contract.spec.js -t "distinguishes multiple Gyro fault forms" --run
```

Expected: FAIL if the matrix rows do not expose `targetId` and structured point entries.

- [ ] **Step 3: Normalize diagnostic matrix rows**

In `public/model-packages/evtol_closed_loop_fault_demo.json`, ensure each D matrix row uses:

```json
{
  "faultId": "gyro_zero_bias_intermittent",
  "faultName": "Gyro 陀螺仪零偏 - 间歇故障",
  "targetId": "node-imu",
  "targetName": "IMU 陀螺仪反馈",
  "points": {
    "M3": {"detectable": true, "value": 1, "signature": "反馈均值出现间歇偏移"},
    "M4": {"detectable": true, "value": 1, "signature": "控制输出周期性补偿"},
    "M10": {"detectable": true, "value": 1, "signature": "间歇故障引起频谱侧带"}
  }
}
```

For `gyro_zero_bias_offset`, set `M10.detectable` to `false` with signature `固定偏差频谱变化不明显`.

- [ ] **Step 4: Run the D matrix test again**

Run:

```bash
npm test -- tests/diagnostic-testpoint-contract.spec.js -t "distinguishes multiple Gyro fault forms" --run
```

Expected: PASS.

- [ ] **Step 5: Run related diagnostic tests**

Run:

```bash
npm test -- tests/diagnostic-testpoint-contract.spec.js --run
```

Expected: PASS.

- [ ] **Step 6: Commit task 5**

```bash
git add public/model-packages/evtol_closed_loop_fault_demo.json tests/diagnostic-testpoint-contract.spec.js
git commit -m "feat: encode diagnostic matrix fault signatures"
```

### Task 6: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused app tests**

```bash
npm test -- tests/flight-model-package-app.spec.js tests/flight-model-package.spec.js tests/diagnostic-testpoint-contract.spec.js --run
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

```bash
npm test -- --run
```

Expected: PASS.

- [ ] **Step 3: Build production assets**

```bash
npm run build
```

Expected: PASS. The existing Vite chunk-size warning is acceptable unless a new build error appears.

- [ ] **Step 4: Check git diff**

```bash
git status --short --branch
git diff --check
```

Expected: only intentional changes are present. `Jigui_demo/` may remain untracked and should not be staged.

## Self-Review

Spec coverage:

- Component-owned capabilities: Task 1 and Task 2.
- Fault type templates vs active instances: Task 1 and Task 3.
- Drag/selection target compatibility: Task 4.
- Hidden-by-default fault labels and existing tag behavior: Task 3 preserves the existing fault tag bridge; Task 4 routes activation to the same bridge.
- Explicit parameter apply workflow: already implemented in the current working tree and covered by existing `requires explicit apply before fault tag parameter edits affect the runtime target` test.
- Reset clearing derived state: already partially implemented in current working tree; re-run full tests in Task 6 and add a targeted reset test if it regresses.
- Diagnostic matrix distinction for same-component faults: Task 5.

Completeness scan: every implementation step names concrete files, commands, and expected results.

Type consistency: this plan consistently uses `faultTypeCatalog`, `faultCapabilityMap`, `faultInstances`, `faultTypeId`, `targetKind`, `targetId`, `slotId`, `allowedFaultIds`, and existing compatibility fields `injectedFault`, `faultBindings`, and `faultTags`.
