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
      'airspeed_sensor',
      'barometer_sensor',
      'electrical_fault_injector',
      'flow_block',
      'gain_block',
      'instrument_logger',
      'instrument_multimeter',
      'instrument_scope',
      'instrument_spectrum',
      'link_can',
      'link_normal',
      'middle_var_assign',
      'mux_block',
      'physical_fault_injector',
      'protocol_fault_injector',
      'signal_source',
      'signal_source_command',
      'signal_source_digital',
      'signal_source_rf',
      'simulation_block',
      'subsystem_block',
      'subsystem_in_port',
      'subsystem_out_port',
      'sum_block'
    ]);
  });

  it('defines complete metadata for every registered component', () => {
    Object.entries(COMPONENT_REGISTRY).forEach(([type, definition]) => {
      expect(definition.type).toBe(type);
      expect(definition.group).toEqual(expect.any(String));
      expect(definition.group).not.toHaveLength(0);
      expect(definition.label).toEqual(expect.any(String));
      expect(definition.label).not.toHaveLength(0);
      expect(definition.badge).toEqual(expect.any(String));
      expect(definition.badge).not.toHaveLength(0);
      expect(definition.className).toEqual(expect.any(String));
      expect(definition.className).not.toHaveLength(0);
      expect(definition.width).toEqual(expect.any(Number));
      expect(definition.height).toEqual(expect.any(Number));
      expect(definition.defaults).toEqual(expect.any(Object));
      expect(Array.isArray(definition.defaults)).toBe(false);

      if (definition.palette?.visible === false) {
        return;
      }

      expect(definition.palette).toEqual(expect.any(Object));
      expect(definition.palette.icon).toEqual(expect.any(String));
      expect(definition.palette.icon).not.toHaveLength(0);
      expect(definition.palette.iconClass).toEqual(expect.any(String));
      expect(definition.palette.iconClass).not.toHaveLength(0);
    });
  });

  it('builds legacy component library entries from registered components', () => {
    const library = buildComponentLibraryFromRegistry();

    expect(library.signal_source).toMatchObject({
      label: '模拟信号源',
      badge: '模拟',
      className: 'b-source',
      width: 164,
      height: 84,
      nodeType: 'signal_source',
      defaults: {
        name: '模拟信号源',
        signalDomain: 'analog',
        waveType: '正弦',
        amplitude: '1.0',
        frequency: '1.0',
        outputFormat: '标量'
      }
    });

    expect(library.signal_source_digital).toMatchObject({
      label: '数字信号源',
      nodeType: 'signal_source',
      defaults: {
        name: '数字信号源',
        signalDomain: 'digital',
        initialState: '0'
      }
    });

    expect(library.signal_source_command).toMatchObject({
      label: '指令信号源',
      nodeType: 'signal_source',
      defaults: {
        name: '指令信号源',
        signalDomain: 'command',
        protocol: 'CAN',
        payloadKind: 'float32'
      }
    });

    expect(library.signal_source_rf).toMatchObject({
      label: '射频信号源',
      nodeType: 'signal_source',
      defaults: {
        name: '射频信号源',
        signalDomain: 'rf',
        powerUnit: 'dBm'
      }
    });

    expect(library.flow_block).toMatchObject({
      label: '信号适配块',
      badge: '适配',
      className: 'b-flow',
      defaults: {
        name: '信号适配块',
        inputName: '输入信号',
        inputFormat: '标量',
        outputName: '输出信号',
        outputFormat: '标量'
      }
    });

    expect(library.physical_fault_injector).toMatchObject({
      label: '物理层注入',
      badge: '故障',
      className: 'b-fault',
      width: 196,
      height: 96,
      defaults: {
        name: '物理层注入',
        faultType: '物理参数故障',
        layer: '物理层',
        layerKey: 'physical'
      }
    });

    expect(library.airspeed_sensor).toMatchObject({
      label: '空速传感器',
      badge: '仿真',
      className: 'b-sim',
      nodeType: 'simulation_block',
      defaults: {
        name: '空速传感器',
        moduleType: '传感器模型',
        inputs: [{ name: '真实空速', type: '标量', varName: 'true_airspeed', unit: 'm/s' }],
        outputs: [{ name: '测量空速', type: '标量', varName: 'measured_airspeed', unit: 'm/s' }],
        parameters: [
          { key: 'bias', name: '零偏', layer: 'physical', default: 0, unit: 'm/s' },
          { key: 'scale', name: '比例系数', layer: 'physical', default: 1 }
        ]
      }
    });

    expect(library.barometer_sensor.faultSlots).toEqual([
      expect.objectContaining({
        slotId: 'physical:barometer_bias',
        layer: 'physical',
        targetField: 'params.bias'
      }),
      expect.objectContaining({
        slotId: 'physical:barometer_scale',
        layer: 'physical',
        targetField: 'params.scale'
      })
    ]);

    expect(library.instrument_spectrum).toMatchObject({
      label: '频谱分析仪',
      badge: '频谱',
      className: 'b-inst',
      defaults: {
        name: '频谱分析仪',
        instrumentType: '频谱分析',
        sampleRate: '32kHz',
        frequencyRange: '0-16kHz',
        fftSize: '1024',
        windowFunction: 'Hann',
        amplitudeUnit: 'dB'
      }
    });

    expect(library.instrument_multimeter).toMatchObject({
      label: '数字万用表',
      badge: '万用表',
      className: 'b-inst',
      defaults: {
        name: '数字万用表',
        instrumentType: '数字万用表',
        measurementMode: '直流电压',
        range: 'Auto',
        refreshRate: '5Hz'
      }
    });

    Object.values(library).forEach((definition) => {
      expect(definition).not.toHaveProperty('group');
    });

    expect(library.sum_block.defaults).not.toBe(COMPONENT_REGISTRY.sum_block.defaults);
    expect(library.sum_block.defaults.signs).not.toBe(COMPONENT_REGISTRY.sum_block.defaults.signs);
    library.sum_block.defaults.signs[0] = '-';
    expect(COMPONENT_REGISTRY.sum_block.defaults.signs[0]).toBe('+');
  });

  it('groups palette components by registry group without mutating registry entries', () => {
    const paletteGroups = getPaletteGroups();
    const signals = paletteGroups.find((group) => group.id === 'signals');
    const signalOps = paletteGroups.find((group) => group.id === 'signal-ops');
    const faults = paletteGroups.find((group) => group.id === 'faults');
    const canLines = paletteGroups.find((group) => group.id === 'can-lines');

    expect(paletteGroups.map((group) => group.id)).toEqual([
      'signals',
      'signal-ops',
      'simulation',
      'subsystem',
      'faults',
      'instruments',
      'can-lines'
    ]);
    expect(paletteGroups[0]).not.toBe(COMPONENT_GROUPS[0]);
    expect(signals.components.map((item) => item.type)).toEqual([
      'signal_source',
      'signal_source_digital',
      'signal_source_command',
      'signal_source_rf'
    ]);
    expect(COMPONENT_REGISTRY.middle_var_assign.palette?.visible).toBe(false);
    expect(signalOps.components.map((item) => item.type)).toEqual([
      'flow_block',
      'gain_block',
      'sum_block',
      'mux_block'
    ]);
    expect(paletteGroups.find((group) => group.id === 'simulation').components.map((item) => item.type)).toEqual([
      'simulation_block',
      'airspeed_sensor',
      'barometer_sensor'
    ]);
    expect(faults.components.map((item) => item.type)).toEqual([
      'physical_fault_injector',
      'electrical_fault_injector',
      'protocol_fault_injector'
    ]);
    expect(paletteGroups.find((group) => group.id === 'instruments').components.map((item) => item.type)).toEqual([
      'instrument_scope',
      'instrument_spectrum',
      'instrument_multimeter'
    ]);
    expect(COMPONENT_REGISTRY.instrument_logger.palette?.visible).toBe(false);
    expect(canLines.components.map((item) => item.type)).toEqual([
      'link_normal',
      'link_can'
    ]);
    expect(signalOps.components[0]).not.toBe(COMPONENT_REGISTRY.flow_block);
    expect(faults.components[0]).not.toBe(COMPONENT_REGISTRY.physical_fault_injector);
    expect(canLines.components[0]).not.toBe(COMPONENT_REGISTRY.link_normal);
    expect(signalOps.components[0].defaults).not.toBe(COMPONENT_REGISTRY.flow_block.defaults);
    signalOps.components[0].defaults.inputName = 'changed input';
    expect(COMPONENT_REGISTRY.flow_block.defaults.inputName).not.toBe('changed input');
  });
});
