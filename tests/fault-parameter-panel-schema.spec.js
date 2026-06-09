import { describe, expect, it } from 'vitest';
import {
  readFaultParameterValuesFromPanel,
  renderFaultParameterControl,
  renderFaultParameterRows
} from '../src/services/faultParameterPanelSchema.js';

describe('fault parameter panel schema service', () => {
  it('renders text inputs with labels and escaped values', () => {
    const html = renderFaultParameterRows({
      bias: '0.1 <x>',
      start: 2
    }, {
      dataAttributeName: 'data-target-fault-param'
    });

    expect(html).toContain('data-target-fault-param="bias"');
    expect(html).toContain('data-target-fault-param="start"');
    expect(html).toContain('偏置值');
    expect(html).toContain('开始时间');
    expect(html).toContain('0.1 &lt;x&gt;');
  });

  it('renders choice parameters as dropdowns backed by hidden inputs', () => {
    const html = renderFaultParameterControl('mode', 'multiply', 'data-layered-fault-param');

    expect(html).toContain('data-fault-param-dropdown="mode"');
    expect(html).toContain('data-layered-fault-param="mode"');
    expect(html).toContain('value="multiply"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('倍率调整');
  });

  it('falls back to the first choice when a selected value is invalid', () => {
    const html = renderFaultParameterControl('noise_type', 'unknown', 'data-target-fault-param');

    expect(html).toContain('value="gaussian"');
    expect(html).toContain('高斯噪声');
  });

  it('reads parameter values from a panel by data attribute', () => {
    document.body.innerHTML = `
      <input data-target-fault-param="bias" value="0.2">
      <input data-target-fault-param="mode" value="overwrite">
    `;

    expect(readFaultParameterValuesFromPanel(document.body, 'data-target-fault-param')).toEqual({
      bias: '0.2',
      mode: 'overwrite'
    });
  });
});
