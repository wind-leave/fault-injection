import { existsSync, readFileSync } from 'node:fs';
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

function createDragDataTransfer() {
  const values = new Map();
  return {
    effectAllowed: '',
    setData(type, value) {
      values.set(type, value);
    },
    getData(type) {
      return values.get(type) ?? '';
    }
  };
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

  it('does not keep obsolete static fragments that duplicate live Vue surfaces', () => {
    for (const fileName of ['left-panel.html', 'main.html', 'dialogs.html']) {
      expect(existsSync(path.join(repoRoot, 'src', 'fragments', fileName))).toBe(false);
    }
  });

  it('orders modeling entries by role and keeps analysis views out of the component palette', () => {
    const wrapper = mountPalette();

    const groups = wrapper.findAll('[data-palette-group]').map((head) => [
      head.attributes('data-palette-group'),
      head.find('.lgroup-label').text()
    ]);

    expect(groups).toEqual([
      ['signals', '系统信号'],
      ['electrical', '电气组件'],
      ['simulation', '仿真组件'],
      ['subsystem', '子系统'],
      ['faults', '故障组件'],
      ['instruments', '测量仪器'],
      ['display-control', '显控组件'],
      ['can-lines', '总线与连接']
    ]);
    expect(wrapper.text()).not.toContain('诊断分析');
    expect(wrapper.find('[data-component="instrument_signal_flow"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('多信号流图');

    wrapper.unmount();
  });

  it('keeps subsystem, instruments, and line tools in separate groups', () => {
    const wrapper = mountPalette();

    expect(groupComponents(wrapper, 'signals')).toEqual([
      'signal_source',
      'signal_source_digital',
      'signal_source_rf'
    ]);
    expect(wrapper.find('[data-palette-group="signal-ops"]').exists()).toBe(false);
    expect(groupBody(wrapper, 'electrical').find('[data-electrical-menu-section="power-source"]').text()).toContain('电源模块');
    expect(groupBody(wrapper, 'electrical').find('[data-electrical-menu-section="power-conversion"]').text()).toContain('电能变换');
    expect(groupComponents(wrapper, 'electrical')).toEqual([
      'electrical_ac_power_source',
      'electrical_dc_power_source',
      'electrical_dc_boost',
      'electrical_ac_dc_matching'
    ]);
    expect(groupComponents(wrapper, 'simulation')).toEqual([
      'airspeed_sensor',
      'barometer_sensor'
    ]);
    expect(groupBody(wrapper, 'simulation').text()).toContain('空速传感器');
    expect(groupBody(wrapper, 'simulation').find('[data-open-component-authoring]').exists()).toBe(false);
    expect(groupComponents(wrapper, 'subsystem')).toEqual([
      'subsystem_block',
      'subsystem_block_2',
      'subsystem_block_3',
      'subsystem_block_4'
    ]);
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
      'instrument_multimeter'
    ]);
    expect(groupBody(wrapper, 'instruments').text()).not.toContain('数据记录仪');
    expect(groupBody(wrapper, 'instruments').text()).toContain('数字万用表');
    expect(groupComponents(wrapper, 'display-control')).toEqual([
      'display_console_1',
      'display_console_2',
      'display_console_3',
      'display_console_4',
      'display_console_5',
      'display_console_6',
      'display_console_7'
    ]);
    expect(groupBody(wrapper, 'can-lines').find('[data-line-type="normal"]').exists()).toBe(true);
    expect(groupBody(wrapper, 'can-lines').find('[data-line-type="power"]').exists()).toBe(false);
    expect(groupBody(wrapper, 'can-lines').find('[data-line-type="can"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it('renders component palette icons from registry metadata', () => {
    const wrapper = mountPalette();

    expect(wrapper.find('[data-component="signal_source"] .citem-icon-badge').text()).toBe('A');
    expect(wrapper.find('[data-component="signal_source_digital"] .citem-icon-badge').text()).toBe('D');
    expect(wrapper.find('[data-component="signal_source_command"]').exists()).toBe(false);
    expect(wrapper.find('[data-component="signal_source_rf"] .citem-icon-badge').text()).toBe('RF');
    expect(wrapper.find('[data-component="sum_block"]').exists()).toBe(false);
    expect(wrapper.find('[data-component="instrument_scope"] .citem-icon-badge').text()).toBe('波');
    expect(wrapper.find('[data-component="instrument_scope"] .citem-icon-badge').classes()).toContain(
      'citem-icon-badge--scope'
    );
    expect(wrapper.find('[data-component="instrument_spectrum"] .citem-icon-badge').text()).toBe('谱');
    expect(wrapper.find('[data-component="instrument_multimeter"] .citem-icon-badge').text()).toBe('VΩ');
    expect(wrapper.find('[data-component="display_console_1"] .citem-icon-badge').text()).toBe('显1');
    expect(wrapper.find('[data-component="display_console_1"] .citem-icon-badge').classes()).toContain(
      'citem-icon-badge--display-control'
    );
    expect(wrapper.find('[data-component="display_console_7"] .citem-icon-badge').text()).toBe('显7');

    wrapper.unmount();
  });

  it('drags each new blank subsystem entry as a subsystem block', () => {
    const wrapper = mountPalette();
    const entries = groupBody(wrapper, 'subsystem').findAll('.citem-draggable');

    expect(entries.map((entry) => entry.find('.citem-label').text())).toEqual([
      '子系统块', '子系统块 2', '子系统块 3', '子系统块 4'
    ]);
    entries.slice(1).forEach((entry, index) => {
      const dataTransfer = createDragDataTransfer();
      const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
      entry.element.dispatchEvent(dragStart);
      expect(dataTransfer.getData('text/plain')).toBe(`subsystem_block_${index + 2}`);
      expect(dataTransfer.getData('application/x-gz-palette-key')).toBe(`subsystem_block_${index + 2}`);
    });

    wrapper.unmount();
  });

  it('offers only the normal line tool in the connection group', () => {
    const wrapper = mountPalette();
    const lineTools = groupBody(wrapper, 'can-lines');

    expect(lineTools.find('[data-line-type="normal"]').exists()).toBe(true);
    expect(lineTools.find('[data-line-type="power"]').exists()).toBe(false);
    expect(lineTools.find('[data-line-type="can"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it('keeps the protocol-layer injector while hiding the CAN line tool', () => {
    const wrapper = mountPalette();

    expect(wrapper.find('[data-component="protocol_fault_injector"]').exists()).toBe(true);
    expect(groupBody(wrapper, 'can-lines').find('[data-line-type="can"]').exists()).toBe(false);
    expect(groupBody(wrapper, 'can-lines').find('[data-line-type="power"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it('treats each display-console template as a one-time palette entry', async () => {
    const wrapper = mountPalette();

    window.dispatchEvent(new CustomEvent('gz:palette-component-created', {
      detail: { paletteKey: 'display_console_1' }
    }));
    await wrapper.vm.$nextTick();
    expect(groupComponents(wrapper, 'display-control')).toEqual([
      'display_console_2',
      'display_console_3',
      'display_console_4',
      'display_console_5',
      'display_console_6',
      'display_console_7'
    ]);

    window.dispatchEvent(new CustomEvent('gz:palette-component-deleted', {
      detail: { paletteKey: 'display_console_1' }
    }));
    await wrapper.vm.$nextTick();
    expect(groupComponents(wrapper, 'display-control')).toEqual([
      'display_console_1',
      'display_console_2',
      'display_console_3',
      'display_console_4',
      'display_console_5',
      'display_console_6',
      'display_console_7'
    ]);

    wrapper.unmount();
  });

  it('treats each electrical component as a one-time palette entry', async () => {
    const wrapper = mountPalette();

    window.dispatchEvent(new CustomEvent('gz:palette-component-created', {
      detail: { paletteKey: 'electrical_dc_boost' }
    }));
    await wrapper.vm.$nextTick();
    expect(groupComponents(wrapper, 'electrical')).not.toContain('electrical_dc_boost');

    window.dispatchEvent(new CustomEvent('gz:palette-component-deleted', {
      detail: { paletteKey: 'electrical_dc_boost' }
    }));
    await wrapper.vm.$nextTick();
    expect(groupComponents(wrapper, 'electrical')).toContain('electrical_dc_boost');

    wrapper.unmount();
  });

  it('restores consumed simulation and display-console templates for a new blank workspace', async () => {
    const wrapper = mountPalette();

    window.dispatchEvent(new CustomEvent('gz:palette-component-created', {
      detail: { paletteKey: 'airspeed_sensor' }
    }));
    window.dispatchEvent(new CustomEvent('gz:palette-component-created', {
      detail: { paletteKey: 'display_console_1' }
    }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-component="airspeed_sensor"]').exists()).toBe(false);
    expect(wrapper.find('[data-component="display_console_1"]').exists()).toBe(false);

    window.dispatchEvent(new CustomEvent('gz:palette-components-reset'));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-component="airspeed_sensor"]').exists()).toBe(true);
    expect(wrapper.find('[data-component="display_console_1"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it('removes only the created component entry from the palette', async () => {
    const wrapper = mountPalette();

    window.dispatchEvent(new CustomEvent('gz:palette-component-created', {
      detail: { paletteKey: 'airspeed_sensor' }
    }));
    await wrapper.vm.$nextTick();

    expect(groupComponents(wrapper, 'simulation')).toEqual(['barometer_sensor']);
    expect(groupBody(wrapper, 'simulation').find('.simulation-menu-section__count').text()).toBe('1');
    expect(wrapper.find('[data-palette-group="signal-ops"]').exists()).toBe(false);

    window.dispatchEvent(new CustomEvent('gz:palette-component-created', {
      detail: { paletteKey: 'signal_source' }
    }));
    await wrapper.vm.$nextTick();
    expect(groupComponents(wrapper, 'signals')).toContain('signal_source');

    window.dispatchEvent(new CustomEvent('gz:palette-component-deleted', {
      detail: { paletteKey: 'airspeed_sensor' }
    }));
    await wrapper.vm.$nextTick();
    expect(groupComponents(wrapper, 'simulation')).toEqual([
      'airspeed_sensor',
      'barometer_sensor'
    ]);
    expect(groupBody(wrapper, 'simulation').find('.simulation-menu-section__count').text()).toBe('2');

    const dataTransfer = createDragDataTransfer();
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    wrapper.find('[data-component="airspeed_sensor"]').element.dispatchEvent(dragStart);
    expect(dataTransfer.getData('text/plain')).toBe('airspeed_sensor');
    expect(dataTransfer.getData('application/x-gz-palette-key')).toBe('airspeed_sensor');

    wrapper.unmount();
  });
});
