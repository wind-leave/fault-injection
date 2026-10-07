import { describe, expect, it } from 'vitest';
import {
  getComponentPropertySchema,
  readPropertyValuesFromSchema,
  renderPropertyOverviewFieldsFromSchema,
  renderPropertyFieldsFromSchema
} from '../src/services/propertyPanelSchema.js';

describe('property panel schema service', () => {
  it('returns no schema for components that still use dedicated panels', () => {
    expect(getComponentPropertySchema('simulation_block')).toBeNull();
    expect(getComponentPropertySchema('physical_fault_injector')).toBeNull();
  });

  it('renders legacy-compatible fields for a gain block', () => {
    const schema = getComponentPropertySchema('gain_block');
    const html = renderPropertyFieldsFromSchema({
      type: 'gain_block',
      props: {
        name: 'Gain <A>',
        gain: '2.5',
        inputFormat: '标量',
        outputFormat: '向量'
      }
    }, schema);

    expect(html).toContain('id="prop-name"');
    expect(html).toContain('id="prop-gain"');
    expect(html).toContain('id="prop-inputFormat"');
    expect(html).toContain('id="prop-outputFormat"');
    expect(html).toContain('Gain &lt;A&gt;');
    expect(html).toContain('<option value="向量" selected>向量</option>');
  });

  it('reads simple component values from rendered fields', () => {
    const schema = getComponentPropertySchema('flow_block');
    document.body.innerHTML = renderPropertyFieldsFromSchema({
      type: 'flow_block',
      props: {
        name: '信号适配块',
        inputName: '输入信号',
        inputFormat: '标量',
        outputName: '输出信号',
        outputFormat: '标量'
      }
    }, schema);

    document.getElementById('prop-name').value = '适配 A';
    document.getElementById('prop-inputName').value = '';
    document.getElementById('prop-inputFormat').value = '向量';
    document.getElementById('prop-outputName').value = '输出 A';
    document.getElementById('prop-outputFormat').value = '矩阵';

    expect(readPropertyValuesFromSchema(schema, document)).toEqual({
      name: '适配 A',
      inputName: '输入信号',
      inputFormat: '向量',
      outputName: '输出 A',
      outputFormat: '矩阵'
    });
  });

  it('normalizes multi-input utility values from panel fields', () => {
    const schema = getComponentPropertySchema('sum_block');
    document.body.innerHTML = renderPropertyFieldsFromSchema({
      type: 'sum_block',
      props: {
        name: '求和',
        inputCount: 3,
        signs: ['+', '-', '+'],
        outputFormat: '标量'
      }
    }, schema);

    document.getElementById('prop-inputCount').value = '5';
    document.getElementById('prop-signs').value = '+ - x -';
    document.getElementById('prop-outputFormat').value = '向量';

    expect(readPropertyValuesFromSchema(schema, document)).toEqual({
      name: '求和',
      inputCount: 5,
      signs: ['+', '-', '+', '-', '+'],
      outputFormat: '向量'
    });
  });

  it('keeps returned schemas isolated from callers', () => {
    const first = getComponentPropertySchema('instrument_scope');
    first.groups[0].fields[0].label = 'changed';

    expect(getComponentPropertySchema('instrument_scope').groups[0].fields[0].label).toBe('模块名称');
  });

  it('keeps vector component selectors out of the static instrument schemas', () => {
    const scopeHtml = renderPropertyFieldsFromSchema({
      type: 'instrument_scope',
      props: { vectorChannelCh1: 3, vectorChannelCh2: 2 }
    }, getComponentPropertySchema('instrument_scope'));
    const spectrumHtml = renderPropertyFieldsFromSchema({
      type: 'instrument_spectrum',
      props: { vectorChannel: 4 }
    }, getComponentPropertySchema('instrument_spectrum'));
    expect(scopeHtml).not.toContain('id="prop-vectorChannelCh1"');
    expect(scopeHtml).not.toContain('id="prop-vectorChannelCh2"');
    expect(spectrumHtml).not.toContain('id="prop-vectorChannel"');
  });

  it('renders analog signal source fields for old signal sources by default', () => {
    const schema = getComponentPropertySchema('signal_source');
    const html = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        name: 'Old Source',
        waveType: '常值',
        amplitude: '2',
        frequency: '0'
      }
    }, schema);

    expect(html).not.toContain('id="prop-signalDomain"');
    expect(html).toContain('id="prop-waveType"');
    expect(html).toContain('id="prop-amplitude"');
    expect(html).not.toContain('id="prop-outputFormat"');
    expect(html).not.toContain('id="prop-centerFrequency"');
    expect(html).not.toContain('id="prop-messageId"');
  });

  it('renders command protocol and payload type as selects without a payload schema field', () => {
    const schema = getComponentPropertySchema('signal_source');
    const html = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'command', protocol: 'CAN FD', payloadKind: 'uint16' }
    }, schema);

    expect(html).toContain('id="prop-protocol"');
    expect(html).toContain('<option value="CAN FD" selected>CAN FD</option>');
    expect(html).toContain('id="prop-payloadKind"');
    expect(html).toContain('<option value="uint16" selected>uint16</option>');
    expect(html).not.toContain('id="prop-payloadSchema"');
  });

  it('renders waveform-specific analog configuration fields', () => {
    const schema = getComponentPropertySchema('signal_source');
    const stepHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'analog', waveType: 'step' }
    }, schema);
    const rampHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'analog', waveType: 'ramp' }
    }, schema);
    const pulseHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'analog', waveType: 'pulse' }
    }, schema);

    expect(stepHtml).toContain('id="prop-initialValue"');
    expect(stepHtml).toContain('id="prop-finalValue"');
    expect(stepHtml).toContain('id="prop-stepTime"');
    expect(stepHtml).not.toContain('id="prop-frequency"');
    expect(rampHtml).toContain('id="prop-slope"');
    expect(rampHtml).toContain('id="prop-startTime"');
    expect(rampHtml).not.toContain('id="prop-finalValue"');
    expect(pulseHtml).toContain('id="prop-lowValue"');
    expect(pulseHtml).toContain('id="prop-frequency"');
    expect(pulseHtml).toContain('id="prop-dutyCycle"');
    expect(pulseHtml).toContain('id="prop-phase"');
    expect(pulseHtml).not.toContain('id="prop-analogKind"');
    expect(pulseHtml).not.toContain('id="prop-minValue"');
    expect(pulseHtml).not.toContain('id="prop-maxValue"');
    expect(pulseHtml).not.toContain('id="prop-sampleRate"');
  });

  it('renders only RF fields applicable to the selected modulation mode', () => {
    const schema = getComponentPropertySchema('signal_source');
    const cwHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'rf', modulation: 'cw' }
    }, schema);
    const pulseHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'rf', modulation: 'pulse' }
    }, schema);
    const complexPulseHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'rf', modulation: 'am', outputFormat: '复数包络' }
    }, schema);
    const legacyPulseHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'rf', modulation: '脉冲调制' }
    }, schema);
    const digitalHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'rf', modulation: 'digital' }
    }, schema);
    const noisyAmHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'rf', modulation: 'am', noiseEnabled: 'on' }
    }, schema);

    expect(cwHtml).toContain('id="prop-centerFrequency"');
    expect(cwHtml).toContain('id="prop-centerFrequencyUnit"');
    expect(cwHtml).not.toContain('id="prop-rfOutputEnabled"');
    expect(cwHtml).not.toContain('id="prop-bandwidth"');
    expect(cwHtml).toContain('id="prop-noiseEnabled"');
    expect(cwHtml).not.toContain('id="prop-noiseSnr"');
    expect(cwHtml).not.toContain('id="prop-pulseWidth"');
    expect(pulseHtml).toContain('id="prop-pulseWidth"');
    expect(pulseHtml).toContain('id="prop-pulseWidthUnit"');
    expect(pulseHtml).toContain('id="prop-pulsePeriod"');
    expect(pulseHtml).toContain('id="prop-pulsePeriodUnit"');
    expect(pulseHtml).toContain('重周');
    expect(pulseHtml).not.toContain('id="prop-bandwidth"');
    expect(complexPulseHtml).not.toContain('id="prop-riseTime"');
    expect(complexPulseHtml).not.toContain('id="prop-fallTime"');
    expect(complexPulseHtml).not.toContain('id="prop-modulation"');
    expect(complexPulseHtml).not.toContain('id="prop-bandwidth"');
    expect(complexPulseHtml).not.toContain('id="prop-impedanceOhm"');
    expect(pulseHtml).not.toContain('id="prop-snr"');
    expect(legacyPulseHtml).toContain('id="prop-pulseWidth"');
    expect(legacyPulseHtml).toContain('id="prop-pulsePeriod"');
    expect(digitalHtml).toContain('id="prop-bandwidth"');
    expect(digitalHtml).toContain('id="prop-sampleRate"');
    expect(digitalHtml).not.toContain('id="prop-pulseWidth"');
    expect(noisyAmHtml).toContain('id="prop-noiseSnr"');
    expect(noisyAmHtml).toContain('id="prop-noiseBandwidth"');
    expect(noisyAmHtml).toContain('id="prop-noiseBandwidthUnit"');
    expect(noisyAmHtml).not.toContain('噪声/干扰');
  });

  it('does not render signal definition as editable signal source parameter fields', () => {
    const schema = getComponentPropertySchema('signal_source');
    const html = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        signalDomain: 'analog',
        signalName: 'Pitch Command',
        signalId: 'cmd.pitch'
      }
    }, schema);

    expect(html).not.toContain('id="prop-signalDomain"');
    expect(html).not.toContain('id="prop-name"');
    expect(html).not.toContain('id="prop-signalName"');
    expect(html).not.toContain('id="prop-signalId"');
    expect(html).toContain('id="prop-waveType"');
  });

  it('renders editable signal definition fields in the signal source overview schema', () => {
    const schema = getComponentPropertySchema('signal_source');
    const html = renderPropertyOverviewFieldsFromSchema({
      type: 'signal_source',
      props: {
        name: 'RF Source',
        signalDomain: 'rf',
        signalName: 'Airspeed Link',
        signalId: 'rf.airspeed',
        centerFrequency: '2.4GHz'
      }
    }, schema);

    expect(html).toContain('信号定义');
    expect(html).toContain('id="prop-name"');
    expect(html).toContain('id="prop-signalName"');
    expect(html).toContain('id="prop-signalId"');
    expect(html).toContain('id="prop-unit"');
    expect(html).toContain('id="prop-description"');
    expect(html).not.toContain('id="prop-signalDomain"');
    expect(html).not.toContain('id="prop-centerFrequency"');
  });

  it('does not render the removed analog type option', () => {
    const schema = getComponentPropertySchema('signal_source');
    document.body.innerHTML = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        signalDomain: 'analog',
        waveType: 'sine'
      }
    }, schema);

    expect(document.getElementById('prop-analogKind')).toBeNull();
  });

  it('renders waveform options once with Chinese labels and supports legacy Chinese values', () => {
    const schema = getComponentPropertySchema('signal_source');
    document.body.innerHTML = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        signalDomain: 'analog',
        waveType: '正弦'
      }
    }, schema);

    const options = Array.from(document.getElementById('prop-waveType').options);
    expect(options.map((option) => option.value)).toEqual([
      'sine',
      'step',
      'constant',
      'ramp',
      'pulse',
      'noise'
    ]);
    expect(options.map((option) => option.textContent)).toEqual([
      '正弦',
      '阶跃',
      '常值',
      '斜坡',
      '脉冲',
      '噪声'
    ]);
    expect(document.getElementById('prop-waveType').value).toBe('sine');
  });

  it('renders digital mode options with Chinese labels while preserving values', () => {
    const schema = getComponentPropertySchema('signal_source');
    document.body.innerHTML = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        signalDomain: 'digital',
        digitalMode: 'enum'
      }
    }, schema);

    const options = Array.from(document.getElementById('prop-digitalMode').options);
    expect(options.map((option) => option.value)).toEqual([
      'boolean',
      'level',
      'enum',
      'generic'
    ]);
    expect(options.map((option) => option.textContent)).toEqual([
      '布尔取值',
      '双值电平',
      '枚举取值',
      '通用信号'
    ]);
    expect(document.getElementById('prop-digitalMode').value).toBe('enum');
  });

  it('renders generic digital signals with min/max bounds but no parameter current slider', () => {
    const schema = getComponentPropertySchema('signal_source');
    document.body.innerHTML = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        signalDomain: 'digital',
        digitalMode: 'generic',
        minValue: '0',
        maxValue: '100',
        initialState: '40'
      }
    }, schema);

    expect(document.getElementById('prop-digitalMode').value).toBe('generic');
    expect(document.getElementById('prop-minValue').value).toBe('0');
    expect(document.getElementById('prop-maxValue').value).toBe('100');
    expect(document.getElementById('prop-initialState-slider')).toBeNull();
    expect(document.getElementById('prop-initialState')).toBeNull();

    expect(readPropertyValuesFromSchema(schema, document)).toEqual(expect.objectContaining({
      digitalMode: 'generic',
      minValue: '0',
      maxValue: '100'
    }));
  });

  it('renders digital signal sources without a current-value field or pulse timing fields', () => {
    const schema = getComponentPropertySchema('signal_source');
    const html = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        signalDomain: 'digital',
        digitalMode: 'level',
        initialState: '1',
        period: '20ms',
        dutyCycle: '0.5'
      }
    }, schema);

    expect(html).toContain('id="prop-digitalMode"');
    expect(html).not.toContain('当前取值');
    expect(html).not.toContain('id="prop-initialState"');
    expect(html).toContain('id="prop-enumValues"');
    expect(html).not.toContain('id="prop-pulseWidth"');
    expect(html).not.toContain('id="prop-period"');
    expect(html).not.toContain('id="prop-dutyCycle"');
    expect(html).not.toContain('pulse');
  });

  it('renders command type options with Chinese labels while preserving values', () => {
    const schema = getComponentPropertySchema('signal_source');
    document.body.innerHTML = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        signalDomain: 'command',
        commandType: 'bus-message'
      }
    }, schema);

    const options = Array.from(document.getElementById('prop-commandType').options);
    expect(options.map((option) => option.value)).toEqual([
      'control',
      'bus-message',
      'task',
      'mode'
    ]);
    expect(options.map((option) => option.textContent)).toEqual([
      '控制指令',
      '总线报文',
      '任务指令',
      '模式指令'
    ]);
    expect(document.getElementById('prop-commandType').value).toBe('bus-message');
  });

  it('does not render the removed RF type option', () => {
    const schema = getComponentPropertySchema('signal_source');
    document.body.innerHTML = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        signalDomain: 'rf',
        modulation: 'cw'
      }
    }, schema);

    expect(document.getElementById('prop-rfKind')).toBeNull();
  });

  it('renders RF-only fields for RF signal sources', () => {
    const schema = getComponentPropertySchema('signal_source');
    const html = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        signalDomain: 'rf',
        centerFrequency: '2.4GHz',
        bandwidth: '20MHz',
        modulation: 'digital'
      }
    }, schema);

    expect(html).toContain('id="prop-centerFrequency"');
    expect(html).toContain('id="prop-bandwidth"');
    expect(html).toContain('id="prop-modulation"');
    expect(html).not.toContain('id="prop-rfKind"');
    expect(html).not.toContain('id="prop-waveType"');
    expect(html).not.toContain('id="prop-digitalMode"');
  });

  it('renders and reads RF vector values in batch and item configuration modes', () => {
    const schema = getComponentPropertySchema('signal_source');
    const scalarHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'rf', outputFormat: '标量' }
    }, schema);
    const batchHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'rf', outputFormat: '向量', rfVectorLength: 3, rfVectorValues: '1, 0.8, 0.6' }
    }, schema);
    const itemHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'rf', outputFormat: '向量', rfVectorLength: 3, rfVectorConfigMode: 'item', rfVectorValues: '1, 0.8, 0.6' }
    }, schema);

    expect(scalarHtml).not.toContain('id="prop-rfVectorLength"');
    expect(batchHtml).toContain('id="prop-rfVectorLength"');
    expect(batchHtml).toContain('id="prop-rfVectorValues"');

    expect(itemHtml.match(/data-rf-vector-value/g)).toHaveLength(3);

    document.body.innerHTML = itemHtml;
    document.querySelectorAll('[data-rf-vector-value]')[1].value = '0.75';
    expect(readPropertyValuesFromSchema(schema, document)).toEqual(expect.objectContaining({
      outputFormat: '向量',
      rfVectorLength: 3,
      rfVectorConfigMode: 'item',
      rfVectorValues: '1, 0.75, 0.6'
    }));
  });

  it('labels analog and PM phase inputs in radians', () => {
    const schema = getComponentPropertySchema('signal_source');
    const analogHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'analog', waveType: 'sine' }
    }, schema);
    const pmHtml = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: { signalDomain: 'rf', modulation: 'pm' }
    }, schema);

    expect(analogHtml).toContain('相位 (rad)');
    expect(pmHtml).toContain('相偏 (rad)');
  });

  it('reads rendered signal source values with normalized domain defaults', () => {
    const schema = getComponentPropertySchema('signal_source');
    document.body.innerHTML = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        name: 'RF Source',
        signalDomain: 'rf',
        centerFrequency: '2.4GHz',
        bandwidth: '20MHz',
        power: '10',
        modulation: 'digital'
      }
    }, schema);

    document.getElementById('prop-centerFrequency').value = '5.8GHz';

    expect(readPropertyValuesFromSchema(schema, document)).toEqual(expect.objectContaining({
      centerFrequency: '5.8GHz',
      bandwidth: '20MHz',
      power: '10',
      modulation: 'digital'
    }));
    expect(readPropertyValuesFromSchema(schema, document)).not.toHaveProperty('name');
  });
});
