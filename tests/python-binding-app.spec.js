import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { createSimulationBlockPythonBinding } from '../src/composables/useWorkbenchState.js';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

const parsedInterface = {
  fileName: 'pid_controller.py',
  moduleName: 'pid_controller',
  description: 'PID controller',
  entryFunction: 'process',
  inputs: [
    { name: 'error', type: 'float', default: null, comment: 'error signal' },
    { name: 'dt', type: 'float', default: '0.01', comment: 'step' }
  ],
  outputs: [
    { name: 'output_0', type: 'float', comment: 'control' }
  ],
  middleVars: [
    { name: 'integral', type: 'float', comment: 'integral state' }
  ],
  rawSource: 'def process(error, dt=0.01): return error'
};

const PACKAGE_AUTHORED_MODEL_ID = 'package-authored-model';
const PACKAGE_AUTHORED_MODEL_NAME = 'Package Authored Model';

function createPackageAuthoredFixture() {
  return {
    schemaVersion: 1,
    packageType: 'flight-control-model',
    modelId: PACKAGE_AUTHORED_MODEL_ID,
    modelName: PACKAGE_AUTHORED_MODEL_NAME,
    description: 'Package-authored simulation block fixture',
    source: { origin: 'python-binding-app-test' },
    pythonModules: [
      {
        moduleId: 'pid_controller',
        fileName: 'pid_controller.py',
        entryFunction: 'process',
        category: 'control',
        sourcePackageId: PACKAGE_AUTHORED_MODEL_ID,
        sourcePackageName: PACKAGE_AUTHORED_MODEL_NAME,
        source: parsedInterface.rawSource,
        parsedInterface
      }
    ],
    faultLibrary: [],
    workbenchSnapshot: {
      schemaVersion: 1,
      modelNodes: [
        {
          id: 'node-package-1',
          type: 'simulation_block',
          x: 420,
          y: 320,
          props: {
            name: 'Package PID',
            moduleType: 'control',
            inputs: [{ name: 'Error', type: 'scalar' }],
            outputs: [{ name: 'Output', type: 'scalar' }],
            middleVars: [{ name: 'Integral', type: 'scalar' }]
          },
          pythonBinding: createSimulationBlockPythonBinding(parsedInterface, {
            moduleCategory: 'control',
            sourcePackageId: PACKAGE_AUTHORED_MODEL_ID,
            sourcePackageName: PACKAGE_AUTHORED_MODEL_NAME,
            executionMode: 'backend'
          })
        }
      ],
      modelEdges: [],
      nodeSeq: 1,
      edgeSeq: 0,
      activeLineType: 'normal',
      faultedBlks: [],
      importedFaultModels: []
    }
  };
}

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

function dispatchPointer(target, type, init = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: init.pointerId ?? 1,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0
  });
  target.dispatchEvent(event);
}

function dispatchClick(target) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('Python binding app integration', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('binds a simulation block and rebuilds visible ports on the canvas', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(typeof window.createNode).toBe('function');

    window.createNode('simulation_block', 420, 320);
    await flushRuntime();

    const simBlock = document.querySelector('.blk.b-sim');
    expect(simBlock).not.toBeNull();
    expect(simBlock?.querySelectorAll('.node-port').length).toBeGreaterThanOrEqual(2);

    const simId = simBlock.id.replace('b-', '');
    window.dispatchEvent(
      new CustomEvent('gz:python-binding-confirm', {
        detail: {
          nodeId: simId,
          binding: createSimulationBlockPythonBinding(parsedInterface)
        }
      })
    );

    await flushRuntime();

    const reboundBlock = document.getElementById(`b-${simId}`);
    expect(reboundBlock?.className).toContain('python-bound');
    expect(reboundBlock?.textContent).toContain('pid_controller.py');
    expect(reboundBlock?.querySelectorAll('.node-port--input').length).toBe(2);
    expect(reboundBlock?.querySelectorAll('.node-port--output:not(.node-port--top)').length).toBe(1);
    expect(reboundBlock?.querySelectorAll('.node-port--top').length).toBe(1);
    const portLabels = [...reboundBlock.querySelectorAll('.node-port__label')].map((item) => item.textContent);
    expect(portLabels).toEqual(expect.arrayContaining(['error signal', 'step', 'control', 'integral state']));
    expect(reboundBlock?.querySelectorAll('button.node-port').length).toBe(4);

    const inputPorts = [...reboundBlock.querySelectorAll('.node-port--input')];
    const outputPorts = [...reboundBlock.querySelectorAll('.node-port--output')];
    expect(inputPorts[0]?.getAttribute('title')).toContain('error');
    expect(inputPorts[1]?.getAttribute('title')).toContain('dt');
    expect(outputPorts[0]?.getAttribute('title')).toContain('output_0');
    expect(outputPorts[1]?.getAttribute('title')).toContain('integral');
    expect(reboundBlock?.querySelector('.node-port .node-port__inner')).not.toBeNull();

    wrapper.unmount();
  });

  it('creates a blank workspace that allows direct modeling and saving', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(typeof window.doCreateBlankWorkspace).toBe('function');

    window.doCreateBlankWorkspace();
    await flushRuntime();

    expect(window.__GZ_STATE__.sysLoaded).toBe(true);
    expect(window.__GZ_STATE__.workspaceSource).toBe('blank');
    expect(document.getElementById('stxt')?.textContent).toContain('空白模型工作区');

    window.createNode('simulation_block', 420, 320);
    await flushRuntime();

    expect(window.__GZ_STATE__.modelNodes).toHaveLength(1);

    window.doSaveSys();
    await flushRuntime();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(setItemSpy).toHaveBeenCalled();
    expect(window.__GZ_STATE__.workspaceSource).toBe('blank');

    wrapper.unmount();
    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('restores blank workspace mode from a saved snapshot without falling back to legacy mode', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    await flushRuntime();
    window.createNode('signal_source', 320, 220);
    await flushRuntime();

    const snapshot = window.__GZ_WORKBENCH_SNAPSHOT__.createWorkbenchSnapshot(window.__GZ_STATE__);
    expect(snapshot.workspaceSource).toBe('blank');

    window.__GZ_STATE__.workspaceSource = 'legacy';
    window.restoreSystemModelSnapshot(snapshot);
    await flushRuntime();

    expect(window.__GZ_STATE__.workspaceSource).toBe('blank');
    expect(document.getElementById('stxt')?.textContent?.length || 0).toBeGreaterThan(0);

    wrapper.unmount();
  });

  it('shows both import and blank-workspace actions in the empty state', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const empty = document.getElementById('empty');
    expect(empty?.textContent).toContain('导入系统模型');
    expect(empty?.textContent).toContain('新建空白模型');
    expect(document.getElementById('btn-new-sys')).not.toBeNull();
    expect(document.getElementById('btn-reset-sys')).not.toBeNull();

    wrapper.unmount();
  });

  it('persists python binding snapshots when saving the system model', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    window.__GZ_STATE__.sysLoaded = true;

    window.createNode('simulation_block', 420, 320);
    await flushRuntime();

    const simBlock = document.querySelector('.blk.b-sim');
    const simId = simBlock.id.replace('b-', '');

    window.dispatchEvent(
      new CustomEvent('gz:python-binding-confirm', {
        detail: {
          nodeId: simId,
          binding: createSimulationBlockPythonBinding(parsedInterface, { executionMode: 'backend' })
        }
      })
    );
    await flushRuntime();

    expect(window.__GZ_STATE__.sysLoaded).toBe(true);
    expect(window.__GZ_STATE__.modelNodes).toHaveLength(1);
    window.doSaveSys();
    await flushRuntime();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(setItemSpy).toHaveBeenCalled();
    const snapshot = JSON.parse(window.localStorage.getItem('gz-workbench-system-model'));
    expect(snapshot.modelNodes).toHaveLength(1);
    expect(snapshot.modelNodes[0].pythonBinding.fileName).toBe('pid_controller.py');
    expect(snapshot.modelNodes[0].pythonBinding.executionMode).toBe('backend');

    wrapper.unmount();
    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('keeps backend execution mode and source package on an imported package-authored simulation block', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = createPackageAuthoredFixture();

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.modelNodes[0].pythonBinding.executionMode).toBe('backend');
    expect(window.__GZ_STATE__.modelNodes[0].pythonBinding.sourcePackageId).toBe(PACKAGE_AUTHORED_MODEL_ID);

    wrapper.unmount();
  });

  it('does not label a locally bound simulation block as package-authored when provenance is missing', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(createPackageAuthoredFixture());
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    window.createNode('simulation_block', 620, 320);
    await flushRuntime();

    const localSimulationNode = [...window.__GZ_STATE__.modelNodes].reverse().find((node) => node.type === 'simulation_block');
    window.dispatchEvent(
      new CustomEvent('gz:python-binding-confirm', {
        detail: {
          nodeId: localSimulationNode.id,
          binding: createSimulationBlockPythonBinding(parsedInterface, {
            moduleCategory: 'control',
            executionMode: 'backend'
          })
        }
      })
    );
    await flushRuntime();

    window.selectNode(localSimulationNode.id);
    await flushRuntime();

    const inspector = document.getElementById('pd');
    expect(inspector?.textContent).toContain('未关联模型包');
    expect(inspector?.textContent).not.toContain(PACKAGE_AUTHORED_MODEL_NAME);
    expect(inspector?.textContent).toContain('backend');

    wrapper.unmount();
  });

  it('drags a node after it is created on the canvas', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('flow_block', 420, 320);
    await flushRuntime();

    const flowBlock = document.querySelector('.blk.b-flow');
    const flowId = flowBlock.id;
    const viewport = document.getElementById('canvas-viewport');
    const beforeLeft = flowBlock.style.left;
    const beforeTop = flowBlock.style.top;

    dispatchPointer(flowBlock, 'pointerdown', { clientX: 420, clientY: 320, pointerId: 9 });
    dispatchPointer(viewport, 'pointermove', { clientX: 500, clientY: 380, pointerId: 9 });
    dispatchPointer(viewport, 'pointerup', { clientX: 500, clientY: 380, pointerId: 9 });
    await flushRuntime();

    const movedBlock = document.getElementById(flowId);
    expect(movedBlock.style.left).not.toBe(beforeLeft);
    expect(movedBlock.style.top).not.toBe(beforeTop);

    wrapper.unmount();
  });

  it('shows clean Chinese subtitle text for an unbound simulation block', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('simulation_block', 420, 320);
    await flushRuntime();

    const simBlock = document.querySelector('.blk.b-sim');
    expect(simBlock?.textContent).toContain('仿真块 1');
    expect(simBlock?.textContent).toContain('1输入');
    expect(simBlock?.textContent).toContain('1输出');
    expect(simBlock?.textContent).toContain('一阶函数');
    expect(simBlock?.textContent).not.toContain('鍧');
    expect(simBlock?.textContent).not.toContain('杈');

    wrapper.unmount();
  });

  it('shows Chinese workbench controls and does not leak template code in the signal source inspector', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(document.getElementById('btn-imp-sys')?.textContent).toContain('导入系统模型');
    expect(document.getElementById('btn-imp-sys')?.textContent).not.toContain('Import System Model');
    expect(document.querySelector('[data-component=\"middle_var_assign\"]')?.textContent).toContain('中间变量赋值块');

    window.createNode('signal_source', 360, 260);
    await flushRuntime();

    const signalNode = document.querySelector('.blk.b-source');
    const signalId = signalNode.id.replace('b-', '');
    window.selectNode(signalId);
    await flushRuntime();

    const inspector = document.getElementById('pd');
    expect(inspector?.textContent).toContain('信号定义');
    expect(inspector?.textContent).toContain('模块名称');
    expect(inspector?.textContent).not.toContain("}else if(node.type==='flow_block')");

    wrapper.unmount();
  });

  it('does not show Python binding actions when a flow block is selected', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('flow_block', 360, 260);
    await flushRuntime();

    const flowNode = document.querySelector('.blk.b-flow');
    const flowId = flowNode.id.replace('b-', '');
    window.selectNode(flowId);
    await flushRuntime();

    const inspector = document.getElementById('pd');
    expect(inspector?.textContent).not.toContain('绑定 Python 文件');
    expect(inspector?.textContent).not.toContain('重新绑定 Python');

    wrapper.unmount();
  });

  it('shows a clean Chinese success toast after creating an edge', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('signal_source', 240, 220);
    window.createNode('instrument_scope', 520, 220);
    await flushRuntime();

    const sourcePort = document.querySelector('.blk.b-source .node-port--output');
    const scopePort = document.querySelector('.blk.b-inst .node-port--input');
    dispatchClick(sourcePort);
    dispatchClick(scopePort);
    await flushRuntime();

    expect(document.getElementById('tm')?.textContent).toContain('连线已创建');
    expect(document.getElementById('ti')?.textContent).toBe('成功');
    expect(document.getElementById('ti')?.textContent).not.toContain('鉁');

    wrapper.unmount();
  });

  it('shows a clean duplicate-edge warning when creating the same edge twice', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('signal_source', 240, 220);
    window.createNode('instrument_scope', 520, 220);
    await flushRuntime();

    const sourcePort = document.querySelector('.blk.b-source .node-port--output');
    const scopePort = document.querySelector('.blk.b-inst .node-port--input');

    dispatchClick(sourcePort);
    dispatchClick(scopePort);
    await flushRuntime();

    dispatchClick(sourcePort);
    dispatchClick(scopePort);
    await flushRuntime();

    expect(document.getElementById('tm')?.textContent).toContain('该连线已存在');
    expect(document.getElementById('ti')?.textContent).toBe('提示');

    wrapper.unmount();
  });

  it('shows a clean occupied-input warning when a second source targets the same scope input', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('signal_source', 220, 220);
    window.createNode('signal_source', 220, 360);
    window.createNode('instrument_scope', 560, 260);
    await flushRuntime();

    const sourcePorts = document.querySelectorAll('.blk.b-source .node-port--output');
    const scopePort = document.querySelector('.blk.b-inst .node-port--input');

    dispatchClick(sourcePorts[0]);
    dispatchClick(scopePort);
    await flushRuntime();

    dispatchClick(sourcePorts[1]);
    dispatchClick(scopePort);
    await flushRuntime();

    expect(document.getElementById('tm')?.textContent).toContain('该输入端口已有连线，请先删除原连线，避免信号耦合');
    expect(document.getElementById('ti')?.textContent).toBe('提示');

    wrapper.unmount();
  });

  it('shows a clean import-fault precheck warning when no system components exist', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.__GZ_STATE__.sysLoaded = true;
    window.doImportFault();
    await flushRuntime();

    expect(document.getElementById('tm')?.textContent).toContain('请先导入包含模块和连线的系统模型');
    expect(document.getElementById('ti')?.textContent).toBe('提示');

    wrapper.unmount();
  });

  it('shows a clean Chinese inspector for the scope instrument', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('instrument_scope', 380, 260);
    await flushRuntime();

    const scopeNode = document.querySelector('.blk.b-inst');
    const scopeId = scopeNode.id.replace('b-', '');
    window.selectNode(scopeId);
    await flushRuntime();

    const inspector = document.getElementById('pd');
    expect(inspector?.querySelector('[data-scope-panel="oscilloscope"]')).not.toBeNull();
    expect(inspector?.textContent).toContain('示波器配置');
    expect(inspector?.textContent).toContain('模块名称');
    expect(inspector?.textContent).toContain('采样率');
    expect(inspector?.textContent).toContain('通道说明');
    expect(inspector?.textContent).toContain('查看波形');

    wrapper.unmount();
  });

  it('applies a middle variable assignment block to a simulation block state', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.__GZ_STATE__.sysLoaded = true;

    window.createNode('signal_source', 220, 220);
    window.createNode('simulation_block', 480, 240);
    window.createNode('middle_var_assign', 320, 380);
    window.createNode('instrument_scope', 760, 240);
    await flushRuntime();

    const nodes = window.__GZ_STATE__.modelNodes;
    const simNode = nodes.find((node) => node.type === 'simulation_block');
    const assignNode = nodes.find((node) => node.type === 'middle_var_assign');
    const scopeNode = nodes.find((node) => node.type === 'instrument_scope');

    simNode.props.moduleType = '积分';
    simNode.props.outputs = [{ name: '输出 1', type: '标量' }];
    simNode.props.middleVars = [{ name: '积分状态', type: '标量' }];
    assignNode.props.targetNodeId = simNode.id;
    assignNode.props.targetVarName = '积分状态';
    assignNode.props.assignMode = 'constant';
    assignNode.props.constantValue = '5';

    window.__GZ_STATE__.modelEdges.push({
      id: 'edge-test-scope',
      lineType: 'normal',
      sourceNodeId: simNode.id,
      targetNodeId: scopeNode.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });

    window.simInit(true);
    window.simStep();
    await flushRuntime();

    const samples = window.__GZ_SIM__?.actual?.scopeSamples?.[scopeNode.id]?.ch1 ?? [];
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.at(-1)?.actual).toBeCloseTo(5, 6);

    wrapper.unmount();
  });
});
