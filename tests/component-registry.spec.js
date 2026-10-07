import { describe, expect, it } from 'vitest';
import {
  COMPONENT_GROUPS,
  COMPONENT_REGISTRY,
  SIMULATION_MENU_SECTIONS,
  buildComponentLibraryFromRegistry,
  createPythonSimulationComponent,
  getPaletteGroups,
  getSimulationMenuSections
} from '../src/services/componentRegistry.js';
import { DISPLAY_CONSOLE_PRESETS } from '../src/constants/displayConsoleConfig.js';

describe('component registry', () => {
  it('registers independent RF complex-envelope processing components', () => {
    const componentIds = [
      'rf_complex_envelope_selector',
      'rf_complex_envelope_gain',
      'rf_complex_envelope_limiter',
      'rf_complex_envelope_band_pass_filter',
      'rf_complex_envelope_amplitude_phase_modulator',
      'rf_complex_envelope_downconverter',
      'rf_complex_envelope_vector4_dual_output_receiver',
      'rf_complex_envelope_upconverter'
    ];

    componentIds.forEach((componentId) => {
      const component = COMPONENT_REGISTRY[componentId];
      expect(component).toBeDefined();
      expect(component.ports.inputs.every((port) => port.dataType === 'rf_complex_envelope')).toBe(true);
      expect(component.ports.outputs.every((port) => port.dataType === 'rf_complex_envelope')).toBe(true);
      expect(component.pythonBinding.moduleId).toBe(componentId);
    });
    expect(COMPONENT_REGISTRY.rf_complex_envelope_selector.ports.inputs).toHaveLength(2);

    [
      'rf_complex_envelope_selector',
      'rf_complex_envelope_limiter',
      'rf_complex_envelope_band_pass_filter',
      'rf_complex_envelope_amplitude_phase_modulator',
      'rf_complex_envelope_downconverter',
      'rf_complex_envelope_vector4_dual_output_receiver',
      'rf_complex_envelope_upconverter'
    ].forEach((componentId) => {
      const component = COMPONENT_REGISTRY[componentId];
      [...component.ports.inputs, ...component.ports.outputs].forEach((port) => {
        expect(port).toMatchObject({
          dataType: 'rf_complex_envelope',
          collectionKind: 'vector',
          vectorLength: 4
        });
      });
    });
  });

  it('defines the four-route complex-envelope receiver with two four-route outputs', () => {
    const component = COMPONENT_REGISTRY.rf_complex_envelope_vector4_dual_output_receiver;

    expect(component.ports.inputs).toEqual([
      expect.objectContaining({
        portId: 'input-0',
        varName: 'input_envelope_vector',
        dataType: 'rf_complex_envelope',
        collectionKind: 'vector',
        vectorLength: 4
      })
    ]);
    expect(component.ports.outputs).toEqual([
      expect.objectContaining({
        portId: 'output-0',
        varName: 'output_envelope_vector_1',
        dataType: 'rf_complex_envelope',
        collectionKind: 'vector',
        vectorLength: 4
      }),
      expect.objectContaining({
        portId: 'output-1',
        varName: 'output_envelope_vector_2',
        dataType: 'rf_complex_envelope',
        collectionKind: 'vector',
        vectorLength: 4
      })
    ]);
  });

  it('defines a separate complex-envelope pulse feature extractor', () => {
    const component = COMPONENT_REGISTRY.rf_complex_envelope_pulse_feature_extractor;

    expect(component).toMatchObject({
      nodeType: 'simulation_block',
      simulationMenu: 'rf-signal',
      pythonBinding: {
        moduleId: 'rf_complex_envelope_pulse_feature_extractor',
        executionMode: 'backend'
      }
    });
    expect(component.defaults.inputs).toEqual([
      expect.objectContaining({
        name: '四路复数包络输入',
        varName: 'input_envelope_vector'
      })
    ]);
    expect(component.ports.inputs).toEqual([
      expect.objectContaining({
        varName: 'input_envelope_vector',
        dataType: 'rf_complex_envelope',
        collectionKind: 'vector',
        vectorLength: 4,
        unit: 'V'
      })
    ]);
    expect(component.ports.outputs).toHaveLength(5);
    expect(component.ports.outputs.every((port) => port.type === 'float')).toBe(true);
  });

  it('defines the four-port up/down converter as named two-element vector ports', () => {
    const component = COMPONENT_REGISTRY.rf_four_port_up_down_converter;

    expect(component.ports.inputs).toEqual([
      expect.objectContaining({
        varName: 'downconvert_rf_inputs',
        dataType: 'vector',
        vectorLength: 2,
        vectorElementNames: ['下变频射频输入 1', '下变频射频输入 2']
      }),
      expect.objectContaining({
        varName: 'upconvert_baseband_inputs',
        dataType: 'vector',
        vectorLength: 2,
        vectorElementNames: ['上变频基带输入 1（I）', '上变频基带输入 2（I）']
      })
    ]);
    expect(component.ports.outputs).toEqual([
      expect.objectContaining({
        varName: 'downconverted_baseband_outputs',
        dataType: 'vector',
        vectorLength: 2,
        vectorElementNames: ['下变频基带输出 1（I）', '下变频基带输出 2（I）']
      }),
      expect.objectContaining({
        varName: 'upconverted_rf_outputs',
        dataType: 'vector',
        vectorLength: 2,
        vectorElementNames: ['上变频射频输出 1', '上变频射频输出 2']
      })
    ]);
  });

  it('does not expose sensor models in the simulation component palette', () => {
    const simulationTypes = getPaletteGroups()
      .find((group) => group.id === 'simulation')
      ?.components.map((item) => item.type) ?? [];

    expect(SIMULATION_MENU_SECTIONS.map((section) => section.id)).not.toContain('sensing');
    expect(simulationTypes).not.toContain('airspeed_sensor');
    expect(simulationTypes).not.toContain('barometer_sensor');
    expect(COMPONENT_REGISTRY).not.toHaveProperty('airspeed_sensor');
    expect(COMPONENT_REGISTRY).not.toHaveProperty('barometer_sensor');
    expect(buildComponentLibraryFromRegistry()).not.toHaveProperty('airspeed_sensor');
    expect(buildComponentLibraryFromRegistry()).not.toHaveProperty('barometer_sensor');
  });

  it('sizes Python simulation components from the largest port count unless dimensions are supplied', () => {
    const automatic = createPythonSimulationComponent({
      type: 'vector_imu_test',
      label: '四端口 IMU',
      moduleType: '传感器模型',
      inputs: Array.from({ length: 4 }, (_, index) => ({
        portId: `input-${index}`,
        varName: `input_${index}`,
        name: `输入 ${index + 1}`
      })),
      outputs: [{ portId: 'output-0', varName: 'output_0', name: '输出 1' }]
    });
    const explicit = createPythonSimulationComponent({
      type: 'explicit_size_test',
      label: '显式尺寸组件',
      moduleType: '传感器模型',
      width: 240,
      height: 180,
      inputs: [{ portId: 'input-0', varName: 'input_0', name: '输入 1' }],
      outputs: [{ portId: 'output-0', varName: 'output_0', name: '输出 1' }]
    });

    expect(automatic.width).toBe(228);
    expect(automatic.height).toBe(204);
    expect(explicit.width).toBe(240);
    expect(explicit.height).toBe(180);
  });

  it('preserves independently configured left and right positions for inputs and outputs', () => {
    const component = createPythonSimulationComponent({
      type: 'reversed-port-positions',
      label: '反向端口组件',
      moduleType: '测试模型',
      inputs: [{ portId: 'input-0', varName: 'feedback', name: '反馈输入', side: 'right', sidePosition: 3 }],
      outputs: [{ portId: 'output-0', varName: 'command', name: '控制输出', side: 'left', sidePosition: 3 }]
    });

    expect(component.ports.inputs[0].side).toBe('right');
    expect(component.ports.outputs[0].side).toBe('left');
    expect(component.defaults.inputs[0].side).toBe('right');
    expect(component.defaults.outputs[0].side).toBe('left');
    expect(component.pythonBinding.portMapping.inputs[0].side).toBe('right');
    expect(component.pythonBinding.portMapping.outputs[0].side).toBe('left');
    expect(component.ports.inputs[0].sidePosition).toBe(3);
    expect(component.ports.outputs[0].sidePosition).toBe(3);
    expect(component.defaults.inputs[0].sidePosition).toBe(3);
    expect(component.defaults.outputs[0].sidePosition).toBe(3);
    expect(component.pythonBinding.portMapping.inputs[0].sidePosition).toBe(3);
    expect(component.pythonBinding.portMapping.outputs[0].sidePosition).toBe(3);
  });

  it('preserves configured scalar element names throughout the generated component contract', () => {
    const component = createPythonSimulationComponent({
      type: 'named-scalar-elements',
      label: '标量元素命名测试',
      moduleType: '测试模型',
      inputs: [{
        portId: 'input-0',
        varName: 'frequency_in',
        name: '频率输入',
        elementNames: ['输入频率']
      }],
      outputs: [{
        portId: 'output-0',
        varName: 'frequency_out',
        name: '频率输出',
        elementName: '输出频率'
      }]
    });

    expect(component.ports.inputs[0].elementNames).toEqual(['输入频率']);
    expect(component.ports.outputs[0].elementNames).toEqual(['输出频率']);
    expect(component.defaults.inputs[0].elementNames).toEqual(['输入频率']);
    expect(component.defaults.outputs[0].elementNames).toEqual(['输出频率']);
    expect(component.pythonBinding.parsedInterface.inputs[0].elementNames).toEqual(['输入频率']);
    expect(component.pythonBinding.parsedInterface.outputs[0].elementNames).toEqual(['输出频率']);
    expect(component.pythonBinding.portMapping.inputs[0].elementNames).toEqual(['输入频率']);
    expect(component.pythonBinding.portMapping.outputs[0].elementNames).toEqual(['输出频率']);
  });

  it('initializes editable simulation parameter values from the component defaults', () => {
    const component = createPythonSimulationComponent({
      type: 'parameterized_test',
      label: '参数化测试组件',
      moduleType: '测试模型',
      inputs: [],
      outputs: [{ portId: 'output-0', varName: 'output', name: '输出' }],
      parameters: [
        { key: 'gain', name: '增益', default: 2 },
        { key: 'bias', name: '偏置', default: -0.5 }
      ]
    });

    expect(component.defaults.parameterValues).toEqual({ gain: 2, bias: -0.5 });
    expect(component.faultSlots).toEqual([
      expect.objectContaining({
        slotId: 'physical:parameter:gain',
        targetField: 'params.gain',
        parameterKey: 'gain',
        layer: 'physical'
      }),
      expect.objectContaining({
        slotId: 'physical:parameter:bias',
        targetField: 'params.bias',
        parameterKey: 'bias',
        layer: 'physical'
      })
    ]);
  });

  it('initializes RF downconverter parameter slots for immediate physical fault injection', () => {
    const component = COMPONENT_REGISTRY.rf_downconverter;

    expect(component.faultSlots).toContainEqual(expect.objectContaining({
      slotId: 'physical:parameter:lo_frequency_hz',
      targetField: 'params.lo_frequency_hz',
      parameterKey: 'lo_frequency_hz',
      layer: 'physical',
      unit: 'Hz'
    }));
  });

  it('defines fixed-id electrical components with the requested AC/DC interfaces', () => {
    const acSource = COMPONENT_REGISTRY.electrical_ac_power_source;
    const dcSource = COMPONENT_REGISTRY.electrical_dc_power_source;
    const dcBoost = COMPONENT_REGISTRY.electrical_dc_boost;
    const acDcMatching = COMPONENT_REGISTRY.electrical_ac_dc_matching;

    expect([acSource, dcSource, dcBoost, acDcMatching].every((component) => (
      component.group === 'electrical' && component.nodeType === 'simulation_block'
    ))).toBe(true);
    expect(acSource.templateId).toBe('electrical_ac_power_source');
    expect(acSource.ports.outputs.map((port) => port.varName)).toEqual(['ac_phase_a', 'ac_phase_b', 'ac_phase_c']);
    expect(dcSource.templateId).toBe('electrical_dc_power_source');
    expect(dcSource.ports.outputs).toEqual([expect.objectContaining({ varName: 'dc_output', unit: 'VDC' })]);
    expect(dcSource.defaults.parameterValues).toMatchObject({ output_voltage: 28 });
    expect(dcBoost.templateId).toBe('electrical_dc_boost');
    expect(acDcMatching.templateId).toBe('electrical_ac_dc_matching');
    expect(dcBoost.ports.inputs).toEqual([expect.objectContaining({ varName: 'dc_input', unit: 'VDC' })]);
    expect(dcBoost.ports.outputs).toEqual([expect.objectContaining({ varName: 'dc_output', unit: 'VDC' })]);
    expect(acDcMatching.ports.inputs).toEqual([expect.objectContaining({ varName: 'ac_input', unit: 'VAC' })]);
    expect(acDcMatching.ports.outputs).toEqual([expect.objectContaining({ varName: 'dc_output', unit: 'VDC' })]);
    expect(COMPONENT_REGISTRY.electrical_ground).toBeUndefined();
  });

  it('defines the existing left palette groups in display order', () => {
    expect(COMPONENT_GROUPS.map((group) => group.id)).toEqual([
      'signals',
      'electrical',
      'simulation',
      'subsystem',
      'faults',
      'instruments',
      'display-control',
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
      '11',
      'DZDK_A',
      'DZDK_B',
      'DZDK_C',
      'DZDK_D',
      'XHFSQ',
      'display_console',
      'display_console_1',
      'display_console_2',
      'display_console_3',
      'display_console_4',
      'display_console_5',
      'display_console_6',
      'display_console_7',
      'electrical_ac_dc_matching',
      'electrical_ac_power_source',
      'electrical_dc_boost',
      'electrical_dc_power_source',
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
      'rf_amplitude_phase_modulator',
      'rf_band_pass_filter',
      'rf_complex_envelope_amplitude_phase_modulator',
      'rf_complex_envelope_band_pass_filter',
      'rf_complex_envelope_downconverter',
      'rf_complex_envelope_gain',
      'rf_complex_envelope_limiter',
      'rf_complex_envelope_pulse_feature_extractor',
      'rf_complex_envelope_scalar_source',
      'rf_complex_envelope_selector',
      'rf_complex_envelope_to_vector4',
      'rf_complex_envelope_upconverter',
      'rf_complex_envelope_vector4_dual_output_receiver',
      'rf_complex_envelope_vector4_power_divider',
      'rf_downconverter',
      'rf_four_channel_source',
      'rf_four_output_source',
      'rf_four_port_up_down_converter',
      'rf_limit_amplify_downconvert_split8',
      'rf_pulse_feature_extractor',
      'scalar_to_vector4',
      'signal_source',
      'signal_source_command',
      'signal_source_digital',
      'signal_source_rf',
      'simulation_block',
      'subsystem_block',
      'subsystem_block_2',
      'subsystem_block_3',
      'subsystem_block_4',
      'subsystem_in_port',
      'subsystem_out_port',
      'sum_block',
      'vector2_passthrough'
    ]);
  });

  it('keeps the four subsystem names and ids separately configurable', () => {
    const ids = ['subsystem_block', 'subsystem_block_2', 'subsystem_block_3', 'subsystem_block_4'];
    expect(ids.map((id) => [
      COMPONENT_REGISTRY[id].label,
      COMPONENT_REGISTRY[id].defaults.name,
      COMPONENT_REGISTRY[id].defaults.subsystemId
    ])).toEqual([
      ['子系统块', '子系统块', 'subsystem-block-1'],
      ['子系统块 2', '子系统块 2', 'subsystem-block-2'],
      ['子系统块 3', '子系统块 3', 'subsystem-block-3'],
      ['子系统块 4', '子系统块 4', 'subsystem-block-4']
    ]);
  });

  it('defines a Python-backed fixed-length two-dimensional vector component', () => {
    expect(COMPONENT_REGISTRY.vector2_passthrough).toMatchObject({
      nodeType: 'simulation_block',
      templateId: 'vector2_passthrough',
      pythonBinding: {
        moduleId: 'vector2_passthrough',
        executionMode: 'backend'
      },
      ports: {
        inputs: [{
          varName: 'input_vector',
          dataType: 'vector',
          vectorLength: 2
        }],
        outputs: [{
          varName: 'output_vector',
          dataType: 'vector',
          vectorLength: 2
        }]
      }
    });
  });

  it('defines the four DZDK signal-processing components with sequential socket port ids', () => {
    expect(COMPONENT_REGISTRY.DZDK_A.ports.inputs.map((port) => port.portId)).toEqual(['socket01']);
    expect(COMPONENT_REGISTRY.DZDK_A.ports.outputs.map((port) => port.portId)).toEqual(['socket02']);
    expect(COMPONENT_REGISTRY.DZDK_B.ports.inputs.map((port) => port.portId)).toEqual(['socket01']);
    expect(COMPONENT_REGISTRY.DZDK_B.ports.outputs.map((port) => port.portId)).toEqual(['socket02']);
    expect(COMPONENT_REGISTRY.DZDK_C.ports.inputs.map((port) => port.portId)).toEqual(['socket01']);
    expect(COMPONENT_REGISTRY.DZDK_C.ports.outputs.map((port) => port.portId)).toEqual(['socket02', 'socket03']);
    expect(COMPONENT_REGISTRY.DZDK_D.ports.inputs.map((port) => port.portId)).toEqual(['socket01']);
    expect(COMPONENT_REGISTRY.DZDK_D.ports.outputs.map((port) => port.portId)).toEqual(['socket02', 'socket03', 'socket04']);
    expect(['DZDK_A', 'DZDK_B', 'DZDK_C', 'DZDK_D'].every((type) => COMPONENT_REGISTRY[type].defaults.powerInputs.length === 0)).toBe(true);
    expect(Object.values(COMPONENT_REGISTRY).filter((component) => /^DZDK_[A-D]$/.test(component.type))
      .every((component) => component.pythonBinding.executionMode === 'backend')).toBe(true);
  });

  it('defines backend-executable RF band-pass and I/Q amplitude-phase components', () => {
    expect(COMPONENT_REGISTRY.rf_band_pass_filter).toMatchObject({
      pythonBinding: { moduleId: 'rf_band_pass_filter', executionMode: 'backend' },
      ports: {
        inputs: [{ varName: 'rf_input' }],
        outputs: [{ varName: 'filtered_signal' }]
      }
    });
    expect(COMPONENT_REGISTRY.rf_amplitude_phase_modulator).toMatchObject({
      pythonBinding: { moduleId: 'rf_amplitude_phase_modulator', executionMode: 'backend' },
      ports: {
        inputs: [{ varName: 'input_i' }, { varName: 'input_q' }],
        outputs: [{ varName: 'output_i' }, { varName: 'output_q' }]
      }
    });
  });

  it('defines a scalar input to four-value vector simulation component', () => {
    expect(COMPONENT_REGISTRY.scalar_to_vector4).toMatchObject({
      nodeType: 'simulation_block',
      templateId: 'scalar_to_vector4',
      simulationMenu: 'signal-processing',
      ports: {
        inputs: [{ varName: 'scalar_input', type: 'float' }],
        outputs: [{ varName: 'vector_output', dataType: 'vector', vectorLength: 4 }]
      },
      pythonBinding: {
        moduleId: 'scalar_to_vector4',
        executionMode: 'backend'
      }
    });
  });

  it('defines a complex-envelope scalar to four-route vector simulation component', () => {
    const component = COMPONENT_REGISTRY.rf_complex_envelope_to_vector4;
    expect(component).toMatchObject({
      nodeType: 'simulation_block',
      templateId: 'rf_complex_envelope_to_vector4',
      simulationMenu: 'rf-signal',
      ports: {
        inputs: [{ varName: 'input_envelope', dataType: 'rf_complex_envelope' }],
        outputs: [{
          varName: 'envelope_vector',
          dataType: 'rf_complex_envelope',
          collectionKind: 'vector',
          vectorLength: 4
        }]
      },
      pythonBinding: {
        moduleId: 'rf_complex_envelope_to_vector4',
        executionMode: 'backend'
      }
    });
    expect(component.ports.inputs[0]).not.toHaveProperty('collectionKind');
  });

  it('defines a no-input scalar complex-envelope source', () => {
    const component = COMPONENT_REGISTRY.rf_complex_envelope_scalar_source;
    expect(component).toMatchObject({
      nodeType: 'simulation_block',
      templateId: 'rf_complex_envelope_scalar_source',
      simulationMenu: 'rf-signal',
      ports: {
        inputs: [],
        outputs: [{
          varName: 'output_envelope',
          dataType: 'rf_complex_envelope',
          unit: 'V'
        }]
      },
      defaults: {
        inputs: [],
        powerInputs: [],
        parameterValues: {
          pulse_width_seconds: 0.001,
          pulse_period_seconds: 0.01,
          center_frequency_hz: 10,
          power_dbm: 0
        }
      },
      pythonBinding: {
        moduleId: 'rf_complex_envelope_scalar_source',
        executionMode: 'backend'
      }
    });
    expect(component.ports.outputs[0]).not.toHaveProperty('collectionKind');
    expect(component.ports.outputs[0]).not.toHaveProperty('vectorLength');
    expect(component.defaults.parameters.map((parameter) => parameter.name)).toEqual([
      '脉宽',
      '重周',
      '中心频率',
      '功率'
    ]);
  });

  it('defines a four-route complex-envelope power-divider simulation component', () => {
    const component = COMPONENT_REGISTRY.rf_complex_envelope_vector4_power_divider;
    expect(component).toMatchObject({
      nodeType: 'simulation_block',
      templateId: 'rf_complex_envelope_vector4_power_divider',
      simulationMenu: 'rf-signal',
      ports: {
        inputs: [{
          varName: 'input_envelope',
          dataType: 'rf_complex_envelope'
        }],
        outputs: [{
          varName: 'output_envelope_vector',
          dataType: 'rf_complex_envelope',
          collectionKind: 'vector',
          vectorLength: 4
        }]
      },
      pythonBinding: {
        moduleId: 'rf_complex_envelope_vector4_power_divider',
        executionMode: 'backend'
      }
    });
    expect(component.ports.inputs[0]).not.toHaveProperty('collectionKind');
  });

  it('derives display-console templates from the editable presets', () => {
    expect(COMPONENT_REGISTRY.display_console_1).toMatchObject({
      type: 'display_console_1',
      nodeType: 'display_console',
      templateId: 'display_console_1',
      group: 'display-control',
      label: '显控台 1',
      defaults: {
        consoleType: '射频参数显控',
        inputPortNames: [
          '中心频率（MHz）',
          '重复周期（μs）',
          '脉宽（μs）',
          '幅度',
          '频段编码',
          '波形编码',
          '调制方式编码'
        ]
      }
    });
    expect(COMPONENT_REGISTRY.display_console_2).toMatchObject({
      type: 'display_console_2',
      nodeType: 'display_console',
      templateId: 'display_console_2',
      label: '显控台 2',
      defaults: { displayConfig: { ports: [
        expect.objectContaining({ id: 'console-input', name: '通道 A' }),
        expect.objectContaining({ id: 'console-input-2', name: '通道 B' })
      ] } }
    });
    expect(COMPONENT_REGISTRY.display_console_7).toMatchObject({
      type: 'display_console_7',
      nodeType: 'display_console',
      templateId: 'display_console_7',
      label: '显控台 7'
    });
    expect(COMPONENT_REGISTRY.display_console_7.palette.icon).toBe('显7');
    const configuredTemplates = Object.keys(DISPLAY_CONSOLE_PRESETS);
    expect(getPaletteGroups().find((group) => group.id === 'display-control')?.components.map((item) => item.type))
      .toEqual(configuredTemplates);
    expect(configuredTemplates.every((templateId) => COMPONENT_REGISTRY[templateId]?.templateId === templateId)).toBe(true);
  });

  it('defines a no-input RF source with one four-value vector output', () => {
    expect(COMPONENT_REGISTRY.rf_four_channel_source).toMatchObject({
      nodeType: 'simulation_block',
      templateId: 'rf_four_channel_source',
      defaults: {
        inputs: [],
        outputs: [{ name: '射频数据（四组）', varName: 'rf_samples', dataType: 'vector', vectorLength: 4 }],
        parameters: [
          { key: 'sample_1', default: 1.0 },
          { key: 'sample_2', default: 0.8 },
          { key: 'sample_3', default: 0.6 },
          { key: 'sample_4', default: 0.4 },
          { key: 'center_frequency_hz', default: 100 },
          { key: 'pulse_width_seconds', default: 0.001 },
          { key: 'pulse_period_seconds', default: 0.001 },
          { key: 'phase_deg', default: 0 }
        ]
      },
      ports: {
        inputs: [],
        outputs: [{ varName: 'rf_samples', dataType: 'vector', vectorLength: 4 }]
      },
      pythonBinding: {
        moduleId: 'rf_four_channel_source',
        executionMode: 'backend'
      }
    });
  });

  it('defines an RF processing component with one four-value input and eight scalar outputs', () => {
    const component = COMPONENT_REGISTRY.rf_limit_amplify_downconvert_split8;

    expect(component.defaults.inputs).toHaveLength(1);
    expect(component.defaults.outputs).toHaveLength(8);
    expect(component.ports.inputs).toEqual([expect.objectContaining({
      varName: 'rf_input',
      dataType: 'vector',
      vectorLength: 4
    })]);
    expect(component.ports.outputs).toHaveLength(8);
    expect(component.ports.outputs.every((port) => port.type === 'float' && !port.dataType)).toBe(true);
    expect(component.pythonBinding).toMatchObject({
      moduleId: 'rf_limit_amplify_downconvert_split8',
      executionMode: 'backend'
    });
  });

  it('defines an RF pulse feature extractor with separate I/Q inputs and five scalar outputs', () => {
    const component = COMPONENT_REGISTRY.rf_pulse_feature_extractor;

    expect(component).toMatchObject({
      nodeType: 'simulation_block',
      simulationMenu: 'rf-signal',
      pythonBinding: {
        moduleId: 'rf_pulse_feature_extractor',
        executionMode: 'backend'
      }
    });
    expect(component.defaults.inputs).toEqual([
      expect.objectContaining({ name: '中频 I', varName: 'if_i', type: '标量' }),
      expect.objectContaining({ name: '中频 Q', varName: 'if_q', type: '标量' })
    ]);
    expect(component.defaults.outputs).toEqual([
      expect.objectContaining({ name: '中心频率', varName: 'center_frequency_hz', type: '标量' }),
      expect.objectContaining({ name: '重复周期', varName: 'pulse_period_seconds', type: '标量' }),
      expect.objectContaining({ name: '脉宽', varName: 'pulse_width_seconds', type: '标量' }),
      expect.objectContaining({ name: '脉冲幅度', varName: 'pulse_amplitude_adc', type: '标量', unit: 'ADC(0-255)' }),
      expect.objectContaining({ name: '脉冲个数', varName: 'pulse_count', type: '标量', unit: '个' })
    ]);
    expect(component.ports.inputs).toEqual([
      expect.objectContaining({ varName: 'if_i', type: 'float' }),
      expect.objectContaining({ varName: 'if_q', type: 'float' })
    ]);
    expect(component.ports.outputs).toHaveLength(5);
    expect(component.ports.outputs.every((port) => port.type === 'float' && !port.dataType)).toBe(true);
  });

  it('defines a two-input RF downconverter with selectable scalar I/Q outputs', () => {
    const component = COMPONENT_REGISTRY.rf_downconverter;

    expect(component).toMatchObject({
      nodeType: 'simulation_block',
      simulationMenu: 'rf-signal',
      pythonBinding: {
        moduleId: 'rf_downconverter',
        executionMode: 'backend'
      }
    });
    expect(component.ports.inputs).toEqual([
      expect.objectContaining({ varName: 'rf_input', type: 'float' }),
      expect.objectContaining({ varName: 'rf_input_2', type: 'float' })
    ]);
    expect(component.ports.outputs).toEqual([
      expect.objectContaining({ varName: 'if_i', type: 'float' }),
      expect.objectContaining({ varName: 'if_q', type: 'float' }),
      expect.objectContaining({
        varName: 'if_iq',
        dataType: 'vector',
        vectorLength: 2,
        vectorElementNames: ['中频 I', '中频 Q']
      })
    ]);
    expect(component.defaults.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'input_mode',
        default: 1,
        options: [
          { value: 1, label: '模式 1：第一路输入' },
          { value: 2, label: '模式 2：第二路输入' }
        ]
      })
    ]));
  });

  it('hides retired simulation templates from the component palette', () => {
    const simulationComponents = getPaletteGroups()
      .find((group) => group.id === 'simulation')
      .components;
    const sections = getSimulationMenuSections(simulationComponents);

    expect(simulationComponents.map((component) => component.type)).not.toEqual(expect.arrayContaining([
      'vector2_passthrough',
      'rf_four_channel_source',
      'Test'
    ]));
    expect(sections.find((section) => section.id === 'signal-processing')?.components)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'scalar_to_vector4' }),
        expect.objectContaining({ type: 'DZDK_A' }),
        expect.objectContaining({ type: 'DZDK_B' }),
        expect.objectContaining({ type: 'DZDK_D' })
      ]));
    expect(sections.find((section) => section.id === 'rf-signal')?.components)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'rf_complex_envelope_to_vector4' }),
        expect.objectContaining({ type: 'rf_downconverter' }),
        expect.objectContaining({ type: 'DZDK_C' }),
        expect.objectContaining({ type: 'rf_pulse_feature_extractor' }),
        expect.objectContaining({ type: 'rf_limit_amplify_downconvert_split8' })
      ]));
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

    /* Removed sensor component templates.
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

    */
    expect(library.instrument_spectrum).toMatchObject({
      label: '频谱分析仪',
      badge: '频谱',
      className: 'b-inst',
      defaults: {
        name: '频谱分析仪',
        instrumentType: '频谱分析',
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
    const electrical = paletteGroups.find((group) => group.id === 'electrical');
    const simulation = paletteGroups.find((group) => group.id === 'simulation');
    const faults = paletteGroups.find((group) => group.id === 'faults');
    const canLines = paletteGroups.find((group) => group.id === 'can-lines');

    expect(paletteGroups.map((group) => group.id)).toEqual([
      'signals',
      'electrical',
      'simulation',
      'subsystem',
      'faults',
      'instruments',
      'display-control',
      'can-lines'
    ]);
    expect(paletteGroups[0]).not.toBe(COMPONENT_GROUPS[0]);
    expect(signals.components.map((item) => item.type)).toEqual([
      'signal_source',
      'signal_source_digital',
      'signal_source_rf'
    ]);
    expect(COMPONENT_REGISTRY.signal_source_command.palette?.visible).toBe(false);
    expect(COMPONENT_REGISTRY.middle_var_assign.palette?.visible).toBe(false);
    expect(paletteGroups.find((group) => group.id === 'signal-ops')).toBeUndefined();
    expect(simulation.components.map((item) => item.type)).toEqual([
      '11',
      'scalar_to_vector4',
      'rf_complex_envelope_scalar_source',
      'rf_complex_envelope_to_vector4',
      'rf_complex_envelope_vector4_power_divider',
      'DZDK_A',
      'DZDK_B',
      'DZDK_C',
      'DZDK_D',
      'rf_band_pass_filter',
      'rf_complex_envelope_selector',
      'rf_complex_envelope_vector4_dual_output_receiver',
      'rf_complex_envelope_gain',
      'rf_complex_envelope_limiter',
      'rf_complex_envelope_band_pass_filter',
      'rf_complex_envelope_amplitude_phase_modulator',
      'rf_complex_envelope_downconverter',
      'rf_complex_envelope_upconverter',
      'rf_amplitude_phase_modulator',
      'rf_four_output_source',
      'rf_four_port_up_down_converter',
      'rf_pulse_feature_extractor',
      'rf_complex_envelope_pulse_feature_extractor',
      'rf_downconverter',
      'rf_limit_amplify_downconvert_split8'
    ]);
    expect(paletteGroups.find((group) => group.id === 'display-control').components.map((item) => item.type)).toEqual([
      'display_console_1',
      'display_console_2',
      'display_console_3',
      'display_console_4',
      'display_console_5',
      'display_console_6',
      'display_console_7'
    ]);
    expect(faults.components.map((item) => item.type)).toEqual([
      'physical_fault_injector',
      'electrical_fault_injector',
      'protocol_fault_injector'
    ]);
    expect(COMPONENT_REGISTRY.protocol_fault_injector.palette?.visible).not.toBe(false);
    expect(paletteGroups.find((group) => group.id === 'instruments').components.map((item) => item.type)).toEqual([
      'instrument_scope',
      'XHFSQ',
      'instrument_spectrum',
      'instrument_multimeter'
    ]);
    expect(COMPONENT_REGISTRY.instrument_logger.palette?.visible).toBe(false);
    expect(electrical.components.map((item) => item.type)).toEqual([
      'electrical_ac_power_source',
      'electrical_dc_power_source',
      'electrical_dc_boost',
      'electrical_ac_dc_matching'
    ]);
    expect(canLines.components.map((item) => item.type)).toEqual([
      'link_normal'
    ]);
    expect(COMPONENT_REGISTRY.link_can.palette.visible).toBe(false);
    expect(simulation.components[0]).not.toBe(COMPONENT_REGISTRY.rf_pulse_feature_extractor);
    expect(faults.components[0]).not.toBe(COMPONENT_REGISTRY.physical_fault_injector);
    expect(canLines.components[0]).not.toBe(COMPONENT_REGISTRY.link_normal);
    expect(simulation.components[0].defaults).not.toBe(COMPONENT_REGISTRY.rf_pulse_feature_extractor.defaults);
    simulation.components[0].defaults.inputs[0].name = 'changed input';
    expect(COMPONENT_REGISTRY.rf_pulse_feature_extractor.defaults.inputs[0].name).not.toBe('changed input');
  });
});
