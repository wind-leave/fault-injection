import { describe, expect, it } from 'vitest';
import {
  readFaultTagParameterDraftFromPanel,
  renderFaultTagOverviewPanel,
  renderFaultTagParameterPanel
} from '../src/services/faultTagPanelSchema.js';

describe('fault tag panel schema service', () => {
  const tag = {
    id: 'fault-tag-1',
    name: 'Bias <fault>',
    layer: 'electrical',
    runtimeBehavior: 'bias',
    bindingObject: 'gyro_rate',
    parameters: {
      bias: '5',
      start: '1'
    }
  };

  it('renders the fault tag overview with escaped labels and parameter preview', () => {
    const html = renderFaultTagOverviewPanel({
      tag,
      targetName: 'IMU <sensor>',
      targetKindLabel: 'Module'
    });

    expect(html).toContain('data-fault-tag-inspector="fault-tag-1"');
    expect(html).toContain('Bias &lt;fault&gt;');
    expect(html).toContain('IMU &lt;sensor&gt;');
    expect(html).toContain('\u76ee\u6807\u53c2\u6570');
    expect(html).toContain('gyro_rate');
    expect(html.indexOf('\u76ee\u6807\u5bf9\u8c61')).toBeLessThan(html.indexOf('\u76ee\u6807\u53c2\u6570'));
    expect(html.indexOf('\u76ee\u6807\u53c2\u6570')).toBeLessThan(html.indexOf('\u76ee\u6807\u7c7b\u578b'));
    expect(html).toContain('电气层');
    expect(html).toContain('偏差故障');
    expect(html).toContain('偏置值');
    expect(html).toContain('开始时间');
    expect(html).toContain('data-fault-tag-edit-params');
  });

  it('renders the parameter editor with inputs and disabled actions', () => {
    const html = renderFaultTagParameterPanel({ tag });

    expect(html).toContain('data-fault-tag-param-panel="fault-tag-1"');
    expect(html).toContain('data-fault-tag-param="bias"');
    expect(html).toContain('value="5"');
    expect(html).toContain('data-fault-tag-reset disabled');
    expect(html).toContain('data-fault-tag-apply disabled');
  });

  it('renders empty parameter states and reads parameter drafts from the panel', () => {
    const emptyHtml = renderFaultTagParameterPanel({
      tag: { id: 'fault-tag-empty', parameters: {} }
    });

    expect(emptyHtml).toContain('该故障没有额外参数。');
    expect(emptyHtml).not.toContain('data-fault-tag-apply');

    document.body.innerHTML = `
      <div data-fault-tag-param-panel="fault-tag-1">
        <input data-fault-tag-param="bias" value="7">
        <input data-fault-tag-param="start" value="2">
      </div>
    `;

    expect(readFaultTagParameterDraftFromPanel(document.body)).toEqual({
      bias: '7',
      start: '2'
    });
  });
});
