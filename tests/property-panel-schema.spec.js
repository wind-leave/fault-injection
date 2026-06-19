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
});
