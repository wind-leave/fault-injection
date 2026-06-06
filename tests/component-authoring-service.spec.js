import { describe, expect, it } from 'vitest';
import {
  addFaultSlotToComponentTemplate,
  createComponentTemplateFromPython,
  createNodeFromComponentTemplate
} from '../src/services/componentAuthoringService.js';

const parsedInterface = {
  fileName: 'attitude_controller.py',
  moduleName: 'attitude_controller',
  description: '姿态控制器',
  entryFunction: 'process',
  inputs: [
    { name: 'attitude_error', displayName: '姿态误差', type: 'float', comment: '姿态误差' },
    { name: 'rate_feedback', displayName: '角速度反馈', type: 'float', comment: '角速度反馈' }
  ],
  outputs: [
    { name: 'output_0', displayName: '力矩指令', type: 'float', comment: '力矩指令' }
  ],
  middleVars: [
    { name: 'control_error', displayName: '控制误差', type: 'float', comment: '控制误差' }
  ],
  rawSource: 'def process(attitude_error, rate_feedback): return attitude_error'
};

describe('componentAuthoringService', () => {
  it('creates a component template from a parsed Python interface', () => {
    const template = createComponentTemplateFromPython({
      templateId: 'attitude-controller',
      displayName: '姿态控制器',
      category: '控制模块',
      geometry: 'rect',
      parsedInterface
    });

    expect(template).toMatchObject({
      templateId: 'attitude-controller',
      type: 'simulation_block',
      displayName: '姿态控制器',
      category: '控制模块',
      geometry: 'rect',
      parameters: [],
      faultSlots: []
    });
    expect(template.ports.inputs).toEqual([
      expect.objectContaining({
        signalId: 'attitude_controller.attitude_error',
        varName: 'attitude_error',
        name: '姿态误差',
        displayName: '姿态误差',
        type: 'float',
        direction: 'input'
      }),
      expect.objectContaining({
        signalId: 'attitude_controller.rate_feedback',
        varName: 'rate_feedback',
        name: '角速度反馈',
        displayName: '角速度反馈',
        type: 'float',
        direction: 'input'
      })
    ]);
    expect(template.ports.outputs).toEqual([
      expect.objectContaining({
        signalId: 'attitude_controller.output_0',
        varName: 'output_0',
        name: '力矩指令',
        displayName: '力矩指令',
        type: 'float',
        direction: 'output'
      })
    ]);
    expect(template.pythonBinding).toMatchObject({
      bound: true,
      moduleId: 'attitude_controller',
      fileName: 'attitude_controller.py',
      moduleName: 'attitude_controller',
      entryFunction: 'process',
      portMapping: {
        inputs: [
          expect.objectContaining({ signalId: 'attitude_controller.attitude_error', varName: 'attitude_error' }),
          expect.objectContaining({ signalId: 'attitude_controller.rate_feedback', varName: 'rate_feedback' })
        ],
        outputs: [
          expect.objectContaining({ signalId: 'attitude_controller.output_0', varName: 'output_0' })
        ],
        middleVars: [
          expect.objectContaining({ signalId: 'attitude_controller.control_error', varName: 'control_error' })
        ]
      }
    });
    expect(template.stateVariables).toEqual([
      expect.objectContaining({
        signalId: 'attitude_controller.control_error',
        varName: 'control_error',
        name: '控制误差',
        displayName: '控制误差',
        type: 'float'
      })
    ]);
  });

  it('adds fault slots immutably and replaces slots with the same slotId', () => {
    const template = createComponentTemplateFromPython({
      templateId: 'attitude-controller',
      displayName: '姿态控制器',
      category: '控制模块',
      geometry: 'rect',
      parsedInterface
    });
    const slot = {
      slotId: 'actuator-output',
      displayName: '输出通道故障',
      allowedFaultTypeIds: ['bias_fault']
    };

    const next = addFaultSlotToComponentTemplate(template, slot);
    const replaced = addFaultSlotToComponentTemplate(next, {
      ...slot,
      allowedFaultTypeIds: ['bias_fault', 'stuck_fault']
    });

    expect(next).not.toBe(template);
    expect(next.faultSlots).toEqual([
      {
        slotId: 'actuator-output',
        displayName: '输出通道故障',
        slotName: '输出通道故障',
        kind: 'output_signal',
        allowedFaultTypeIds: ['bias_fault']
      }
    ]);
    expect(template.faultSlots).toEqual([]);
    expect(replaced.faultSlots).toEqual([
      {
        slotId: 'actuator-output',
        displayName: '输出通道故障',
        slotName: '输出通道故障',
        kind: 'output_signal',
        allowedFaultTypeIds: ['bias_fault', 'stuck_fault']
      }
    ]);
  });

  it('creates a simulation canvas node from a component template', () => {
    const template = addFaultSlotToComponentTemplate(
      createComponentTemplateFromPython({
        templateId: 'attitude-controller',
        displayName: '姿态控制器',
        category: '控制模块',
        geometry: 'rect',
        parsedInterface
      }),
      { slotId: 'controller-input', displayName: '输入故障', allowedFaultIds: ['bias_fault'] }
    );

    const node = createNodeFromComponentTemplate(template, {
      id: 'node-attitude-controller',
      x: 320,
      y: 240
    });

    expect(node).toMatchObject({
      id: 'node-attitude-controller',
      templateId: 'attitude-controller',
      type: 'simulation_block',
      x: 320,
      y: 240,
      geometry: 'rect',
      props: {
        name: '姿态控制器',
        moduleType: '控制模块',
        inputs: [
          expect.objectContaining({ name: '姿态误差', type: 'float' }),
          expect.objectContaining({ name: '角速度反馈', type: 'float' })
        ],
        outputs: [
          expect.objectContaining({ name: '力矩指令', type: 'float' })
        ],
        middleVars: [
          expect.objectContaining({ name: '控制误差', type: 'float' })
        ]
      },
      faultSlots: [
        {
          slotId: 'controller-input',
          displayName: '输入故障',
          slotName: '输入故障',
          kind: 'output_signal',
          allowedFaultTypeIds: ['bias_fault']
        }
      ],
      pythonBinding: expect.objectContaining({
        bound: true,
        moduleId: 'attitude_controller',
        entryFunction: 'process'
      })
    });
    expect(node.ports).toEqual(template.ports);
    expect(node.parameters).toEqual(template.parameters);
    expect(node.stateVariables).toEqual(template.stateVariables);
    expect(node.pythonBinding).toEqual(template.pythonBinding);
    expect(node.pythonBinding).not.toBe(template.pythonBinding);
    expect(node.faultSlots).not.toBe(template.faultSlots);
  });

  it('throws when required Python template metadata is missing', () => {
    expect(() => createComponentTemplateFromPython({ parsedInterface })).toThrow('Missing templateId');
    expect(() =>
      createComponentTemplateFromPython({
        templateId: 'missing-entry',
        parsedInterface: { ...parsedInterface, entryFunction: '' }
      })
    ).toThrow('Missing parsed Python entry function');
  });
});
