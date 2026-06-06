import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markup = readFileSync(path.join(repoRoot, 'src', 'fragments', 'left-panel.html'), 'utf8');

function groupBody(groupId) {
  const bodyStart = markup.indexOf(`data-palette-body="${groupId}"`);
  if (bodyStart === -1) return '';
  const nextHead = markup.indexOf('data-palette-group=', bodyStart + 1);
  return markup.slice(bodyStart, nextHead === -1 ? markup.length : nextHead);
}

describe('left palette taxonomy', () => {
  it('orders modeling entries by role and keeps analysis views out of the component palette', () => {
    const groups = [...markup.matchAll(/data-palette-group="([^"]+)"[^>]*>[\s\S]*?<span class="lgroup-label">([^<]+)<\/span>/g)]
      .map((match) => [match[1], match[2]]);

    expect(groups).toEqual([
      ['signals', '系统信号'],
      ['signal-ops', '信号运算'],
      ['simulation', '仿真组件'],
      ['subsystem', '子系统'],
      ['faults', '故障组件'],
      ['instruments', '测量仪器'],
      ['can-lines', '连接线']
    ]);
    expect(markup).not.toContain('诊断分析');
    expect(markup).not.toContain('data-component="instrument_signal_flow"');
    expect(markup).not.toContain('多信号流图</span>');
  });

  it('puts signal transforms, subsystem, authoring, instruments, and CAN tools in separate groups', () => {
    expect(groupBody('signals')).toContain('data-component="signal_source"');
    expect(groupBody('signals')).toContain('data-component="middle_var_assign"');

    expect(groupBody('signal-ops')).toContain('data-component="flow_block"');
    expect(groupBody('signal-ops')).toContain('data-component="gain_block"');
    expect(groupBody('signal-ops')).toContain('data-component="sum_block"');
    expect(groupBody('signal-ops')).toContain('data-component="mux_block"');

    expect(groupBody('simulation')).toContain('data-component="simulation_block"');
    expect(groupBody('simulation')).toContain('data-open-component-authoring');
    expect(groupBody('subsystem')).toContain('data-component="subsystem_block"');
    expect(groupBody('faults')).toContain('data-component="physical_fault_injector"');
    expect(groupBody('faults')).toContain('data-component="electrical_fault_injector"');
    expect(groupBody('faults')).toContain('data-component="protocol_fault_injector"');
    expect(groupBody('faults')).toContain('物理层注入');
    expect(groupBody('faults')).not.toContain('data-open-fault-authoring-for-selected');
    expect(groupBody('faults')).not.toContain('新增故障');
    expect(groupBody('instruments')).toContain('data-component="instrument_scope"');
    expect(groupBody('instruments')).toContain('data-component="instrument_spectrum"');
    expect(groupBody('instruments')).toContain('data-component="instrument_logger"');
    expect(groupBody('can-lines')).toContain('data-line-type="normal"');
    expect(groupBody('can-lines')).toContain('data-line-type="can"');
  });
});
