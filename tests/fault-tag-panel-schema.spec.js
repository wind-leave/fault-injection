import { describe, expect, it } from 'vitest';
import {
  getFaultTagInjectedChannels,
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

  it('renders the fault tag overview with escaped labels without fault parameters', () => {
    const html = renderFaultTagOverviewPanel({
      tag,
      targetName: 'IMU <sensor>',
      targetKindLabel: 'Module'
    });

    expect(html).toContain('data-fault-tag-inspector="fault-tag-1"');
    expect(html).toContain('Bias &lt;fault&gt;');
    expect(html.match(/Bias &lt;fault&gt;/g)).toHaveLength(1);
    expect(html).not.toContain('props-fault-card');
    expect(html).toContain('IMU &lt;sensor&gt;');
    expect(html).toContain('\u76ee\u6807\u53c2\u6570');
    expect(html).toContain('gyro_rate');
    expect(html.indexOf('\u76ee\u6807\u5bf9\u8c61')).toBeLessThan(html.indexOf('\u76ee\u6807\u53c2\u6570'));
    expect(html.indexOf('\u76ee\u6807\u53c2\u6570')).toBeLessThan(html.indexOf('\u76ee\u6807\u7c7b\u578b'));
    expect(html).toContain('偏差故障');
    expect(html).not.toContain('故障参数');
    expect(html).not.toContain('data-fault-tag-edit-params');
    expect(html).not.toContain('data-fault-tag-param');
  });

  it('shows the selected vector channels directly below the target parameter', () => {
    const html = renderFaultTagOverviewPanel({
      tag: {
        ...tag,
        vectorInjectionScope: 'items',
        vectorIndices: [2, 0, 2]
      }
    });

    expect(getFaultTagInjectedChannels({ vectorInjectionScope: 'item', vectorIndex: 1 })).toBe('第 2 路');
    expect(getFaultTagInjectedChannels({ vectorInjectionScope: 'items', vectorIndices: [2, 0, 2] })).toBe('第 1、3 路');
    expect(html).toContain('注入路数');
    expect(html).toContain('第 1、3 路');
    expect(html.indexOf('目标参数')).toBeLessThan(html.indexOf('注入路数'));
  });

  it('renders the parameter editor with inputs and disabled actions', () => {
    const html = renderFaultTagParameterPanel({ tag });

    expect(html).toContain('data-fault-tag-param-panel="fault-tag-1"');
    expect(html).toContain('data-fault-tag-param="bias"');
    expect(html).toContain('data-fault-tag-enabled');
    expect(html).toContain('是否启用');
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
    expect(emptyHtml).toContain('data-fault-tag-enabled');

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
