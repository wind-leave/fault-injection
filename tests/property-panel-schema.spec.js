import { describe, expect, it } from 'vitest';
import {
  getComponentPropertySchema,
  readPropertyValuesFromSchema,
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

    expect(html).toContain('id="prop-signalDomain"');
    expect(html).toContain('<option value="analog" selected>模拟信号</option>');
    expect(html).toContain('id="prop-waveType"');
    expect(html).toContain('id="prop-amplitude"');
    expect(html).not.toContain('id="prop-centerFrequency"');
    expect(html).not.toContain('id="prop-messageId"');
  });

  it('renders RF-only fields for RF signal sources', () => {
    const schema = getComponentPropertySchema('signal_source');
    const html = renderPropertyFieldsFromSchema({
      type: 'signal_source',
      props: {
        signalDomain: 'rf',
        centerFrequency: '2.4GHz',
        bandwidth: '20MHz',
        modulation: 'QPSK'
      }
    }, schema);

    expect(html).toContain('id="prop-centerFrequency"');
    expect(html).toContain('id="prop-bandwidth"');
    expect(html).toContain('id="prop-modulation"');
    expect(html).not.toContain('id="prop-waveType"');
    expect(html).not.toContain('id="prop-digitalMode"');
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
        modulation: 'QPSK'
      }
    }, schema);

    document.getElementById('prop-name').value = 'RF Updated';
    document.getElementById('prop-signalDomain').value = 'rf';
    document.getElementById('prop-centerFrequency').value = '5.8GHz';

    expect(readPropertyValuesFromSchema(schema, document)).toEqual(expect.objectContaining({
      name: 'RF Updated',
      signalDomain: 'rf',
      centerFrequency: '5.8GHz',
      bandwidth: '20MHz',
      power: '10',
      modulation: 'QPSK'
    }));
  });
});
