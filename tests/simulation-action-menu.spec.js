import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LeftPalette from '../src/components/layout/LeftPalette.vue';

describe('simulation component action menu', () => {
  it('expands to add, edit and delete actions and switches selection modes', async () => {
    const wrapper = mount(LeftPalette, { attachTo: document.body });

    expect(wrapper.find('[data-open-component-authoring]').exists()).toBe(false);
    await wrapper.find('[data-simulation-actions-menu]').trigger('click');

    const addButton = wrapper.find('[data-open-component-authoring]');
    const editButton = wrapper.find('[data-enter-simulation-edit]');
    const deleteButton = wrapper.find('[data-enter-simulation-delete]');
    expect(addButton.attributes('aria-label')).toBe('新增仿真组件');
    expect(editButton.attributes('aria-label')).toBe('修改仿真组件');
    expect(deleteButton.attributes('aria-label')).toBe('删除仿真组件');
    expect(addButton.text()).toBe('＋');
    expect(editButton.text()).toBe('✎');
    expect(deleteButton.text()).toBe('⌫');

    await editButton.trigger('click');
    expect(wrapper.find('.simulation-delete-status').text()).toContain('修改模式');
    expect(wrapper.find('[data-enter-simulation-edit]').attributes('aria-label')).toBe('退出修改模式');
    await wrapper.find('[data-enter-simulation-edit]').trigger('click');
    expect(wrapper.find('.simulation-delete-status').exists()).toBe(false);

    await deleteButton.trigger('click');
    expect(wrapper.find('.simulation-delete-status').text()).toContain('删除模式');
    expect(wrapper.find('[data-enter-simulation-delete]').exists()).toBe(true);

    await wrapper.find('[data-enter-simulation-delete]').trigger('click');
    expect(wrapper.find('.simulation-delete-status').exists()).toBe(false);
    wrapper.unmount();
  });
});
