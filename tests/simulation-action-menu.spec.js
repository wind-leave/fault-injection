import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LeftPalette from '../src/components/layout/LeftPalette.vue';

describe('simulation component action menu', () => {
  it('does not render the simulation component action menu', () => {
    const wrapper = mount(LeftPalette, { attachTo: document.body });

    expect(wrapper.find('[data-open-component-authoring]').exists()).toBe(false);
    expect(wrapper.find('[data-simulation-actions-menu]').exists()).toBe(false);
    expect(wrapper.find('[data-enter-simulation-edit]').exists()).toBe(false);
    expect(wrapper.find('[data-enter-simulation-delete]').exists()).toBe(false);
    wrapper.unmount();
  });
});
