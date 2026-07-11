import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import App from '../src/App.vue';
import { createSimulationBlockPythonBinding } from '../src/composables/useWorkbenchState.js';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';
import { createWorkbenchSnapshot } from '../src/services/workbenchSnapshotService.js';

const MODEL_ID = 'evtol-small-nonlinear';
const MODEL_NAME = 'eVTOL Small Nonlinear Flight Control';

const parsedInterface = {
  fileName: 'attitude_pid.py',
  moduleName: 'attitude_pid',
  description: 'Attitude PID controller',
  entryFunction: 'process',
  inputs: [
    { name: 'pitch_error', type: 'float', default: null, comment: 'pitch error' }
  ],
  outputs: [
    { name: 'elevator_cmd', type: 'float', comment: 'elevator command' }
  ],
  middleVars: [
    { name: 'integral_state', type: 'float', comment: 'integral accumulator' }
  ],
  rawSource: 'def process(pitch_error):\n  return pitch_error'
};

const binding = createSimulationBlockPythonBinding(parsedInterface, {
  moduleCategory: 'control',
  sourcePackageId: MODEL_ID,
  sourcePackageName: MODEL_NAME,
  executionMode: 'backend'
});

const PACKAGE_FIXTURE = {
  schemaVersion: 1,
  packageType: 'flight-control-model',
  modelId: MODEL_ID,
  modelName: MODEL_NAME,
  description: 'Reference eVTOL controller package',
  source: {
    origin: 'test-fixture'
  },
  pythonModules: [
    {
      moduleId: 'attitude_pid',
      fileName: 'attitude_pid.py',
      entryFunction: 'process',
      category: 'control',
      sourcePackageId: MODEL_ID,
      sourcePackageName: MODEL_NAME,
      source: parsedInterface.rawSource,
      parsedInterface
    }
  ],
  faultLibrary: [
    {
      id: 'fault-actuator-saturation',
      name: 'Actuator Saturation Fault',
      layer: 'physical',
      desc: 'Constrains actuator output to emulate saturation.',
      tags: ['Saturation', 'physical'],
      createdAt: '2026-04-16',
      origin: 'package'
    }
  ],
  workbenchSnapshot: createWorkbenchSnapshot({
    modelNodes: [
      {
        id: 'node-1',
        type: 'simulation_block',
        x: 360,
        y: 240,
        props: {
          name: 'Attitude PID',
          moduleType: 'control',
          inputs: [{ name: 'Pitch Error', type: 'scalar' }],
          outputs: [{ name: 'Elevator Command', type: 'scalar' }],
          middleVars: [{ name: 'Integral State', type: 'scalar' }]
        },
        pythonBinding: binding
      }
    ],
    modelEdges: [],
    nodeSeq: 1,
    edgeSeq: 0,
    activeLineType: 'normal',
    faultedBlks: [],
    importedFaultModels: []
  })
};

const LEAN_PACKAGE_FIXTURE = {
  ...PACKAGE_FIXTURE,
  workbenchSnapshot: createWorkbenchSnapshot({
    modelNodes: [
      {
        id: 'node-lean-1',
        type: 'simulation_block',
        x: 300,
        y: 200,
        props: {
          name: 'Lean Attitude PID',
          moduleType: 'control',
          inputs: [{ name: 'Pitch Error', type: 'scalar' }],
          outputs: [{ name: 'Elevator Command', type: 'scalar' }],
          middleVars: [{ name: 'Integral State', type: 'scalar' }]
        },
        pythonBinding: {
          bound: true,
          moduleId: 'attitude_pid',
          fileName: 'attitude_pid.py'
        }
      }
    ],
    modelEdges: [],
    nodeSeq: 1,
    edgeSeq: 0,
    activeLineType: 'normal',
    faultedBlks: [],
    importedFaultModels: []
  })
};

const DUPLICATE_MODULE_PACKAGE_FIXTURE = {
  ...PACKAGE_FIXTURE,
  pythonModules: [
    PACKAGE_FIXTURE.pythonModules[0],
    {
      ...PACKAGE_FIXTURE.pythonModules[0],
      fileName: 'attitude_pid_copy.py'
    }
  ]
};

const MISSING_MODULE_PACKAGE_FIXTURE = {
  ...PACKAGE_FIXTURE,
  pythonModules: [],
  workbenchSnapshot: createWorkbenchSnapshot({
    modelNodes: [
      {
        id: 'node-missing-1',
        type: 'simulation_block',
        x: 320,
        y: 220,
        props: {
          name: 'Missing Module PID',
          moduleType: 'control',
          inputs: [{ name: 'Pitch Error', type: 'scalar' }],
          outputs: [{ name: 'Elevator Command', type: 'scalar' }],
          middleVars: []
        },
        pythonBinding: {
          bound: true,
          moduleId: 'missing_controller',
          fileName: 'missing_controller.py'
        }
      }
    ],
    modelEdges: [],
    nodeSeq: 1,
    edgeSeq: 0,
    activeLineType: 'normal',
    faultedBlks: [],
    importedFaultModels: []
  })
};

const SIGNAL_ROUTING_PACKAGE_FIXTURE = {
  schemaVersion: 1,
  packageType: 'flight-control-model',
  modelId: 'signal-routing-demo',
  modelName: 'Signal Routing Demo',
  description: 'Branching and utility block demo package',
  source: {
    origin: 'test-fixture'
  },
  pythonModules: [],
  faultLibrary: [],
  workbenchSnapshot: createWorkbenchSnapshot({
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
          { id: 'node-source', type: 'signal_source', x: 120, y: 140, w: 164, h: 84, props: { name: 'Source', waveType: '常值', amplitude: '1', frequency: '0', outputFormat: '标量' } },
          { id: 'node-gain', type: 'gain_block', x: 360, y: 120, w: 156, h: 84, props: { name: 'Gain', gain: '0.5', inputFormat: '标量', outputFormat: '标量' } },
          { id: 'node-scope', type: 'instrument_scope', x: 640, y: 120, w: 150, h: 74, props: { name: 'Scope', instrumentType: '示波器', sampleRate: '64kHz', signal: '输出' } },
          { id: 'node-sum', type: 'sum_block', x: 360, y: 280, w: 164, h: 88, props: { name: 'Sum', inputCount: 2, signs: ['+', '+'], outputFormat: '标量' } },
          { id: 'node-mux', type: 'mux_block', x: 640, y: 280, w: 164, h: 88, props: { name: 'Mux', inputCount: 2, outputFormat: '向量' } }
        ],
        edges: [
          { id: 'edge-source-gain', lineType: 'normal', sourceNodeId: 'node-source', targetNodeId: 'node-gain', sourcePortIndex: 0, targetPortIndex: 0 },
          { id: 'edge-source-scope', lineType: 'normal', sourceNodeId: 'node-source', targetNodeId: 'node-scope', sourcePortIndex: 0, targetPortIndex: 0 },
          { id: 'edge-gain-sum', lineType: 'normal', sourceNodeId: 'node-gain', targetNodeId: 'node-sum', sourcePortIndex: 0, targetPortIndex: 0 },
          { id: 'edge-source-sum', lineType: 'normal', sourceNodeId: 'node-source', targetNodeId: 'node-sum', sourcePortIndex: 0, targetPortIndex: 1 },
          { id: 'edge-source-mux', lineType: 'normal', sourceNodeId: 'node-source', targetNodeId: 'node-mux', sourcePortIndex: 0, targetPortIndex: 0 },
          { id: 'edge-sum-mux', lineType: 'normal', sourceNodeId: 'node-sum', targetNodeId: 'node-mux', sourcePortIndex: 0, targetPortIndex: 1 }
        ]
      }
    },
    nodeSeq: 5,
    edgeSeq: 6,
    activeLineType: 'normal',
    faultedBlks: [],
    importedFaultModels: []
  })
};

function loadPublicPackage(fileName) {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const targetPath = path.resolve(testDir, '..', 'public', 'model-packages', fileName);

  return JSON.parse(readFileSync(targetPath, 'utf8'));
}

function mockNextJsonFileSelection(fileText) {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click() {
    Object.defineProperty(this, 'files', {
      configurable: true,
      value: [
        {
          name: 'model-package.json',
          text: async () => fileText
        }
      ]
    });
    this.onchange?.(new Event('change'));
  });
}

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}


async function injectFaultFromCatalog(faultId) {
  window.doImportFault();
  await flushRuntime();
  window.selectFaultCatalogModel(faultId);
  await flushRuntime();
  window.confirmImportFault();
  await flushRuntime();
}

function targetHasFaultRef(target, faultId) {
  if (!target) {
    return false;
  }
  const matches = (entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    return entry.id === faultId
      || entry.modelId === faultId
      || entry.faultId === faultId
      || entry.faultModelId === faultId
      || entry.faultTypeId === faultId;
  };
  return matches(target.fault)
    || matches(target.injectedFault)
    || ['faults', 'faultBindings', 'activeFaults', 'faultInstances', 'appliedFaults', 'selectedFaults']
      .some((key) => Array.isArray(target[key]) && target[key].some(matches));
}

describe('Flight model package app integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('imports and exports a flight model package through the legacy runtime bridge', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(typeof window.__GZ_FLIGHT_MODEL_PACKAGE__?.importObject).toBe('function');
    expect(typeof window.__GZ_FLIGHT_MODEL_PACKAGE__?.exportCurrent).toBe('function');

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(PACKAGE_FIXTURE);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.modelNodes).toHaveLength(1);
    expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
      modelId: MODEL_ID,
      modelName: MODEL_NAME
    });
    expect(window.__GZ_STATE__.availableFaultModels.some((model) => model.id === 'fault-actuator-saturation')).toBe(false);
    expect(window.__GZ_STATE__.availableFaultModels.some((model) => model.id === 'physical_parameter_bias')).toBe(true);
    expect(document.getElementById('tm')?.textContent).toContain(`飞控模型包“${MODEL_NAME}”已导入`);

    window.__GZ_STATE__.diagnosticTestPoints = [
      { pointId: 'tp-export-fixed', edgeId: 'edge-export', name: 'Export fixed point' }
    ];
    window.__GZ_STATE__.manualDiagnosticTestPoints = [
      { pointId: 'tp-export-manual', edgeId: 'edge-manual', name: 'Export manual point' }
    ];
    window.__GZ_STATE__.installedDiagnosticTestPointIds = ['tp-export-fixed', 'tp-export-manual'];

    const exportedPackage = window.__GZ_FLIGHT_MODEL_PACKAGE__.exportCurrent();

    expect(exportedPackage.modelId).toBe(MODEL_ID);
    expect(exportedPackage.pythonModules[0].moduleId).toBe('attitude_pid');
    expect(exportedPackage.workbenchSnapshot.modelNodes[0].pythonBinding.sourcePackageId).toBe(MODEL_ID);
    expect(exportedPackage.workbenchSnapshot.diagnosticTestPoints).toEqual([
      { pointId: 'tp-export-fixed', edgeId: 'edge-export', name: 'Export fixed point' }
    ]);
    expect(exportedPackage.workbenchSnapshot.manualDiagnosticTestPoints).toEqual([
      { pointId: 'tp-export-manual', edgeId: 'edge-manual', name: 'Export manual point' }
    ]);
    expect(exportedPackage.workbenchSnapshot.installedDiagnosticTestPointIds).toEqual(['tp-export-fixed', 'tp-export-manual']);

    window.__GZ_STATE__.diagnosticTestPoints = [];
    window.__GZ_STATE__.manualDiagnosticTestPoints = [];
    window.__GZ_STATE__.installedDiagnosticTestPointIds = [];
    const reimportResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(exportedPackage);
    await flushRuntime();

    expect(reimportResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.diagnosticTestPoints).toEqual([
      { pointId: 'tp-export-fixed', edgeId: 'edge-export', name: 'Export fixed point' }
    ]);
    expect(window.__GZ_STATE__.manualDiagnosticTestPoints).toEqual([
      { pointId: 'tp-export-manual', edgeId: 'edge-manual', name: 'Export manual point' }
    ]);
    expect(window.__GZ_STATE__.installedDiagnosticTestPointIds).toEqual(['tp-export-fixed', 'tp-export-manual']);

    wrapper.unmount();
  });

  it('does not register fault types while importing a model package', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(PACKAGE_FIXTURE);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.availableFaultModels.map((model) => model.id)).not.toContain('fault-actuator-saturation');
    expect((window.__GZ_STATE__.faultLibrary || []).map((model) => model.id)).not.toContain('fault-actuator-saturation');

    wrapper.unmount();
  });


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
    expect(window.__GZ_COMPONENT_LIBRARY__.flow_block).not.toHaveProperty('group');

    wrapper.unmount();
  });







  it('records signal-edge injections for electrical line fault slots', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = {
      schemaVersion: '3.0',
      modelInfo: {
        modelId: 'signal-edge-runtime',
        modelName: 'Signal Edge Runtime'
      },
      systemModel: {
        nodes: [
          {
            id: 'node-source',
            type: 'simulation_block',
            x: 240,
            y: 180,
            props: {
              name: 'Source',
              inputs: [],
              outputs: [{ name: 'Command', type: 'scalar' }],
              middleVars: []
            }
          },
          {
            id: 'node-sink',
            type: 'simulation_block',
            x: 560,
            y: 180,
            props: {
              name: 'Sink',
              inputs: [{ name: 'Command', type: 'scalar' }],
              outputs: [],
              middleVars: []
            }
          }
        ],
        edges: [
          {
            id: 'edge-command',
            sourceNodeId: 'node-source',
            targetNodeId: 'node-sink',
            sourcePortIndex: 0,
            targetPortIndex: 0,
            lineType: 'normal',
            signalId: 'cmd.signal'
          }
        ]
      },
      faultTypeCatalog: [
        {
          id: 'edge_signal_bias',
          displayName: 'Edge signal bias',
          layer: 'electrical',
          runtimeBehavior: 'additive_bias',
          defaultParameters: { bias: 0.1 }
        }
      ],
      faultCapabilityMap: [
        {
          targetKind: 'edge',
          targetId: 'edge-command',
          faultSlots: [
            {
              slotId: 'electrical:edge-command-signal',
              slotName: 'Command signal',
              layer: 'electrical',
              signalId: 'cmd.signal',
              bindingObject: 'cmd.signal',
              targetVariable: 'cmd.signal',
              targetField: 'signal.value',
              allowedFaultIds: ['edge_signal_bias']
            }
          ]
        }
      ],
      faultInstances: [],
      diagnosticModel: {
        testPoints: [],
        detectabilityMatrix: []
      },
      componentTemplates: [],
      pythonModules: []
    };

    const applyResult = window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__(pkg);
    await flushRuntime();

    expect(applyResult?.ok).not.toBe(false);
    const edge = window.__GZ_STATE__.modelEdges.find((item) => item.id === 'edge-command');
    const result = window.activateFaultForTarget(edge, 'edge_signal_bias', {}, { layer: 'electrical' });
    await flushRuntime();

    expect(result.ok).toBe(true);
    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      faultTypeId: 'edge_signal_bias',
      targetKind: 'edge',
      injectionForm: 'signal-edge',
      bindingObject: 'cmd.signal',
      targetVariable: 'cmd.signal'
    }));
    expect(edge.injectedFault).toMatchObject({
      modelId: 'edge_signal_bias',
      injectionForm: 'signal-edge',
      bindingObject: 'cmd.signal',
      targetVariable: 'cmd.signal'
    });

    wrapper.unmount();
  });

  it('uses authored fault slots to offer only target-compatible faults', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = {
      schemaVersion: '3.0',
      modelInfo: {
        modelId: 'authoring-runtime',
        modelName: '人工扩展运行模型'
      },
      systemModel: {
        nodes: [
          {
            id: 'node-imu',
            type: 'simulation_block',
            x: 240,
            y: 180,
            props: {
              name: 'IMU 陀螺仪反馈',
              inputs: [],
              outputs: [{ name: '角速度反馈', type: 'scalar' }],
              middleVars: []
            },
            faultSlots: [
              {
                slotId: 'gyro-feedback',
                signalName: '角速度反馈',
                allowedFaultTypeIds: ['sensor_additive_bias']
              }
            ]
          },
          {
            id: 'node-controller',
            type: 'simulation_block',
            x: 520,
            y: 180,
            props: {
              name: '姿态控制器',
              inputs: [],
              outputs: [],
              middleVars: []
            },
            faultSlots: []
          }
        ],
        edges: []
      },
      faultTypeCatalog: [
        {
          id: 'sensor_additive_bias',
          displayName: 'Gyro 零偏 - 缓慢漂移',
          layer: 'sensor',
          runtimeBehavior: 'drift',
          defaultParameters: {}
        },
        {
          id: 'motor1_stuck',
          displayName: '1号电机卡死',
          layer: 'actuator',
          runtimeBehavior: 'stuck',
          defaultParameters: {}
        }
      ],
      faultCapabilityMap: [
        {
          targetKind: 'node',
          targetId: 'node-imu',
          slotId: 'gyro-feedback',
          allowedFaultTypeIds: ['sensor_additive_bias']
        }
      ],
      faultInstances: [],
      diagnosticModel: {
        testPoints: [],
        detectabilityMatrix: []
      },
      componentTemplates: [],
      pythonModules: []
    };

    const result = window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__(pkg);
    await flushRuntime();

    expect(result?.ok).not.toBe(false);
    window.selectNode('node-imu');
    window.openTargetFaultActivationDialog();
    await flushRuntime();

    const choices = [...document.querySelectorAll('[data-activate-compatible-fault]')];
    expect(choices).toHaveLength(1);
    expect(choices[0].textContent).toContain('Gyro 零偏 - 缓慢漂移');
    expect(choices[0].textContent).not.toContain('1号电机卡死');

    wrapper.unmount();
  });

  it('creates edge-targeted authored fault instances from compatible edge slots', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = {
      schemaVersion: '3.0',
      modelInfo: {
        modelId: 'authoring-edge-runtime',
        modelName: '边故障运行模型'
      },
      systemModel: {
        nodes: [
          {
            id: 'node-motor',
            type: 'simulation_block',
            x: 240,
            y: 180,
            props: {
              name: '电机控制器',
              inputs: [],
              outputs: [{ name: '电机指令', type: 'scalar' }],
              middleVars: []
            }
          },
          {
            id: 'node-motor-1',
            type: 'simulation_block',
            x: 560,
            y: 180,
            props: {
              name: '1号电机',
              inputs: [{ name: '电机指令', type: 'scalar' }],
              outputs: [],
              middleVars: []
            }
          }
        ],
        edges: [
          {
            id: 'edge-motor-motor1',
            sourceNodeId: 'node-motor',
            targetNodeId: 'node-motor-1',
            sourcePortIndex: 0,
            targetPortIndex: 0,
            lineType: 'can',
            signalId: 'motor1.command'
          }
        ]
      },
      faultTypeCatalog: [
        {
          id: 'motor1_can_command_tamper',
          displayName: '1号电机 CAN 指令篡改',
          layer: 'protocol',
          runtimeBehavior: 'tamper',
          defaultParameters: { scale: 0.5 }
        }
      ],
      faultCapabilityMap: [
        {
          targetKind: 'edge',
          targetId: 'edge-motor-motor1',
          slotId: 'motor1-can-command',
          allowedFaultTypeIds: ['motor1_can_command_tamper']
        }
      ],
      faultInstances: [],
      diagnosticModel: {
        testPoints: [],
        detectabilityMatrix: []
      },
      componentTemplates: [],
      pythonModules: []
    };

    const applyResult = window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__(pkg);
    await flushRuntime();

    expect(applyResult?.ok).not.toBe(false);
    const edge = window.__GZ_STATE__.modelEdges.find((item) => item.id === 'edge-motor-motor1');
    expect(edge).toBeTruthy();

    expect(typeof window.handleLineFaultComponentDrop).toBe('function');
    const dropResult = window.handleLineFaultComponentDrop({ target: edge });
    await flushRuntime();

    expect(dropResult).toMatchObject({ ok: false, reason: 'fault-library-disabled' });
    expect(document.querySelector('[data-activate-compatible-fault="motor1_can_command_tamper"]')).toBeNull();

    const activateResult = window.activateFaultForTarget(edge, 'motor1_can_command_tamper');
    await flushRuntime();

    expect(activateResult.ok).toBe(true);
    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      faultTypeId: 'motor1_can_command_tamper',
      targetKind: 'edge',
      targetId: 'edge-motor-motor1',
      slotId: 'motor1-can-command'
    }));

    wrapper.unmount();
  });















  it('keeps the startup canvas blank and imports the selected local model JSON from the import action', async () => {
    const originalFetch = window.fetch;
    const selectedPackage = loadPublicPackage('evtol_small_nonlinear.json');
    window.fetch = vi.fn();
    mockNextJsonFileSelection(JSON.stringify(selectedPackage));

    const wrapper = mount(App, { attachTo: document.body });
    try {
      await flushRuntime();

      expect(window.__GZ_STATE__.sysLoaded).not.toBe(true);
      expect(window.__GZ_STATE__.modelNodes).toHaveLength(0);
      expect(document.getElementById('empty')?.style.display).not.toBe('none');

      const importResult = await window.doImportSys();
      await flushRuntime();

      expect(importResult).toMatchObject({ ok: true });
      expect(window.fetch).not.toHaveBeenCalled();
      expect(window.__GZ_STATE__.sysLoaded).toBe(true);
      expect(window.__GZ_STATE__.modelNodes).toHaveLength(selectedPackage.workbenchSnapshot.modelNodes.length);
      expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
        modelId: selectedPackage.modelId,
        modelName: selectedPackage.modelName
      });
      expect(document.getElementById('empty')?.style.display).toBe('none');
      expect(document.getElementById('diagram')?.classList.contains('on')).toBe(true);
    } finally {
      window.fetch = originalFetch;
      wrapper.unmount();
    }
  });

  it('imports the selected local model JSON through the browser file picker API when available', async () => {
    const originalPicker = window.showOpenFilePicker;
    const selectedPackage = loadPublicPackage('evtol_small_nonlinear.json');
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    window.showOpenFilePicker = vi.fn().mockResolvedValue([
      {
        getFile: async () => ({
          name: 'model-package.json',
          text: async () => JSON.stringify(selectedPackage)
        })
      }
    ]);

    const wrapper = mount(App, { attachTo: document.body });
    try {
      await flushRuntime();

      const importResult = await window.doImportSys();
      await flushRuntime();

      expect(importResult).toMatchObject({ ok: true });
      expect(window.showOpenFilePicker).toHaveBeenCalledWith(expect.objectContaining({
        multiple: false
      }));
      expect(inputClick).not.toHaveBeenCalled();
      expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
        modelId: selectedPackage.modelId,
        modelName: selectedPackage.modelName
      });
    } finally {
      if (originalPicker) {
        window.showOpenFilePicker = originalPicker;
      } else {
        delete window.showOpenFilePicker;
      }
      wrapper.unmount();
    }
  });

  it('restores the import button when the local model JSON picker is cancelled', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click() {
      this.dispatchEvent(new Event('cancel'));
    });

    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importButton = document.getElementById('btn-imp-sys');
    const importPromise = window.doImportSys();
    await flushRuntime();

    expect(importButton?.textContent).toBe('导入系统模型');
    expect(importButton?.disabled).toBe(false);
    await expect(importPromise).resolves.toMatchObject({ ok: false, reason: 'file-selection-cancelled' });

    wrapper.unmount();
  });

  it('imports the selected local model JSON when focus returns before the file change event', async () => {
    const selectedPackage = loadPublicPackage('evtol_small_nonlinear.json');
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click() {
      window.dispatchEvent(new Event('focus'));
      setTimeout(() => {
        Object.defineProperty(this, 'files', {
          configurable: true,
          value: [
            {
              name: 'model-package.json',
              text: async () => JSON.stringify(selectedPackage)
            }
          ]
        });
        this.onchange?.(new Event('change'));
      }, 20);
    });

    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importResult = await window.doImportSys();
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
      modelId: selectedPackage.modelId,
      modelName: selectedPackage.modelName
    });
    expect(document.getElementById('btn-imp-sys')?.textContent).toBe('导入系统模型');

    wrapper.unmount();
  });

  it('waits for a delayed local model JSON selection after focus returns', async () => {
    const selectedPackage = loadPublicPackage('evtol_small_nonlinear.json');
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click() {
      window.dispatchEvent(new Event('focus'));
      setTimeout(() => {
        Object.defineProperty(this, 'files', {
          configurable: true,
          value: [
            {
              name: 'model-package.json',
              text: async () => JSON.stringify(selectedPackage)
            }
          ]
        });
        this.onchange?.(new Event('change'));
      }, 350);
    });

    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importResult = await window.doImportSys();
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
      modelId: selectedPackage.modelId,
      modelName: selectedPackage.modelName
    });

    wrapper.unmount();
  });







  it('opens the fault-task loader instead of the legacy fault-library window in the component-binding branch', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const hierarchicalPackage = {
      ...PACKAGE_FIXTURE,
      systemFamily: 'uav-flight-control',
      supportedFaultLibraries: ['uav-flight-control-faults']
    };
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(hierarchicalPackage);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(document.getElementById('btn-imp-flt')?.textContent).toContain('加载故障模型');
    expect(document.getElementById('btn-imp-flt')?.disabled).toBe(false);
    expect(document.getElementById('btn-imp-flt')?.classList.contains('tbtn-disabled')).toBe(false);

    window.doImportFault();
    await flushRuntime();

    expect(document.getElementById('ov-ifm')?.classList.contains('open')).not.toBe(true);
    expect(document.querySelector('[data-fault-task-loader]')).not.toBeNull();
    expect(document.querySelector('[data-fault-id="actuator_lock_or_failure"]')).toBeNull();

    wrapper.unmount();
  });

  it('keeps the fault-task loader available after importing a compatible model before saving', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const hierarchicalPackage = {
      ...PACKAGE_FIXTURE,
      systemFamily: 'uav-flight-control',
      supportedFaultLibraries: ['uav-flight-control-faults']
    };
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(hierarchicalPackage);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.sysLoaded).toBe(true);
    expect(window.__GZ_STATE__.activeModelPackage?.systemFamily).toBe('uav-flight-control');

    window.__GZ_STATE__.systemSaved = false;
    window.updateUI();
    await flushRuntime();

    const injectButton = document.getElementById('btn-imp-flt');
    expect(injectButton?.textContent).toContain('加载故障模型');
    expect(injectButton?.disabled).toBe(false);
    expect(injectButton?.classList.contains('tbtn-disabled')).toBe(false);
    expect(injectButton?.getAttribute('aria-disabled')).toBe('false');

    window.doImportFault();
    await flushRuntime();

    expect(document.getElementById('ov-ifm')?.classList.contains('open')).not.toBe(true);
    expect(document.querySelector('[data-fault-task-loader]')).not.toBeNull();
    expect(document.querySelector('[data-fault-id="actuator_lock_or_failure"]')).toBeNull();

    wrapper.unmount();
  });

  it('blocks the UAV flight-control fault library for an incompatible system model', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const incompatiblePackage = {
      ...PACKAGE_FIXTURE,
      systemFamily: 'thermal-control',
      supportedFaultLibraries: [],
      modelId: 'thermal-loop',
      modelName: 'Thermal Loop',
      description: 'A non-flight-control thermal system package'
    };
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(incompatiblePackage);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
      modelId: 'thermal-loop',
      systemFamily: 'thermal-control',
      supportedFaultLibraries: []
    });

    window.doImportFault();
    await flushRuntime();

    expect(document.getElementById('ov-ifm')?.classList.contains('open')).not.toBe(true);
    expect(document.querySelector('[data-fault-id="physical_parameter_bias"]')).toBeNull();

    wrapper.unmount();
  });


  it('hydrates lean imported simulation bindings from package pythonModules', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(LEAN_PACKAGE_FIXTURE);
    await flushRuntime();

    const hydratedBinding = window.__GZ_STATE__.modelNodes[0].pythonBinding;

    expect(importResult).toMatchObject({ ok: true });
    expect(hydratedBinding).toMatchObject({
      bound: true,
      moduleId: 'attitude_pid',
      fileName: 'attitude_pid.py',
      entryFunction: 'process',
      rawSource: parsedInterface.rawSource,
      sourcePackageId: MODEL_ID,
      sourcePackageName: MODEL_NAME
    });
    expect(hydratedBinding.parsedInterface).toMatchObject({
      moduleName: 'attitude_pid',
      entryFunction: 'process'
    });

    wrapper.unmount();
  });

  it('surfaces imported model package details in the simulation block inspector and status area', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(PACKAGE_FIXTURE);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    window.selectNode('node-1');
    await flushRuntime();

    const inspector = document.getElementById('pd');
    const status = document.getElementById('model-package-status');

    expect(inspector?.textContent).toContain('来源模型包');
    expect(inspector?.textContent).toContain('执行模式');
    expect(inspector?.textContent).toContain(MODEL_NAME);
    expect(inspector?.textContent).toContain('backend');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain(MODEL_NAME);
    expect(status?.textContent).toContain('backend');

    wrapper.unmount();
  });

  it('keeps the model package status visible outside the property panel after deselection and non-simulation selection', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(PACKAGE_FIXTURE);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    window.selectNode('node-1');
    await flushRuntime();

    const initialStatus = document.getElementById('model-package-status');
    expect(initialStatus).not.toBeNull();
    expect(initialStatus?.parentElement?.id).not.toBe('pd');
    expect(initialStatus?.textContent).toContain(MODEL_NAME);
    expect(initialStatus?.textContent).toContain('backend');

    window.renderPropertyPanel(null);
    await flushRuntime();

    const afterDeselectStatus = document.getElementById('model-package-status');
    expect(afterDeselectStatus).not.toBeNull();
    expect(afterDeselectStatus?.textContent).toContain(MODEL_NAME);

    window.createNode('signal_source', 200, 180);
    await flushRuntime();

    const signalNode = window.__GZ_STATE__.modelNodes.find((node) => node.type === 'signal_source');
    window.selectNode(signalNode.id);
    await flushRuntime();

    const afterSignalSelectionStatus = document.getElementById('model-package-status');
    expect(afterSignalSelectionStatus).not.toBeNull();
    expect(afterSignalSelectionStatus?.textContent).toContain(MODEL_NAME);
    expect(afterSignalSelectionStatus?.textContent).not.toContain('backend');

    wrapper.unmount();
  });

  it('rejects duplicate python module identities during package import', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(DUPLICATE_MODULE_PACKAGE_FIXTURE);

    expect(importResult.ok).toBe(false);
    expect(importResult.errors.some((error) => error.includes('Duplicate moduleId'))).toBe(true);

    wrapper.unmount();
  });

  it('rejects imports whose bound simulation blocks reference missing python modules', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(MISSING_MODULE_PACKAGE_FIXTURE);

    expect(importResult.ok).toBe(false);
    expect(importResult.errors.some((error) => error.includes('missing_controller'))).toBe(true);

    wrapper.unmount();
  });

  it('keeps the compatible UAV fault catalog hidden in the component-binding branch', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    state.sysLoaded = true;
    state.systemSaved = true;
    state.activeModelPackage = {
      modelId: 'evtol-catalog-test',
      modelName: 'eVTOL Catalog Test',
      systemFamily: 'uav-flight-control',
      supportedFaultLibraries: ['uav-flight-control-faults']
    };
    state.modelNodes = [
      {
        id: 'node-catalog-target',
        type: 'simulation_block',
        x: 300,
        y: 200,
        props: {
          name: 'Catalog Target',
          moduleType: 'control',
          inputs: [{ name: 'Input', type: 'scalar' }],
          outputs: [{ name: 'Output', type: 'scalar' }],
          middleVars: []
        }
      }
    ];

    expect(window.__GZ_FAULT_TYPE_CATALOG__.faultTypes).toHaveLength(20);

    window.doImportFault();
    await flushRuntime();

    expect(document.getElementById('ov-ifm')?.classList.contains('open')).not.toBe(true);
    expect(document.querySelector('[data-fault-id="physical_parameter_bias"]')).toBeNull();
    expect(document.querySelector('[data-fault-id="fault_bias_overlay"]')).toBeNull();
    expect(document.querySelector('[data-fault-id="fault_noise_injection"]')).toBeNull();
    expect(state.importedFaultModels.some((model) => model.id === 'sensor_additive_bias')).not.toBe(true);

    wrapper.unmount();
  });

  it('imports a branched signal-routing package and preserves utility blocks in the workbench state', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(SIGNAL_ROUTING_PACKAGE_FIXTURE);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const rootCanvas = state.canvases[state.rootCanvasId];
    const sourceEdges = rootCanvas.edges.filter((edge) => edge.sourceNodeId === 'node-source');

    expect(importResult).toMatchObject({ ok: true });
    expect(rootCanvas.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'gain_block' }),
      expect.objectContaining({ type: 'sum_block' }),
      expect.objectContaining({ type: 'mux_block' })
    ]));
    expect(sourceEdges).toHaveLength(4);
    expect(rootCanvas.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetNodeId: 'node-gain', targetPortIndex: 0 }),
      expect.objectContaining({ targetNodeId: 'node-scope', targetPortIndex: 0 }),
      expect.objectContaining({ targetNodeId: 'node-sum', targetPortIndex: 1 }),
      expect.objectContaining({ targetNodeId: 'node-mux', targetPortIndex: 0 })
    ]));

    wrapper.unmount();
  });

  it('removes persistent runtime listeners during reset before remounting', async () => {
    const windowRemoveSpy = vi.spyOn(window, 'removeEventListener');
    const documentRemoveSpy = vi.spyOn(document, 'removeEventListener');

    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    __resetLegacyRuntimeForTests();

    expect(windowRemoveSpy.mock.calls.some(([type]) => type === 'gz:python-binding-confirm')).toBe(true);
    expect(windowRemoveSpy.mock.calls.some(([type]) => type === 'keydown')).toBe(true);
    expect(windowRemoveSpy.mock.calls.some(([type]) => type === 'resize')).toBe(true);
    expect(documentRemoveSpy.mock.calls.some(([type]) => type === 'keydown')).toBe(true);
    expect(window.__GZ_RUNTIME_LISTENERS__).toBeUndefined();

    wrapper.unmount();

    const wrapper2 = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(typeof window.__GZ_FLIGHT_MODEL_PACKAGE__?.importObject).toBe('function');

    wrapper2.unmount();
  });
});
