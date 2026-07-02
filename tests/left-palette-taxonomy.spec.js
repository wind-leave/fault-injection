import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LeftPalette from '../src/components/layout/LeftPalette.vue';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mountPalette() {
  return mount(LeftPalette, { attachTo: document.body });
}

function groupBody(wrapper, groupId) {
  return wrapper.find(`[data-palette-body="${groupId}"]`);
}

function groupComponents(wrapper, groupId) {
  return groupBody(wrapper, groupId)
    .findAll('[data-component]')
    .map((item) => item.attributes('data-component'));
}

describe('left palette taxonomy', () => {
  it('renders the live palette from the component registry instead of the static fragment', () => {
    const source = readFileSync(
      path.join(repoRoot, 'src', 'components', 'layout', 'LeftPalette.vue'),
      'utf8'
    );

    expect(source).toContain('getPaletteGroups');
    expect(source).not.toContain('left-panel.html?raw');
    expect(source).not.toContain('badgeIcons');
    expect(source).not.toContain('badgeClassByType');
  });

  it('orders modeling entries by role and keeps analysis views out of the component palette', () => {
    const wrapper = mountPalette();

    const groups = wrapper.findAll('[data-palette-group]').map((head) => [
      head.attributes('data-palette-group'),
      head.find('.lgroup-label').text()
    ]);

    expect(groups).toEqual([
      ['signals', '系统信号'],
      ['signal-ops', '信号运算'],
      ['simulation', '仿真组件'],
      ['subsystem', '子系统'],
      ['faults', '故障组件'],
      ['instruments', '测量仪器'],
      ['can-lines', '总线与连接']
    ]);
    expect(wrapper.text()).not.toContain('诊断分析');
    expect(wrapper.find('[data-component="instrument_signal_flow"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('多信号流图');

    wrapper.unmount();
  });

  it('puts signal transforms, subsystem, authoring, instruments, and CAN tools in separate groups', () => {
    const wrapper = mountPalette();

    expect(groupComponents(wrapper, 'signals')).toEqual([
      'signal_source',
      'signal_source_digital',
      'signal_source_command',
      'signal_source_rf',
      'middle_var_assign'
    ]);
    expect(groupComponents(wrapper, 'signal-ops')).toEqual([
      'flow_block',
      'gain_block',
      'sum_block',
      'mux_block'
    ]);
    expect(groupComponents(wrapper, 'simulation')).toEqual(['simulation_block', 'airspeed_sensor']);
    expect(groupBody(wrapper, 'simulation').text()).toContain('空速传感器');
    expect(groupBody(wrapper, 'simulation').find('[data-open-component-authoring]').exists()).toBe(true);
    expect(groupComponents(wrapper, 'subsystem')).toEqual(['subsystem_block']);
    expect(groupComponents(wrapper, 'faults')).toEqual([
      'physical_fault_injector',
      'electrical_fault_injector',
      'protocol_fault_injector'
    ]);
    expect(groupBody(wrapper, 'faults').text()).toContain('物理层注入');
    expect(groupBody(wrapper, 'faults').find('[data-open-fault-authoring-for-selected]').exists()).toBe(false);
    expect(groupBody(wrapper, 'faults').text()).not.toContain('新增故障');
    expect(groupComponents(wrapper, 'instruments')).toEqual([
      'instrument_scope',
      'instrument_spectrum',
      'instrument_logger'
    ]);
    expect(groupBody(wrapper, 'can-lines').find('[data-line-type="normal"]').exists()).toBe(true);
    expect(groupBody(wrapper, 'can-lines').find('[data-line-type="can"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it('renders component palette icons from registry metadata', () => {
    const wrapper = mountPalette();

    expect(wrapper.find('[data-component="signal_source"] .citem-icon-badge').text()).toBe('A');
    expect(wrapper.find('[data-component="signal_source_digital"] .citem-icon-badge').text()).toBe('D');
    expect(wrapper.find('[data-component="signal_source_command"] .citem-icon-badge').text()).toBe('C');
    expect(wrapper.find('[data-component="signal_source_rf"] .citem-icon-badge').text()).toBe('RF');
    expect(wrapper.find('[data-component="sum_block"] .citem-icon-badge').text()).toBe('+');
    expect(wrapper.find('[data-component="instrument_scope"] .citem-icon-badge').text()).toBe('波');
    expect(wrapper.find('[data-component="instrument_scope"] .citem-icon-badge').classes()).toContain(
      'citem-icon-badge--scope'
    );

    wrapper.unmount();
  });
});
