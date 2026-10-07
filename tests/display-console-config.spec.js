import { describe, expect, it } from 'vitest';
import { DISPLAY_CONSOLE_PRESETS, createDisplayConsoleConfig, createDisplayConsoleVectorPort } from '../src/constants/displayConsoleConfig.js';

describe('display console control configuration', () => {
  it('uses one seven-element vector input with configured element names', () => {
    const config = createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_1);
    expect(createDisplayConsoleVectorPort(config.inputs)).toMatchObject({
      id: 'console-input',
      dataType: 'vector',
      vectorLength: 7,
      vectorElementNames: config.inputs.map((input) => input.label)
    });
  });
  it('provides seven independently configurable display-console templates', () => {
    expect(Object.keys(DISPLAY_CONSOLE_PRESETS)).toEqual([
      'display_console_1',
      'display_console_2',
      'display_console_3',
      'display_console_4',
      'display_console_5',
      'display_console_6',
      'display_console_7'
    ]);
    expect(Object.values(DISPLAY_CONSOLE_PRESETS).map((preset) => preset.name)).toEqual([
      '显控台 1',
      '显控台 2',
      '显控台 3',
      '显控台 4',
      '显控台 5',
      '显控台 6',
      '显控台 7'
    ]);
  });

  it('defines seven input ports and maps each one to a display column', () => {
    const config = createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_1);

    expect(config.inputs).toHaveLength(7);
    expect(config.inputs.map((input) => input.key)).toEqual([
      'centerFrequency', 'repetitionPeriod', 'pulseWidth', 'amplitude', 'band', 'waveform', 'modulation'
    ]);
    expect(config.columns.filter((column) => column.source === 'input').map((column) => column.inputIndex))
      .toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(createDisplayConsoleConfig().inputs.every((input) => input.generateMeasurementPoint)).toBe(true);
  });

  it('allows a preset to suppress automatic measurement-point creation per input', () => {
    const config = createDisplayConsoleConfig({
      inputs: {
        centerFrequency: { label: '频率输入', generateMeasurementPoint: false },
        amplitude: '幅度输入'
      }
    });

    expect(config.inputs[0]).toMatchObject({
      label: '频率输入',
      generateMeasurementPoint: false
    });
    expect(config.inputs[3]).toMatchObject({
      label: '幅度输入',
      generateMeasurementPoint: true
    });
  });

  it('configures independent seven-element vector ports as display rows', () => {
    const config = createDisplayConsoleConfig({
      inputs: { centerFrequency: { generateMeasurementPoint: false } },
      ports: [
        { id: 'channel-a', name: '通道 A' },
        { id: 'channel-b', name: '通道 B', inputs: { amplitude: { label: '通道 B 幅度', generateMeasurementPoint: false } } }
      ]
    });

    expect(config.ports.map((port) => createDisplayConsoleVectorPort(port.inputs, port))).toEqual([
      expect.objectContaining({ id: 'channel-a', name: '通道 A', vectorLength: 7 }),
      expect.objectContaining({ id: 'channel-b', name: '通道 B', vectorLength: 7 })
    ]);
    expect(config.ports[0].inputs[0].generateMeasurementPoint).toBe(false);
    expect(config.ports[1].inputs[0].generateMeasurementPoint).toBe(false);
    expect(config.ports[1].inputs[3]).toMatchObject({ label: '通道 B 幅度', generateMeasurementPoint: false });
    expect(config.ports[0].inputs[3].generateMeasurementPoint).toBe(true);
  });

  it('makes display console 2 the two-port example with separate measurement-point choices', () => {
    const config = createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_2);

    expect(config.ports.map((port) => [port.id, port.name])).toEqual([
      ['console-input', '通道 A'],
      ['console-input-2', '通道 B']
    ]);
    expect(config.ports[0].inputs.map((input) => input.generateMeasurementPoint)).toEqual([
      false, true, true, true, true, true, true
    ]);
    expect(config.ports[1].inputs.map((input) => input.generateMeasurementPoint)).toEqual([
      true, true, true, false, true, true, true
    ]);
  });

  it('exposes only the declared RF source parameters on display console 1', () => {
    const config = createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_1);

    expect(config.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        componentType: 'rf_four_channel_source',
        parameterKeys: ['center_frequency_hz', 'pulse_width_seconds', 'pulse_period_seconds']
      })
    ]));
    expect(config.controls.flatMap((control) => control.parameterKeys)).not.toContain('sample_1');
  });

  it('declares shared RF timing parameters that synchronize both source components', () => {
    const config = createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_1);

    expect(config.sharedParameters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'rf_center_frequency',
        bindings: expect.arrayContaining([
          { componentType: 'rf_four_channel_source', parameterKey: 'center_frequency_hz' },
          { componentType: 'rf_four_output_source', parameterKey: 'center_frequency_hz' }
        ])
      })
    ]));
    expect(config.sharedParameters).not.toBe(DISPLAY_CONSOLE_PRESETS.display_console_1.sharedParameters);
    expect(config.sharedParameters[0].bindings).not.toBe(DISPLAY_CONSOLE_PRESETS.display_console_1.sharedParameters[0].bindings);
  });

  it('limits display console 2 to the selected downconverter parameters', () => {
    const config = createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_2);

    expect(config.controls).toEqual([
      expect.objectContaining({
        componentType: 'rf_downconverter',
        parameterKeys: ['input_mode', 'lo_frequency_hz', 'lo_phase_deg', 'conversion_gain', 'low_pass_cutoff_hz']
      })
    ]);
    expect(config.sharedParameters).toEqual([
      expect.objectContaining({
        key: 'rf_downconverter_input_mode',
        bindings: [{ componentType: 'rf_downconverter', parameterKey: 'input_mode' }]
      })
    ]);
  });

  it('assigns each added console to its intended RF processing component', () => {
    expect(createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_3).controls)
      .toEqual([expect.objectContaining({ componentType: 'rf_four_port_up_down_converter' })]);
    expect(createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_4).controls)
      .toEqual([expect.objectContaining({ componentType: 'rf_limit_amplify_downconvert_split8' })]);
    expect(createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_5).controls)
      .toEqual([expect.objectContaining({ componentType: 'rf_pulse_feature_extractor' })]);
    expect(createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_6).controls)
      .toEqual([expect.objectContaining({ componentType: 'rf_four_channel_source' })]);
    expect(createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_7).controls)
      .toEqual([expect.objectContaining({ componentType: 'rf_four_output_source' })]);
  });
});
