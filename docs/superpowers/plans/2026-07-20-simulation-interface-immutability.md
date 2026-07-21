# 仿真组件接口不可修改 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 让仿真组件的名称及输入、输出、中间变量端口的名称、类型、数量在界面、保存和导入后都保持不可修改，同时不影响系统信号和测量仪器。

**Architecture:** 新增专用接口锁定服务，保存每个仿真组件的初始接口快照，并在工作区恢复和模型包导入时应用该快照。属性面板只展示接口定义，不再读取或保存接口字段；Python 绑定和新建组件会显式重建其接口快照。

**Tech Stack:** Vue 3、原生 DOM 属性面板、ES modules、Vitest、jsdom。

---

## 文件结构

- src/services/simulationInterfaceLockService.js：仿真组件接口快照的创建、初始化与恢复；仅处理 simulation_block。
- src/services/simulationPropertyPanelSchema.js：将仿真组件的接口字段渲染为只读，并从保存值中排除接口字段。
- src/services/workbenchSnapshotService.js：恢复快照时为仿真组件建立或恢复接口快照。
- src/services/flightModelPackageService.js：导入模型包时，对同 ID 的现有仿真组件保留接口；新组件以包内接口作为初始快照。
- src/services/legacyRuntimeBootstrap.js、src/services/legacy-runtime.txt：把锁定服务提供给运行时，并在新建、重新绑定或解绑 Python 接口后重建快照。
- tests/simulation-interface-lock-service.spec.js：锁定服务的单元测试。
- tests/simulation-property-panel-schema.spec.js、tests/workbench-snapshot.spec.js、tests/flight-model-package.spec.js、tests/property-panel-app.spec.js：属性面板、快照、导入和运行时的回归测试。

### Task 1: 添加接口锁定服务及其失败测试

**Files:**

- Create: src/services/simulationInterfaceLockService.js
- Create: tests/simulation-interface-lock-service.spec.js

- [ ] **Step 1: 编写失败测试，定义锁定快照和导入覆盖规则**

~~~js
import { describe, expect, it } from 'vitest';
import {
  initializeSimulationInterfaceLock,
  lockSimulationInterfaces
} from '../src/services/simulationInterfaceLockService.js';

function simulationNode(id, name, inputName = '输入 A') {
  return {
    id, type: 'simulation_block',
    props: {
      name,
      inputs: [{ name: inputName, type: '标量' }],
      outputs: [{ name: '输出 A', type: '向量' }],
      middleVars: [{ name: '状态 A', type: '标量' }]
    },
    pythonBinding: {
      bound: true,
      portMapping: {
        inputs: [{ displayName: inputName, type: 'float' }],
        outputs: [{ displayName: '输出 A', type: 'float' }],
        middleVars: [{ displayName: '状态 A', type: 'float' }]
      }
    }
  };
}

describe('simulation interface lock service', () => {
  it('restores a simulation component interface after direct mutations', () => {
    const node = initializeSimulationInterfaceLock(simulationNode('node-1', '控制器'));
    node.props.name = '被改名';
    node.props.inputs = [{ name: '被改名输入', type: '矩阵' }];
    node.pythonBinding.portMapping.outputs = [];

    const locked = lockSimulationInterfaces({ modelNodes: [node], modelEdges: [] });

    expect(locked.modelNodes[0].props).toMatchObject({
      name: '控制器',
      inputs: [{ name: '输入 A', type: '标量' }]
    });
    expect(locked.modelNodes[0].pythonBinding.portMapping.outputs).toEqual([
      { displayName: '输出 A', type: 'float' }
    ]);
  });

  it('keeps an existing simulation interface when an import reuses its id', () => {
    const current = initializeSimulationInterfaceLock(simulationNode('node-1', '原控制器'));
    const imported = simulationNode('node-1', '导入改名', '导入输入');
    const locked = lockSimulationInterfaces(
      { modelNodes: [imported], modelEdges: [] },
      { existingSnapshot: { modelNodes: [current], modelEdges: [] } }
    );

    expect(locked.modelNodes[0].props.name).toBe('原控制器');
    expect(locked.modelNodes[0].props.inputs[0]).toEqual({ name: '输入 A', type: '标量' });
  });
});
~~~

- [ ] **Step 2: 运行测试，确认因模块尚不存在而失败**

Run: npm test -- tests/simulation-interface-lock-service.spec.js

Expected: FAIL，提示无法解析 simulationInterfaceLockService.js。

- [ ] **Step 3: 实现最小锁定服务**

实现下列公共 API：

~~~js
export function initializeSimulationInterfaceLock(node, { replace = false } = {}) {}
export function lockSimulationInterfaces(snapshot = {}, { existingSnapshot = null } = {}) {}
~~~

initializeSimulationInterfaceLock 只处理 simulation_block。将 props.name、props.inputs、props.outputs、props.middleVars 及 Python 绑定的 portMapping.inputs、portMapping.outputs、portMapping.middleVars 深拷贝到 simulationInterfaceDefinition；已有定义时恢复这些字段，replace 为 true 时重建定义。

lockSimulationInterfaces 深拷贝快照，按节点 ID 查找 existingSnapshot 中的仿真组件定义；同 ID 节点使用既有定义，新节点使用自身定义初始化。它不得转换或修改任何非仿真组件。

- [ ] **Step 4: 运行锁定服务测试，确认通过**

Run: npm test -- tests/simulation-interface-lock-service.spec.js

Expected: PASS，2 个测试通过。

- [ ] **Step 5: 提交该原子改动**

~~~bash
git add src/services/simulationInterfaceLockService.js tests/simulation-interface-lock-service.spec.js
git commit -m "feat: lock simulation component interfaces"
~~~

### Task 2: 锁定属性面板并排除保存值

**Files:**

- Modify: src/services/simulationPropertyPanelSchema.js:65-276
- Modify: tests/simulation-property-panel-schema.spec.js:14-172

- [ ] **Step 1: 编写失败测试，断言接口控件不可编辑且保存不返回接口字段**

~~~js
it('renders a read-only simulation interface and saves only non-interface fields', () => {
  const node = {
    type: 'simulation_block',
    props: {
      name: '控制器', moduleType: '积分',
      inputs: [{ name: '误差', type: '标量' }],
      outputs: [{ name: '控制量', type: '向量' }],
      middleVars: [{ name: '积分项', type: '标量' }],
      ffunctionNote: 'old'
    }
  };
  document.body.innerHTML = renderSimulationBlockFieldsFromSchema(node, { moduleTypes, portFormats, interfaceLimits });

  expect(document.getElementById('prop-name').disabled).toBe(true);
  expect(document.getElementById('sim-input-count').disabled).toBe(true);
  expect(document.querySelector('[data-sim-field="name"]').disabled).toBe(true);
  expect(document.querySelector('[data-sim-field="type"]').disabled).toBe(true);

  document.getElementById('prop-ffunctionNote').value = ' new note ';
  expect(readSimulationBlockValuesFromPanel(node, document)).toEqual({
    values: { moduleType: '积分', ffunctionNote: 'new note' },
    shouldPruneInvalidEdges: false
  });
});
~~~

为已绑定 Python 组件增加断言：prop-name 和每个 data-python-port-display-name 都是 disabled，保存返回 values 为空、shouldPruneInvalidEdges 为 false。

- [ ] **Step 2: 运行测试，确认当前可编辑实现导致失败**

Run: npm test -- tests/simulation-property-panel-schema.spec.js

Expected: FAIL，当前组件名、数量与端口字段均可编辑，读取结果包含接口字段。

- [ ] **Step 3: 最小修改属性面板的渲染和读取逻辑**

在未绑定与 Python 已绑定页面中，为组件名、端口名、端口类型和三种端口数量控件加 disabled；删除“同步接口数量”按钮。未绑定组件保留 moduleType 和 ffunctionNote 的保存，已绑定组件不返回可写值：

~~~js
if (binding?.bound) {
  return { values: {}, shouldPruneInvalidEdges: false };
}

return {
  values: {
    moduleType: documentLike?.getElementById?.('prop-moduleType')?.value || props.moduleType,
    ffunctionNote: textValue(
      documentLike?.getElementById?.('prop-ffunctionNote')?.value,
      props.ffunctionNote || ''
    )
  },
  shouldPruneInvalidEdges: false
};
~~~

不要修改 propertyPanelSchema.js 的系统信号字段或任何 instrument_* 分支。

- [ ] **Step 4: 运行属性面板测试，确认通过**

Run: npm test -- tests/simulation-property-panel-schema.spec.js tests/property-panel-schema.spec.js

Expected: PASS；仿真组件测试验证只读，系统信号与测量仪器的通用属性面板测试继续通过。

- [ ] **Step 5: 提交该原子改动**

~~~bash
git add src/services/simulationPropertyPanelSchema.js tests/simulation-property-panel-schema.spec.js
git commit -m "feat: make simulation interfaces read-only"
~~~

### Task 3: 在快照和模型包导入时应用接口锁定

**Files:**

- Modify: src/services/workbenchSnapshotService.js:1-116
- Modify: src/services/flightModelPackageService.js:1-430
- Modify: src/services/legacyRuntimeBootstrap.js:110-150
- Modify: tests/workbench-snapshot.spec.js:1-78
- Modify: tests/flight-model-package.spec.js

- [ ] **Step 1: 编写失败测试，覆盖恢复与同 ID 导入**

在 workbench-snapshot.spec.js 添加：

~~~js
it('restores the persisted immutable interface definition', () => {
  const restored = restoreWorkbenchSnapshot({
    modelNodes: [{
      id: 'node-1', type: 'simulation_block',
      props: { name: '篡改名', inputs: [], outputs: [], middleVars: [] },
      simulationInterfaceDefinition: {
        name: '控制器',
        ports: { inputs: [{ name: '误差', type: '标量' }], outputs: [], middleVars: [] },
        pythonPortMapping: { inputs: [], outputs: [], middleVars: [] }
      }
    }],
    modelEdges: []
  });
  expect(restored.modelNodes[0].props.name).toBe('控制器');
  expect(restored.modelNodes[0].props.inputs).toEqual([{ name: '误差', type: '标量' }]);
});
~~~

在 flight-model-package.spec.js 构造现有工作区与同 ID 的导入包，并断言：

~~~js
const result = applyFlightModelPackage(importedPackage, { existingSnapshot });
expect(result.snapshot.modelNodes.find((node) => node.id === 'node-1').props.name).toBe('原控制器');
~~~

- [ ] **Step 2: 运行快照与模型包测试，确认失败**

Run: npm test -- tests/workbench-snapshot.spec.js tests/flight-model-package.spec.js

Expected: FAIL；现有恢复直接接受被篡改的属性，导入没有当前工作区接口上下文。

- [ ] **Step 3: 将锁定服务接入恢复和导入路径**

在 workbenchSnapshotService.js 的 normalizeNode 返回前调用 initializeSimulationInterfaceLock，使旧快照首次加载时捕获接口、带有定义的快照恢复时强制恢复接口。

在 flightModelPackageService.js 将函数签名改为：

~~~js
export function applyFlightModelPackage(pkg, { existingSnapshot = null } = {}) {
  // 保留现有验证、Python 绑定水合和模型归一化。
  const lockedSnapshot = lockSimulationInterfaces(normalizedSnapshot, { existingSnapshot });
  return { ok: true, snapshot: lockedSnapshot, descriptor, faultLibrary, diagnosticModel, pythonModules };
}
~~~

在 legacyRuntimeBootstrap.js 调用导入 API 前传入当前快照：

~~~js
const state = window.__GZ_STATE__ ?? {};
const result = applyFlightModelPackage(pkg, {
  existingSnapshot: createWorkbenchSnapshot(state)
});
~~~

这样新导入组件以包内接口为基线，同 ID 的已存在仿真组件始终保留原有接口；非仿真组件不经过锁定服务。

- [ ] **Step 4: 运行快照与模型包测试，确认通过**

Run: npm test -- tests/workbench-snapshot.spec.js tests/flight-model-package.spec.js

Expected: PASS，恢复和导入均保持仿真组件接口，现有模型包测试没有回归。

- [ ] **Step 5: 提交该原子改动**

~~~bash
git add src/services/workbenchSnapshotService.js src/services/flightModelPackageService.js src/services/legacyRuntimeBootstrap.js tests/workbench-snapshot.spec.js tests/flight-model-package.spec.js
git commit -m "feat: preserve simulation interfaces during import"
~~~

### Task 4: 在运行时新建和 Python 绑定后重建基线

**Files:**

- Modify: src/services/legacy-runtime.txt:7628-7669（Python 绑定/解绑）和 12398-12455（属性保存）；在文件末尾追加最终包装，确保覆盖此前所有同名包装
- Modify: src/services/legacyRuntimeBootstrap.js:218-240
- Modify: tests/property-panel-app.spec.js

- [ ] **Step 1: 编写失败 UI 测试，覆盖保存和 Python 重新绑定**

使用既有 property-panel-app.spec.js 运行时挂载帮助函数创建仿真组件，篡改其面板 DOM 的 prop-name 或端口元素后点击“保存设置”，断言：

~~~js
expect(node.props.name).toBe(originalName);
expect(node.props.inputs).toEqual(originalInputs);
expect(node.props.outputs).toEqual(originalOutputs);
expect(node.props.middleVars).toEqual(originalMiddleVars);
~~~

随后调用 Python 绑定确认流程，断言新的 simulationInterfaceDefinition.pythonPortMapping 等于绑定接口生成的 portMapping，而不是绑定前的端口定义。

- [ ] **Step 2: 运行 UI 测试，确认失败**

Run: npm test -- tests/property-panel-app.spec.js

Expected: FAIL；新节点没有基线，或重新绑定后仍保存旧接口快照。

- [ ] **Step 3: 在最终运行时包装层调用锁定服务**

将服务注入 window.__GZ_SIMULATION_INTERFACE_LOCK__。在最终的 createNode 包装中，若新增节点为 simulation_block，执行：

~~~js
node = window.__GZ_SIMULATION_INTERFACE_LOCK__
  .initializeSimulationInterfaceLock(node, { replace: true });
~~~

在 applyPythonBindingToNode 和 unbindPythonBinding 的最终包装中，在赋值 Python 绑定后使用 replace true 重建接口快照。让 applySimulationSchemaPropertyValues 只合并 Task 2 返回的非接口字段，并删除其对 portDisplayNames 的写入循环。

不修改 signal_source、flow_block 或任何 instrument_* 分支。

- [ ] **Step 4: 运行 UI 测试，确认通过**

Run: npm test -- tests/property-panel-app.spec.js tests/simulation-property-panel-schema.spec.js

Expected: PASS；保存与重新绑定均维持完整接口锁定，其他属性面板测试正常。

- [ ] **Step 5: 提交该原子改动**

~~~bash
git add src/services/legacy-runtime.txt src/services/legacyRuntimeBootstrap.js tests/property-panel-app.spec.js
git commit -m "feat: lock runtime simulation component interfaces"
~~~

### Task 5: 全量回归与构建验证

**Files:**

- Verify: src/services/simulationInterfaceLockService.js
- Verify: src/services/simulationPropertyPanelSchema.js
- Verify: src/services/workbenchSnapshotService.js
- Verify: src/services/flightModelPackageService.js
- Verify: src/services/legacy-runtime.txt

- [ ] **Step 1: 运行全部前端测试**

Run: npm test -- --run

Expected: PASS，所有 Vitest 测试通过。

- [ ] **Step 2: 构建前端产物**

Run: npm run build

Expected: exit code 0，Vite 构建成功。

- [ ] **Step 3: 检查本次变更的空白与范围**

Run: git diff --check -- src/services/simulationInterfaceLockService.js src/services/simulationPropertyPanelSchema.js src/services/workbenchSnapshotService.js src/services/flightModelPackageService.js src/services/legacyRuntimeBootstrap.js src/services/legacy-runtime.txt tests/simulation-interface-lock-service.spec.js tests/simulation-property-panel-schema.spec.js tests/workbench-snapshot.spec.js tests/flight-model-package.spec.js tests/property-panel-app.spec.js

Expected: 无输出；变更仅覆盖仿真组件接口锁定及其测试。

- [ ] **Step 4: 提交验证后的实现**

~~~bash
git status --short
git add src/services/simulationInterfaceLockService.js src/services/simulationPropertyPanelSchema.js src/services/workbenchSnapshotService.js src/services/flightModelPackageService.js src/services/legacyRuntimeBootstrap.js src/services/legacy-runtime.txt tests/simulation-interface-lock-service.spec.js tests/simulation-property-panel-schema.spec.js tests/workbench-snapshot.spec.js tests/flight-model-package.spec.js tests/property-panel-app.spec.js
git commit -m "test: verify immutable simulation interfaces"
~~~
