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

function collectLinkedSubsystemNodes(snapshot) {
  const rootCanvas = snapshot?.canvases?.[snapshot?.rootCanvasId];
  if (!rootCanvas) {
    return [];
  }

  return (rootCanvas.nodes || []).filter((node) => node?.type === 'subsystem_block' && node.targetCanvasId);
}

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

async function importDefaultClosedLoopPackage() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  const defaultPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
  const importResult = await window.__GZ_LOAD_DEFAULT_FLIGHT_MODEL__({
    force: true,
    packageObject: defaultPackage
  });
  await flushRuntime();

  expect(importResult).toMatchObject({ ok: true });
  return {
    wrapper,
    defaultPackage,
    state: window.__GZ_STATE__
  };
}

function getScopePeak(samples = []) {
  if (!samples.length) {
    return 0;
  }

  return samples.reduce((peak, sample) => {
    const value = Number.isFinite(sample?.actual) ? sample.actual : 0;
    return Math.max(peak, Math.abs(value));
  }, 0);
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

async function measurePackageDynamicsScopePeak(fileName) {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();

  const pkg = loadPublicPackage(fileName);
  const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
  await flushRuntime();

  expect(importResult).toMatchObject({ ok: true });

  window.simInit(true);
  for (let step = 0; step < 6; step += 1) {
    window.simStep();
  }
  await flushRuntime();

  const scopeSamples = window.__GZ_SIM__?.actual?.scopeSamples?.['node-11']?.ch1 ?? [];
  const scopePeak = getScopePeak(scopeSamples);

  wrapper.unmount();
  document.body.innerHTML = '';
  __resetLegacyRuntimeForTests();

  return { scopeSamples, scopePeak };
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
    expect(window.__GZ_STATE__.availableFaultModels.some((model) => model.id === 'fault-actuator-saturation')).toBe(true);
    expect(window.__GZ_STATE__.availableFaultModels.some((model) => model.id === 'physical_parameter_bias')).toBe(true);
    expect(document.getElementById('tm')?.textContent).toContain(`飞控模型包“${MODEL_NAME}”已导入`);

    const exportedPackage = window.__GZ_FLIGHT_MODEL_PACKAGE__.exportCurrent();

    expect(exportedPackage.modelId).toBe(MODEL_ID);
    expect(exportedPackage.pythonModules[0].moduleId).toBe('attitude_pid');
    expect(exportedPackage.workbenchSnapshot.modelNodes[0].pythonBinding.sourcePackageId).toBe(MODEL_ID);

    wrapper.unmount();
  });

  it('loads the closed-loop eVTOL package as the default flight-control model on demand', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(typeof window.__GZ_LOAD_DEFAULT_FLIGHT_MODEL__).toBe('function');
    expect(window.__GZ_STATE__.sysLoaded).not.toBe(true);

    const defaultPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = await window.__GZ_LOAD_DEFAULT_FLIGHT_MODEL__({
      force: true,
      packageObject: defaultPackage
    });
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.sysLoaded).toBe(true);
    expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
      modelId: defaultPackage.modelId,
      modelName: defaultPackage.modelName,
      systemFamily: 'uav-flight-control'
    });
    expect(window.__GZ_STATE__.modelNodes).toHaveLength(defaultPackage.workbenchSnapshot.modelNodes.length);
    expect(window.__GZ_STATE__.modelEdges.some((edge) => edge.id === 'edge-imu-error')).toBe(true);
    expect(window.__GZ_STATE__.availableFaultModels.some((model) => model.id === 'sensor_additive_bias')).toBe(true);
    expect(window.__GZ_DEFAULT_FLIGHT_MODEL_STATE__).toMatchObject({
      loaded: true,
      modelId: defaultPackage.modelId,
      modelName: defaultPackage.modelName,
      source: 'provided-object'
    });

    wrapper.unmount();
  });

  it('resolves compatible fault choices from target fault capability slots', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;

    const imu = state.modelNodes.find((node) => node.id === 'node-imu');
    const motor = state.modelNodes.find((node) => node.id === 'node-motor-1');
    const canEdge = state.modelEdges.find((edge) => edge.id === 'edge-motor-motor1');
    const imuFeedbackEdge = state.modelEdges.find((edge) => edge.id === 'edge-imu-error');
    const controller = state.modelNodes.find((node) => node.id === 'node-controller');

    expect(window.getFaultCapabilityForTarget(imu)).toMatchObject({
      targetId: 'node-imu',
      targetKind: 'node'
    });
    expect(window.getCompatibleFaultModelsForTarget(imu).map((fault) => fault.id)).toEqual(expect.arrayContaining([
      'gyro_zero_bias_offset',
      'gyro_zero_bias_drift',
      'gyro_zero_bias_intermittent',
      'sensor_additive_bias',
      'fault_noise_injection',
      'colored_noise',
      'signal_freeze',
      'intermittent_anomaly'
    ]));
    expect(window.getCompatibleFaultModelsForTarget(motor).map((fault) => fault.id)).toEqual(expect.arrayContaining([
      'motor_1_stuck_position'
    ]));
    expect(window.getCompatibleFaultModelsForTarget(canEdge).map((fault) => fault.id)).toEqual(expect.arrayContaining([
      'control_command_tamper',
      'data_tamper',
      'burst_packet_loss'
    ]));
    expect(window.getCompatibleFaultModelsForTarget(imuFeedbackEdge).map((fault) => fault.id)).toEqual(expect.arrayContaining([
      'can_bus_delay',
      'fixed_delay',
      'time_varying_delay',
      'random_packet_loss',
      'blocking_interrupt'
    ]));
    expect(window.getCompatibleFaultModelsForTarget(controller).map((fault) => fault.id)).toEqual(expect.arrayContaining([
      'physical_parameter_step',
      'state_jump_or_sign_flip'
    ]));

    wrapper.unmount();
  });

  it('filters compatible fault choices by the selected injector layer', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;
    const controller = state.modelNodes.find((node) => node.id === 'node-controller');
    const imuFeedbackEdge = state.modelEdges.find((edge) => edge.id === 'edge-imu-error');

    const controllerPhysical = window.getCompatibleFaultModelsForTarget(controller, { layer: 'physical' }).map((fault) => fault.id);
    const controllerElectrical = window.getCompatibleFaultModelsForTarget(controller, { layer: 'electrical' }).map((fault) => fault.id);
    const controllerProtocol = window.getCompatibleFaultModelsForTarget(controller, { layer: 'protocol' }).map((fault) => fault.id);

    expect(controllerPhysical).toContain('physical_parameter_step');
    expect(controllerPhysical).not.toContain('state_jump_or_sign_flip');
    expect(controllerElectrical).toContain('state_jump_or_sign_flip');
    expect(controllerElectrical).not.toContain('physical_parameter_step');
    expect(controllerProtocol).toEqual([]);

    const imuProtocol = window.getCompatibleFaultModelsForTarget(imuFeedbackEdge, { layer: 'protocol' }).map((fault) => fault.id);
    expect(imuProtocol).toEqual(expect.arrayContaining(['can_bus_delay']));

    wrapper.unmount();
  });

  it('disables fault-library target choices from fault injector component drops', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;
    const controller = state.modelNodes.find((node) => node.id === 'node-controller');
    const imuFeedbackEdge = state.modelEdges.find((edge) => edge.id === 'edge-imu-error');

    const physicalResult = window.handleFaultComponentDrop({
      target: controller,
      targetKind: 'node',
      layer: 'physical'
    });
    await flushRuntime();

    expect(physicalResult).toMatchObject({ ok: false, reason: 'fault-library-disabled' });
    expect(document.querySelector('[data-target-fault-dialog]')).toBeNull();
    expect(document.querySelector('[data-activate-compatible-fault="physical_parameter_step"]')).toBeNull();
    expect(document.querySelector('[data-activate-compatible-fault="state_jump_or_sign_flip"]')).toBeNull();

    const protocolOnNode = window.handleFaultComponentDrop({
      target: controller,
      targetKind: 'node',
      layer: 'protocol'
    });
    await flushRuntime();
    expect(protocolOnNode).toMatchObject({ ok: false, reason: 'fault-library-disabled' });

    const protocolResult = window.handleLineFaultComponentDrop({
      target: imuFeedbackEdge,
      targetKind: 'edge',
      layer: 'protocol'
    });
    await flushRuntime();

    expect(protocolResult).toMatchObject({ ok: false, reason: 'fault-library-disabled' });
    expect(document.querySelector('[data-activate-compatible-fault="can_bus_delay"]')).toBeNull();
    expect(document.querySelector('[data-activate-compatible-fault="sensor_additive_bias"]')).toBeNull();

    wrapper.unmount();
  });

  it('records the injection form for module-variable and protocol-bus injections', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;
    const controller = state.modelNodes.find((node) => node.id === 'node-controller');
    const imuFeedbackEdge = state.modelEdges.find((edge) => edge.id === 'edge-imu-error');
    const controllerPhysicalSlot = window.getCompatibleFaultOptionsForTarget(controller, { layer: 'physical' })[0].slot;
    const imuProtocolSlot = window.getCompatibleFaultOptionsForTarget(imuFeedbackEdge, { layer: 'protocol' })[0].slot;

    const moduleResult = window.activateFaultForTarget(controller, 'physical_parameter_step', {}, {
      slot: controllerPhysicalSlot,
      slotId: 'physical:controller_gain',
      layer: 'physical'
    });
    const protocolResult = window.activateFaultForTarget(imuFeedbackEdge, 'can_bus_delay', {}, {
      slot: imuProtocolSlot,
      slotId: 'imu-feedback-can',
      layer: 'protocol'
    });
    await flushRuntime();

    expect(moduleResult.ok).toBe(true);
    expect(protocolResult.ok).toBe(true);
    expect(state.faultInstances).toEqual(expect.arrayContaining([
      expect.objectContaining({
        faultTypeId: 'physical_parameter_step',
        targetKind: 'node',
        injectionForm: 'module-variable'
      }),
      expect.objectContaining({
        faultTypeId: 'can_bus_delay',
        targetKind: 'edge',
        injectionForm: 'protocol-bus'
      })
    ]));
    expect(controller.injectedFault).toMatchObject({
      modelId: 'physical_parameter_step',
      injectionForm: 'module-variable'
    });
    expect(imuFeedbackEdge.injectedFault).toMatchObject({
      modelId: 'can_bus_delay',
      injectionForm: 'protocol-bus'
    });

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
                allowedFaultTypeIds: ['gyro_zero_bias_drift']
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
          id: 'gyro_zero_bias_drift',
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
          allowedFaultTypeIds: ['gyro_zero_bias_drift']
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

  it('activates a compatible fault as a target-owned fault instance', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;
    const imu = state.modelNodes.find((node) => node.id === 'node-imu');

    const result = window.activateFaultForTarget(imu, 'gyro_zero_bias_drift', {
      rate: '0.01',
      start: '5'
    });
    await flushRuntime();

    expect(result.ok).toBe(true);
    expect(state.faultInstances).toHaveLength(1);
    expect(state.faultInstances[0]).toMatchObject({
      faultTypeId: 'gyro_zero_bias_drift',
      targetKind: 'node',
      targetId: 'node-imu',
      slotId: 'physical:imu_zero_bias',
      active: true
    });
    expect(state.faultInstances[0].parameters).toMatchObject({ rate: '0.01', start: '5' });
    expect(imu.injectedFault).toMatchObject({ modelId: 'gyro_zero_bias_drift' });
    expect(imu.faultBindings.some((binding) => binding.faultModelId === 'gyro_zero_bias_drift')).toBe(true);
    expect(state.faultTags.some((tag) => tag.faultModelId === 'gyro_zero_bias_drift' && tag.targetId === 'node-imu')).toBe(true);
    expect(document.querySelector('.edge-path[data-edge-id="edge-imu-error"]')?.classList.contains('is-faulted')).toBe(false);

    wrapper.unmount();
  });

  it('rejects fault activation on targets without compatible capability slots', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;
    const controller = state.modelNodes.find((node) => node.id === 'node-controller');

    const result = window.activateFaultForTarget(controller, 'gyro_zero_bias_drift');
    await flushRuntime();

    expect(result).toMatchObject({ ok: false, error: 'incompatible-target' });
    expect(state.faultInstances || []).toHaveLength(0);
    expect(controller.injectedFault).toBeUndefined();

    wrapper.unmount();
  });

  it('opens compatible fault choices for a selected target instead of importing arbitrary catalog faults', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;
    const imu = state.modelNodes.find((node) => node.id === 'node-imu');

    window.selectNode(imu.id);
    window.openTargetFaultActivationDialog();
    await flushRuntime();

    const dialog = document.querySelector('[data-target-fault-dialog]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('IMU 陀螺仪反馈');
    expect(dialog.textContent).toContain('Gyro 陀螺仪零偏 - 固定偏差');
    expect(dialog.textContent).toContain('Gyro 陀螺仪零偏 - 缓慢漂移');
    expect(dialog.textContent).toContain('Gyro 陀螺仪零偏 - 间歇故障');
    expect(dialog.textContent).not.toContain('单电机卡死');

    wrapper.unmount();
  });

  it('prevents choosing the same concrete fault twice on the same target', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;
    const imu = state.modelNodes.find((node) => node.id === 'node-imu');

    const first = window.activateFaultForTarget(imu, 'gyro_zero_bias_drift');
    const second = window.activateFaultForTarget(imu, 'gyro_zero_bias_drift');
    await flushRuntime();

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: 'duplicate-fault-instance' });
    expect(state.faultInstances.filter((instance) => (
      instance.targetId === 'node-imu' && instance.faultTypeId === 'gyro_zero_bias_drift'
    ))).toHaveLength(1);

    window.selectNode(imu.id);
    window.openTargetFaultActivationDialog();
    await flushRuntime();

    const injectedChoice = document.querySelector('[data-activate-compatible-fault="gyro_zero_bias_drift"]');
    const otherChoice = document.querySelector('[data-activate-compatible-fault="gyro_zero_bias_offset"]');
    expect(injectedChoice).not.toBeNull();
    expect(injectedChoice.disabled).toBe(true);
    expect(injectedChoice.classList.contains('is-injected')).toBe(true);
    expect(injectedChoice.textContent).toContain('已注入');
    expect(otherChoice).not.toBeNull();
    expect(otherChoice.disabled).toBe(false);

    wrapper.unmount();
  });

  it('requires parameter confirmation before activating a compatible fault choice', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;
    const imu = state.modelNodes.find((node) => node.id === 'node-imu');
    const initialTagCount = (state.faultTags || []).length;

    window.selectNode(imu.id);
    window.openTargetFaultActivationDialog();
    await flushRuntime();

    const choice = document.querySelector('[data-activate-compatible-fault="gyro_zero_bias_drift"]');
    expect(choice).not.toBeNull();
    choice.click();
    await flushRuntime();

    expect(state.faultInstances || []).toHaveLength(0);
    expect((state.faultTags || []).length).toBe(initialTagCount);

    const panel = document.querySelector('[data-target-fault-parameters]');
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('Gyro 陀螺仪零偏 - 缓慢漂移');
    expect(panel.querySelector('[data-target-fault-param="rate"]')).not.toBeNull();
    const parameterGridText = panel.querySelector('.target-fault-parameters__grid')?.textContent || '';
    expect(parameterGridText).toContain('漂移速率');
    expect(parameterGridText).toContain('开始时间');
    expect(parameterGridText).toContain('持续时间');
    expect(parameterGridText).not.toContain('rate');
    expect(parameterGridText).not.toContain('start');
    expect(parameterGridText).not.toContain('duration');

    const rate = panel.querySelector('[data-target-fault-param="rate"]');
    rate.value = '0.009';
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    panel.querySelector('[data-confirm-target-fault]').click();
    await flushRuntime();

    expect(state.faultInstances).toContainEqual(expect.objectContaining({
      faultTypeId: 'gyro_zero_bias_drift',
      targetKind: 'node',
      targetId: 'node-imu',
      parameters: expect.objectContaining({ rate: '0.009' })
    }));
    expect(state.faultTags).toContainEqual(expect.objectContaining({
      faultModelId: 'gyro_zero_bias_drift',
      targetKind: 'node',
      targetId: 'node-imu'
    }));

    wrapper.unmount();
  });

  it('uses explicit diagnostic matrix signatures for multiple fault forms on the same target', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();

    const matrix = window.buildDetectionMatrixModel();
    const residual = matrix.points.find((point) => point.shortName === 'M10');
    const spectrum = matrix.points.find((point) => point.shortName === 'M11');
    const byFault = new Map(matrix.rows.map((row) => [row.faultId, row]));

    const fixed = byFault.get('gyro_zero_bias_offset');
    const drift = byFault.get('gyro_zero_bias_drift');
    const intermittent = byFault.get('gyro_zero_bias_intermittent');

    expect(fixed.cells.find((cell) => cell.pointId === residual.pointId).detectable).toBe(false);
    expect(drift.cells.find((cell) => cell.pointId === residual.pointId).detectable).toBe(true);
    expect(intermittent.cells.find((cell) => cell.pointId === spectrum.pointId).detectable).toBe(true);
    expect(intermittent.cells.find((cell) => cell.pointId === spectrum.pointId).reason).toContain('间歇');

    wrapper.unmount();
  });

  it('builds an ordered troubleshooting path for a concrete fault from the D matrix', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();

    expect(typeof window.buildTroubleshootingPathForFault).toBe('function');
    const path = window.buildTroubleshootingPathForFault('gyro_zero_bias_drift');

    expect(path).toMatchObject({
      faultId: 'gyro_zero_bias_drift',
      faultName: 'Gyro 陀螺仪零偏 - 缓慢漂移'
    });
    expect(path.steps.length).toBeGreaterThanOrEqual(2);
    expect(path.steps[0]).toMatchObject({
      pointCode: 'M10',
      pointName: '残差诊断',
      expected: expect.stringContaining('残差趋势项持续上升')
    });
    expect(path.steps[0].remainingFaultIds).toContain('gyro_zero_bias_drift');
    expect(path.steps[0].remainingFaultIds).not.toContain('gyro_zero_bias_offset');
    expect(path.steps.some((step) => step.pointCode === 'M3')).toBe(true);
    expect(path.summary).toContain('优先检查');

    wrapper.unmount();
  });

  it('opens the troubleshooting path panel from a D matrix fault row', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();

    window.renderDetectionMatrixPanel();
    await flushRuntime();

    const action = document.querySelector('[data-build-troubleshooting-path="gyro_zero_bias_drift"]');
    expect(action).not.toBeNull();
    action.click();
    await flushRuntime();

    const panel = document.querySelector('[data-troubleshooting-path-panel]');
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('Gyro 陀螺仪零偏 - 缓慢漂移');
    expect(panel.textContent).toContain('M10');
    expect(panel.textContent).toContain('残差趋势项持续上升');

    wrapper.unmount();
  });

  it('does not inject into a model edge from the disabled fault component drop flow', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;
    const canEdge = state.modelEdges.find((edge) => edge.id === 'edge-motor-motor1');

    expect(typeof window.handleLineFaultComponentDrop).toBe('function');

    const moduleFaultResult = window.handleFaultComponentDrop({ target: canEdge, x: 0, y: 0 });
    expect(moduleFaultResult).toMatchObject({
      ok: false,
      reason: 'fault-library-disabled'
    });

    const result = window.handleLineFaultComponentDrop({ target: canEdge, x: 0, y: 0 });
    await flushRuntime();

    expect(result).toMatchObject({
      ok: false,
      reason: 'fault-library-disabled'
    });

    const choice = document.querySelector('[data-activate-compatible-fault="control_command_tamper"]');
    expect(choice).toBeNull();
    expect(document.querySelector('[data-target-fault-dialog]')).toBeNull();
    expect(state.faultInstances || []).not.toContainEqual(expect.objectContaining({
      faultTypeId: 'control_command_tamper',
      targetKind: 'edge',
      targetId: 'edge-motor-motor1'
    }));
    expect(canEdge.injectedFault).toBeUndefined();
    expect(canEdge.faultBindings?.some((binding) => binding.faultModelId === 'control_command_tamper')).not.toBe(true);
    expect(document.querySelector('.edge-path[data-edge-id="edge-motor-motor1"]')?.classList.contains('is-faulted')).toBe(false);

    wrapper.unmount();
  });

  it('does not offer direct fault-library choices on the IMU feedback line', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;
    const imuFeedbackEdge = state.modelEdges.find((edge) => edge.id === 'edge-imu-error');

    const result = window.handleLineFaultComponentDrop({ target: imuFeedbackEdge, x: 0, y: 0 });
    await flushRuntime();

    expect(result).toMatchObject({
      ok: false,
      reason: 'fault-library-disabled'
    });

    const choice = document.querySelector('[data-activate-compatible-fault="can_bus_delay"]');
    expect(choice).toBeNull();
    expect(document.querySelector('[data-target-fault-dialog]')).toBeNull();
    expect(state.faultInstances || []).not.toContainEqual(expect.objectContaining({
      faultTypeId: 'can_bus_delay',
      targetKind: 'edge',
      targetId: 'edge-imu-error'
    }));
    expect(imuFeedbackEdge.injectedFault).toBeUndefined();
    expect(document.querySelector('.edge-path[data-edge-id="edge-imu-error"]')?.classList.contains('is-faulted')).toBe(false);
    expect(document.getElementById('b-node-imu')?.classList.contains('faulted')).toBe(false);

    wrapper.unmount();
  });

  it('highlights only compatible modules while dragging the module fault component template', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();

    expect(typeof window.showCompatibleFaultDropTargets).toBe('function');
    expect(typeof window.clearCompatibleFaultDropTargets).toBe('function');

    window.showCompatibleFaultDropTargets({ targetKind: 'node' });
    await flushRuntime();

    expect(document.getElementById('diagram')?.classList.contains('fault-drop-preview')).toBe(true);
    expect(document.getElementById('diagram')?.classList.contains('fault-drop-preview--node')).toBe(true);
    expect(document.getElementById('b-node-imu')?.classList.contains('fault-drop-compatible')).toBe(true);
    expect(document.getElementById('b-node-motor-1')?.classList.contains('fault-drop-compatible')).toBe(true);
    expect(document.getElementById('b-node-controller')?.classList.contains('fault-drop-compatible')).toBe(true);
    expect(document.querySelector('.edge-path[data-edge-id="edge-motor-motor1"]')?.classList.contains('is-fault-drop-compatible')).toBe(false);
    expect(document.querySelector('.edge-path[data-edge-id="edge-shaper-error"]')?.classList.contains('is-fault-drop-compatible')).toBe(false);

    window.clearCompatibleFaultDropTargets();
    await flushRuntime();

    expect(document.getElementById('diagram')?.classList.contains('fault-drop-preview')).toBe(false);
    expect(document.getElementById('b-node-imu')?.classList.contains('fault-drop-compatible')).toBe(false);
    expect(document.querySelector('.edge-path[data-edge-id="edge-motor-motor1"]')?.classList.contains('is-fault-drop-compatible')).toBe(false);

    wrapper.unmount();
  });

  it('highlights only compatible lines while dragging the line fault component template', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();

    expect(typeof window.showCompatibleFaultDropTargets).toBe('function');

    window.showCompatibleFaultDropTargets({ targetKind: 'edge' });
    await flushRuntime();

    expect(document.getElementById('diagram')?.classList.contains('fault-drop-preview')).toBe(true);
    expect(document.getElementById('diagram')?.classList.contains('fault-drop-preview--edge')).toBe(true);
    expect(document.getElementById('b-node-imu')?.classList.contains('fault-drop-compatible')).toBe(false);
    expect(document.getElementById('b-node-motor-1')?.classList.contains('fault-drop-compatible')).toBe(false);
    expect(document.querySelector('.edge-path[data-edge-id="edge-motor-motor1"]')?.classList.contains('is-fault-drop-compatible')).toBe(true);
    expect(document.querySelector('.edge-path[data-edge-id="edge-shaper-error"]')?.classList.contains('is-fault-drop-compatible')).toBe(false);

    window.clearCompatibleFaultDropTargets();
    await flushRuntime();

    expect(document.getElementById('diagram')?.classList.contains('fault-drop-preview--edge')).toBe(false);
    expect(document.querySelector('.edge-path[data-edge-id="edge-motor-motor1"]')?.classList.contains('is-fault-drop-compatible')).toBe(false);

    wrapper.unmount();
  });

  it('blocks target-specific choices when the fault component is dropped on a compatible target', async () => {
    const { wrapper } = await importDefaultClosedLoopPackage();
    const state = window.__GZ_STATE__;
    const imu = state.modelNodes.find((node) => node.id === 'node-imu');
    const controller = state.modelNodes.find((node) => node.id === 'node-controller');
    const signalSource = state.modelNodes.find((node) => node.type === 'signal_source');
    const initialTagCount = (state.faultTags || []).length;

    expect(typeof window.handleFaultComponentDrop).toBe('function');
    const compatibleResult = window.handleFaultComponentDrop({ target: imu, x: imu.x + 20, y: imu.y + 20 });
    await flushRuntime();

    expect(compatibleResult).toMatchObject({ ok: false, reason: 'fault-library-disabled' });
    const dialog = document.querySelector('[data-target-fault-dialog]');
    expect(dialog).toBeNull();
    expect((state.faultTags || []).length).toBe(initialTagCount);

    const controllerResult = window.handleFaultComponentDrop({ target: controller, x: controller.x + 20, y: controller.y + 20 });
    await flushRuntime();

    expect(controllerResult).toMatchObject({ ok: false, reason: 'fault-library-disabled' });

    const incompatibleResult = window.handleFaultComponentDrop({ target: signalSource, x: signalSource.x + 20, y: signalSource.y + 20 });
    await flushRuntime();

    expect(incompatibleResult).toMatchObject({ ok: false, reason: 'fault-library-disabled' });
    expect((state.faultTags || []).length).toBe(initialTagCount);

    wrapper.unmount();
  });

  it('keeps the startup canvas blank and imports the bundled UAV demo from the import action', async () => {
    const originalFetch = window.fetch;
    const defaultPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    window.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => defaultPackage
    }));
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click() {
      this.onchange?.(new Event('change'));
    });

    const wrapper = mount(App, { attachTo: document.body });
    try {
      await flushRuntime();

      expect(window.__GZ_STATE__.sysLoaded).not.toBe(true);
      expect(window.__GZ_STATE__.modelNodes).toHaveLength(0);
      expect(document.getElementById('empty')?.style.display).not.toBe('none');

      const importResult = await window.doImportSys();
      await flushRuntime();

      expect(importResult).toMatchObject({ ok: true });
      expect(window.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/model-packages/evtol_closed_loop_fault_demo.json'
      );
      expect(window.__GZ_STATE__.sysLoaded).toBe(true);
      expect(window.__GZ_STATE__.modelNodes).toHaveLength(defaultPackage.workbenchSnapshot.modelNodes.length);
      expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
        modelId: defaultPackage.modelId,
        modelName: defaultPackage.modelName
      });
      expect(window.__GZ_STATE__.availableFaultModels.some((model) => model.id === 'gyro_zero_bias_offset')).toBe(true);
      expect(document.getElementById('empty')?.style.display).toBe('none');
      expect(document.getElementById('diagram')?.classList.contains('on')).toBe(true);
    } finally {
      window.fetch = originalFetch;
      wrapper.unmount();
    }
  });

  it('force-loads the public demo over stale blank workspace state and opens fault injection directly', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    window.localStorage.setItem('gz-workbench-system-model', JSON.stringify({
      modelNodes: [],
      modelEdges: []
    }));
    await flushRuntime();

    expect(window.__GZ_STATE__.sysLoaded).toBe(true);
    expect(window.__GZ_STATE__.modelNodes).toHaveLength(0);

    const defaultPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = await window.__GZ_LOAD_DEFAULT_FLIGHT_MODEL__({
      force: true,
      resetStoredWorkbench: true,
      publicDemo: true,
      packageObject: defaultPackage
    });
    await flushRuntime();

    const state = window.__GZ_STATE__;
    expect(importResult).toMatchObject({ ok: true });
    expect(window.localStorage.getItem('gz-workbench-system-model')).toBeNull();
    expect(window.__GZ_PUBLIC_DEMO_MODE__).toBe(true);
    expect(window.__GZ_DEFAULT_FLIGHT_MODEL_STATE__).toMatchObject({
      loaded: true,
      modelId: defaultPackage.modelId,
      publicDemo: true
    });
    expect(state.sysLoaded).toBe(true);
    expect(state.activeModelPackage).toMatchObject({
      modelId: defaultPackage.modelId,
      modelName: defaultPackage.modelName,
      systemFamily: 'uav-flight-control'
    });
    expect(state.modelNodes).toHaveLength(defaultPackage.workbenchSnapshot.modelNodes.length);
    expect(state.modelEdges).toHaveLength(defaultPackage.workbenchSnapshot.modelEdges.length);
    expect(state.availableFaultModels.some((model) => model.id === 'sensor_additive_bias')).toBe(true);
    expect(document.getElementById('btn-imp-flt')?.textContent).toContain('加载故障模型');
    expect(document.getElementById('btn-imp-flt')?.disabled).toBe(false);

    window.doImportFault();
    await flushRuntime();

    expect(document.getElementById('ov-ifm')?.classList.contains('open')).not.toBe(true);
    expect(document.querySelector('[data-fault-task-loader]')).not.toBeNull();
    expect(document.querySelector('[data-fault-task-preset="gyro-bias"]')?.textContent).toContain('陀螺仪零偏');
    expect(document.querySelector('[data-fault-id="gyro_zero_bias_offset"]')).toBeNull();
    expect(document.querySelector('[data-fault-id="gyro_zero_bias_drift"]')).toBeNull();
    expect(document.querySelector('[data-fault-id="gyro_zero_bias_intermittent"]')).toBeNull();
    expect(document.querySelector('[data-fault-id="motor_1_stuck_position"]')).toBeNull();
    expect(document.querySelector('[data-fault-id="control_command_tamper"]')).toBeNull();
    expect(document.querySelector('[data-fault-id="physical_parameter_bias"]')).toBeNull();

    wrapper.unmount();
  });

  it('removes a demo injected fault from the catalog imported state and canvas target', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const faultId = 'gyro_zero_bias_offset';
    window.doImportFault();
    await flushRuntime();
    window.selectFaultCatalogModel(faultId);
    await flushRuntime();
    window.confirmImportFault();
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const allTargets = () => [
      ...state.modelNodes,
      ...state.modelEdges,
      ...(state.nodes || []),
      ...(state.edges || [])
    ];

    expect(state.importedFaultModels.some((model) => model.id === faultId)).toBe(true);
    expect(allTargets().some((target) => targetHasFaultRef(target, faultId))).toBe(true);
    expect(state.modelNodes.some((node) => node.autoFaultInjection && node.faultModelId === faultId)).toBe(false);
    expect((state.faultTags || []).some((tag) => tag.faultModelId === faultId)).toBe(true);
    const hiddenTag = state.faultTags.find((tag) => tag.faultModelId === faultId);
    expect((state.faultInjectionLinks || []).some((link) => (
      link.faultModelId === faultId && link.role === 'fault-tag-attachment'
    ))).toBe(true);
    expect(document.querySelector(`[data-fault-tag-id][data-fault-model-id="${faultId}"]`)).toBeNull();
    expect(document.querySelector(`[data-fault-tags-toggle="${hiddenTag.hostNodeId || hiddenTag.targetId}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-fault-id="${faultId}"].is-imported`)).toBeNull();

    expect(typeof window.removeInjectedFault).toBe('function');
    expect(typeof window.removeImportedFaultModel).toBe('function');
    window.removeInjectedFault(faultId);
    window.removeImportedFaultModel(faultId, { silent: true });
    await flushRuntime();

    expect(state.importedFaultModels.some((model) => model.id === faultId)).toBe(false);
    expect(allTargets().some((target) => targetHasFaultRef(target, faultId))).toBe(false);
    expect(state.modelNodes.some((node) => node.autoFaultInjection && node.faultModelId === faultId)).toBe(false);
    expect((state.faultInjectionLinks || []).some((link) => link.faultModelId === faultId)).toBe(false);
    expect((state.faultTags || []).some((tag) => tag.faultModelId === faultId)).toBe(false);
    expect(document.querySelector(`[data-fault-tag-id][data-fault-model-id="${faultId}"]`)).toBeNull();
    expect(document.querySelector(`[data-fault-tags-toggle="${hiddenTag.hostNodeId || hiddenTag.targetId}"]`)).toBeNull();
    expect(document.querySelector(`[data-fault-id="${faultId}"].is-imported`)).toBeNull();

    wrapper.unmount();
  });

  it('visualizes demo fault injection as attached fault tags instead of inserted canvas blocks', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const cases = [
      'gyro_zero_bias_drift',
      'gyro_zero_bias_intermittent',
      'motor_1_stuck_position',
      'control_command_tamper'
    ];

    for (const faultId of cases) {
      window.doImportFault();
      await flushRuntime();
      window.selectFaultCatalogModel(faultId);
      await flushRuntime();
      window.confirmImportFault();
      await flushRuntime();

      const state = window.__GZ_STATE__;
      const visualNodes = state.modelNodes
        .filter((node) => node.autoFaultInjection && node.faultModelId === faultId)
        .map((node) => node.type);
      expect(visualNodes).toEqual([]);
      expect((state.faultTags || []).filter((tag) => tag.faultModelId === faultId)).toHaveLength(1);
      const tag = (state.faultTags || []).find((item) => item.faultModelId === faultId);
      expect(tag).toMatchObject({
        type: 'fault_tag',
        active: true
      });
      expect(typeof tag.expanded).toBe('boolean');
      expect((state.faultInjectionLinks || []).filter((link) => (
        link.faultModelId === faultId && link.role === 'fault-tag-attachment'
      )).length).toBe(1);
      if (!tag.expanded) {
        expect(document.querySelector(`[data-fault-tag-id][data-fault-model-id="${faultId}"]`)).toBeNull();
        const toggleSelector = tag.targetKind === 'edge'
          ? `[data-edge-fault-toggle][data-edge-id="${tag.targetId}"]`
          : `[data-fault-tags-toggle="${tag.hostNodeId || tag.targetId}"]`;
        document.querySelector(toggleSelector)
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await flushRuntime();
      }
      expect(document.querySelector(`[data-fault-tag-id][data-fault-model-id="${faultId}"]`)).not.toBeNull();
    }

    wrapper.unmount();
  });

  it('keeps the fault view label readable and leaves injected fault tags independently positioned', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(document.querySelector('[data-canvas-view="components"]')?.textContent?.trim()).toBe('故障视图');

    const faultId = 'motor_1_stuck_position';
    window.doImportFault();
    await flushRuntime();
    window.selectFaultCatalogModel(faultId);
    await flushRuntime();
    window.confirmImportFault();
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const tag = state.faultTags.find((item) => item.faultModelId === faultId);
    expect(tag).toMatchObject({ positionMode: 'manual' });
    const initialPosition = { x: tag.x, y: tag.y };
    const target = state.modelNodes.find((node) => node.id === tag.targetId);
    expect(target).toBeTruthy();
    target.x += 120;
    target.y += 80;

    window.renderModelNodes();
    window.renderEdges();
    await flushRuntime();

    expect(tag.x).toBe(initialPosition.x);
    expect(tag.y).toBe(initialPosition.y);

    wrapper.unmount();
  });

  it('keeps injected fault tags hidden until the faulted module expands them', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const faultId = 'gyro_zero_bias_drift';
    window.doImportFault();
    await flushRuntime();
    window.selectFaultCatalogModel(faultId);
    await flushRuntime();
    window.confirmImportFault();
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const tag = state.faultTags.find((item) => item.faultModelId === faultId);
    expect(tag).toMatchObject({ expanded: false });

    expect(document.querySelector(`.fault-tag-card[data-fault-model-id="${faultId}"]`)).toBeNull();
    const targetModule = document.querySelector(`[data-fault-tags-toggle="${tag.hostNodeId || tag.targetId}"]`);
    expect(targetModule).not.toBeNull();
    expect(document.getElementById(`b-${tag.hostNodeId || tag.targetId}`)?.classList.contains('faulted')).toBe(true);

    targetModule.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();

    expect(tag.expanded).toBe(true);
    let tagEl = document.querySelector(`.fault-tag-card[data-fault-model-id="${faultId}"]`);
    expect(tagEl).not.toBeNull();
    expect(tagEl.classList.contains('is-collapsed')).toBe(false);
    expect(tagEl.querySelector('.fault-tag-card__compact')).toBeNull();
    expect(tagEl.textContent).toContain('Gyro');

    document.querySelector(`[data-fault-tags-toggle="${tag.hostNodeId || tag.targetId}"]`)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();

    expect(tag.expanded).toBe(false);
    expect(document.querySelector(`.fault-tag-card[data-fault-model-id="${faultId}"]`)).toBeNull();

    wrapper.unmount();
  });

  it('requires explicit apply before fault tag parameter edits affect the runtime target', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();
    expect(importResult).toMatchObject({ ok: true });

    const faultId = 'gyro_zero_bias_offset';
    window.doImportFault();
    await flushRuntime();
    window.selectFaultCatalogModel(faultId);
    await flushRuntime();
    window.confirmImportFault();
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const tag = state.faultTags.find((item) => item.faultModelId === faultId);
    expect(tag).toBeTruthy();
    window.selectFaultTag(tag.id);
    await flushRuntime();

    const allTargets = [
      ...state.modelNodes,
      ...state.modelEdges,
      ...(state.nodes || []),
      ...(state.edges || [])
    ];
    const target = allTargets.find((item) => targetHasFaultRef(item, faultId));
    const getTargetBinding = () => target?.faultBindings?.find((binding) => targetHasFaultRef(binding, faultId));
    const getTargetFault = () => (
      target?.injectedFault?.modelId === faultId
        ? target.injectedFault
        : getTargetBinding()?.injectedFault
    );
    expect(target).toBeTruthy();
    expect(getTargetFault()?.parameters?.bias).toBe(0.04);
    expect(getTargetBinding()?.parameters?.bias).toBe(0.04);

    window.setPropertyPanelTab('parameters');
    await flushRuntime();

    const input = document.querySelector('[data-fault-tag-param="bias"]');
    const applyButton = document.querySelector('[data-fault-tag-apply]');
    const resetButton = document.querySelector('[data-fault-tag-reset]');
    expect(input).not.toBeNull();
    expect(applyButton).not.toBeNull();
    expect(resetButton).not.toBeNull();
    expect(applyButton.disabled).toBe(true);

    input.value = '0.12';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushRuntime();

    expect(applyButton.disabled).toBe(false);
    expect(resetButton.disabled).toBe(false);
    expect(tag.parameters.bias).toBe(0.04);
    expect(getTargetFault().parameters.bias).toBe(0.04);
    expect(getTargetBinding().parameters.bias).toBe(0.04);

    applyButton.click();
    await flushRuntime();

    expect(applyButton.disabled).toBe(true);
    expect(tag.parameters.bias).toBe('0.12');
    expect(tag.injectedFault.parameters.bias).toBe('0.12');
    expect(getTargetFault().parameters.bias).toBe('0.12');
    expect(getTargetBinding().parameters.bias).toBe('0.12');
    expect(getTargetBinding().injectedFault.parameters.bias).toBe('0.12');

    input.value = '0.20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(applyButton.disabled).toBe(false);
    resetButton.click();
    await flushRuntime();

    expect(input.value).toBe('0.12');
    expect(applyButton.disabled).toBe(true);
    expect(tag.parameters.bias).toBe('0.12');
    expect(getTargetFault().parameters.bias).toBe('0.12');

    wrapper.unmount();
  });

  it('fetches the default package from the configured public base path', async () => {
    const originalFetch = window.fetch;
    const defaultPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    window.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => defaultPackage
    }));

    const wrapper = mount(App, { attachTo: document.body });
    try {
      await flushRuntime();

      const importResult = await window.__GZ_LOAD_DEFAULT_FLIGHT_MODEL__({ force: true });
      await flushRuntime();

      expect(importResult).toMatchObject({ ok: true });
      expect(window.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/model-packages/evtol_closed_loop_fault_demo.json'
      );
      expect(window.__GZ_DEFAULT_FLIGHT_MODEL_STATE__).toMatchObject({
        loaded: true,
        modelId: defaultPackage.modelId,
        source: 'http://localhost:3000/model-packages/evtol_closed_loop_fault_demo.json'
      });
    } finally {
      window.fetch = originalFetch;
      wrapper.unmount();
    }
  });

  it('opens the fault-task loader instead of the legacy fault-library window in the component-binding branch', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const hierarchicalPackage = loadPublicPackage('evtol_small_nonlinear_hierarchical.json');
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

    const hierarchicalPackage = loadPublicPackage('evtol_small_nonlinear_hierarchical.json');
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

  it('ignores stale localStorage snapshots when the import action loads the bundled UAV demo', async () => {
    const originalFetch = window.fetch;
    const defaultPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    window.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => defaultPackage
    }));

    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const legacySnapshot = createWorkbenchSnapshot({
      modelNodes: [
        {
          id: 'node-legacy-1',
          type: 'simulation_block',
          x: 240,
          y: 180,
          props: {
            name: 'Legacy PID',
            moduleType: 'control',
            inputs: [{ name: 'Legacy Input', type: 'scalar' }],
            outputs: [{ name: 'Legacy Output', type: 'scalar' }],
            middleVars: []
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
    });

    window.localStorage.setItem('gz-workbench-system-model', JSON.stringify(legacySnapshot));
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click() {
      this.onchange?.(new Event('change'));
    });

    await window.doImportSys();
    await flushRuntime();

    expect(window.localStorage.getItem('gz-workbench-system-model')).toBeNull();
    expect(window.__GZ_STATE__.sysLoaded).toBe(true);
    expect(window.__GZ_STATE__.modelNodes).toHaveLength(defaultPackage.workbenchSnapshot.modelNodes.length);
    expect(window.__GZ_STATE__.modelNodes.some((node) => node.props?.name === 'Legacy PID')).toBe(false);
    expect(window.__GZ_STATE__.activeModelPackage).toMatchObject({
      modelId: defaultPackage.modelId,
      modelName: defaultPackage.modelName
    });
    window.fetch = originalFetch;
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

  it('imports the hierarchical eVTOL package and restores its child canvas structure', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const hierarchicalPackage = loadPublicPackage('evtol_small_nonlinear_hierarchical.json');
    const expectedLinkedSubsystemCount = collectLinkedSubsystemNodes(hierarchicalPackage.workbenchSnapshot).length;
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(hierarchicalPackage);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    expect(state.rootCanvasId).toBeTruthy();
    const rootCanvas = state.canvases[state.rootCanvasId];

    expect(importResult).toMatchObject({ ok: true });
    expect(state.activeModelPackage).toMatchObject({
      modelId: hierarchicalPackage.modelId,
      modelName: hierarchicalPackage.modelName
    });
    expect(rootCanvas).toBeTruthy();
    if (!rootCanvas) {
      throw new Error('Missing imported root canvas');
    }
    expect(expectedLinkedSubsystemCount).toBeGreaterThan(0);
    const linkedSubsystemNodes = (rootCanvas.nodes || []).filter((node) => node?.type === 'subsystem_block' && node.targetCanvasId);
    expect(linkedSubsystemNodes).toHaveLength(expectedLinkedSubsystemCount);

    const linkedChildCanvases = linkedSubsystemNodes
      .map((node) => state.canvases[node.targetCanvasId])
      .filter(Boolean);
    expect(linkedChildCanvases).toHaveLength(expectedLinkedSubsystemCount);
    linkedSubsystemNodes.forEach((node) => {
      const childCanvas = state.canvases[node.targetCanvasId];
      expect(childCanvas).toBeTruthy();
      if (!childCanvas) {
        throw new Error(`Missing linked child canvas for subsystem ${node.id}`);
      }
      expect(childCanvas.parentSubsystemNodeId).toBe(node.id);
      expect(childCanvas.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'simulation_block', pythonBinding: expect.objectContaining({ bound: true }) })
      ]));
      expect(childCanvas.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'subsystem_in_port' }),
        expect.objectContaining({ type: 'subsystem_out_port' })
      ]));
    });

    wrapper.unmount();
  });

  it('imports the hierarchical eVTOL fault package and restores motor_efficiency_loss inside the child canvas', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const hierarchicalFaultPackage = loadPublicPackage('evtol_small_nonlinear_hierarchical_fault_injected.json');
    const expectedLinkedSubsystemCount = collectLinkedSubsystemNodes(hierarchicalFaultPackage.workbenchSnapshot).length;
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(hierarchicalFaultPackage);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    expect(state.rootCanvasId).toBeTruthy();
    const rootCanvas = state.canvases[state.rootCanvasId];

    expect(importResult).toMatchObject({ ok: true });
    expect(state.activeModelPackage).toMatchObject({
      modelId: hierarchicalFaultPackage.modelId,
      modelName: hierarchicalFaultPackage.modelName
    });
    expect(state.availableFaultModels.some((model) => model.id === 'motor_efficiency_loss')).toBe(true);
    expect(rootCanvas).toBeTruthy();
    if (!rootCanvas) {
      throw new Error('Missing imported root canvas');
    }
    expect(expectedLinkedSubsystemCount).toBeGreaterThan(0);
    const rootFaultNodes = (rootCanvas.nodes || []).filter((node) => node?.injectedFault?.modelId === 'motor_efficiency_loss');
    expect(rootFaultNodes).toHaveLength(0);
    const linkedSubsystemNodes = (rootCanvas.nodes || []).filter((node) => node?.type === 'subsystem_block' && node.targetCanvasId);
    expect(linkedSubsystemNodes).toHaveLength(expectedLinkedSubsystemCount);

    const linkedChildCanvases = linkedSubsystemNodes
      .map((node) => state.canvases[node.targetCanvasId])
      .filter(Boolean);
    expect(linkedChildCanvases).toHaveLength(expectedLinkedSubsystemCount);
    linkedSubsystemNodes.forEach((node) => {
      const childCanvas = state.canvases[node.targetCanvasId];
      expect(childCanvas).toBeTruthy();
      if (!childCanvas) {
        throw new Error(`Missing linked child canvas for subsystem ${node.id}`);
      }
      expect(childCanvas.parentSubsystemNodeId).toBe(node.id);
    });

    const faultedChildCanvases = linkedChildCanvases.filter((childCanvas) => (
      childCanvas.nodes?.some((node) => node?.injectedFault?.modelId === 'motor_efficiency_loss')
    ));
    expect(faultedChildCanvases).toHaveLength(1);
    const faultedChildCanvas = faultedChildCanvases[0];
    expect(faultedChildCanvas).toBeTruthy();
    if (!faultedChildCanvas) {
      throw new Error('Missing faulted child canvas');
    }
    const faultNodes = faultedChildCanvas.nodes.filter((node) => node?.injectedFault?.modelId === 'motor_efficiency_loss');
    expect(faultNodes).toHaveLength(1);
    const totalFaultNodes = linkedChildCanvases.reduce((count, childCanvas) => (
      count + (childCanvas.nodes || []).filter((node) => node?.injectedFault?.modelId === 'motor_efficiency_loss').length
    ), 0);
    expect(totalFaultNodes).toBe(1);
    const faultNode = faultNodes[0];
    expect(faultNode).toBeTruthy();
    if (!faultNode) {
      throw new Error('Missing injected fault node in faulted child canvas');
    }
    expect(faultNode.type).toBe('simulation_block');
    expect(faultNode.injectedFault).toMatchObject({
      modelId: 'motor_efficiency_loss',
      layer: 'electrical',
      name: 'Motor Efficiency Loss'
    });

    wrapper.unmount();
  });

  it('reduces hierarchical dynamics-scope amplitude when the imported motor_efficiency_loss fault is preloaded', async () => {
    const { scopeSamples: normalScopeSamples, scopePeak: normalPeak } = await measurePackageDynamicsScopePeak(
      'evtol_small_nonlinear_hierarchical.json'
    );
    const { scopeSamples: faultScopeSamples, scopePeak: faultPeak } = await measurePackageDynamicsScopePeak(
      'evtol_small_nonlinear_hierarchical_fault_injected.json'
    );

    expect(normalScopeSamples.length).toBeGreaterThan(0);
    expect(faultScopeSamples.length).toBeGreaterThan(0);
    expect(normalPeak).toBeGreaterThan(0.01);
    expect(faultPeak).toBeGreaterThan(0);
    expect(faultPeak).toBeLessThan(normalPeak * 0.75);
  });

  it('reduces flat dynamics-scope amplitude when the imported motor_efficiency_loss fault is preloaded', async () => {
    const { scopeSamples: normalScopeSamples, scopePeak: normalPeak } = await measurePackageDynamicsScopePeak(
      'evtol_small_nonlinear.json'
    );
    const { scopeSamples: faultScopeSamples, scopePeak: faultPeak } = await measurePackageDynamicsScopePeak(
      'evtol_small_nonlinear_fault_injected.json'
    );

    expect(normalScopeSamples.length).toBeGreaterThan(0);
    expect(faultScopeSamples.length).toBeGreaterThan(0);
    expect(normalPeak).toBeGreaterThan(0.01);
    expect(faultPeak).toBeGreaterThan(0);
    expect(faultPeak).toBeLessThan(normalPeak * 0.75);
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
