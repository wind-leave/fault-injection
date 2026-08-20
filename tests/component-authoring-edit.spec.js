import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ComponentAuthoringDialog from '../src/components/dialogs/ComponentAuthoringDialog.vue';
import LeftPalette from '../src/components/layout/LeftPalette.vue';
import { closeComponentAuthoringDialog } from '../src/composables/useDialogsState.js';
import {
  registerAuthoredComponent,
  removeAuthoredComponent,
  useAuthoredComponentCatalog
} from '../src/services/authoredComponentCatalogService.js';

const TYPE = 'custom_component_edit_test';
let createdUnboundType = '';

function authoredComponent() {
  return registerAuthoredComponent({
    id: TYPE,
    type: TYPE,
    moduleId: TYPE,
    executionMode: 'backend',
    name: '可修改滤波器',
    categoryLabel: '信号处理',
    description: '修改模式测试组件',
    icon: '算',
    fileName: `${TYPE}.py`,
    rawSource: 'def process(value):\n    return {"outputs": {"result": value}}',
    entryFunction: 'process',
    inputs: [{ name: '输入值', varName: 'value', type: 'number', defaultValue: '2' }],
    outputs: [{ name: '输出值', varName: 'result', type: 'number' }],
    parameters: []
  }).component;
}

afterEach(() => {
  removeAuthoredComponent(TYPE);
  if (createdUnboundType) removeAuthoredComponent(createdUnboundType);
  createdUnboundType = '';
  closeComponentAuthoringDialog();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('authored component editing', () => {
  it('enters edit mode and opens the selected authored component', async () => {
    authoredComponent();
    const wrapper = mount(LeftPalette, { attachTo: document.body });
    let selected = null;
    const listener = (event) => { selected = event.detail?.component; };
    window.addEventListener('gz:open-component-authoring', listener);

    await wrapper.find('[data-simulation-actions-menu]').trigger('click');
    await wrapper.find('[data-enter-simulation-edit]').trigger('click');
    await wrapper.find(`[data-component="${TYPE}"]`).trigger('click');

    expect(selected).toMatchObject({ type: TYPE, name: '可修改滤波器' });
    window.removeEventListener('gz:open-component-authoring', listener);
    wrapper.unmount();
  });

  it('prefills the authoring dialog and presents save wording', async () => {
    const component = authoredComponent();
    const wrapper = mount(ComponentAuthoringDialog, { attachTo: document.body });

    window.dispatchEvent(new CustomEvent('gz:open-component-authoring', { detail: { component } }));
    await nextTick();

    expect(wrapper.find('#component-authoring-title').text()).toBe('修改仿真组件');
    expect(wrapper.find('[data-authoring-component-name]').element.value).toBe('可修改滤波器');
    expect(wrapper.text()).toContain('custom_component_edit_test.py');
    expect(wrapper.find('[data-save-authored-component]').text()).toContain('试运行后保存');
    wrapper.unmount();
  });

  it('creates an unbound component without calling the backend registration API', async () => {
    const fetchImpl = vi.fn(() => { throw new Error('backend registration should not be called'); });
    vi.stubGlobal('fetch', fetchImpl);
    const wrapper = mount(ComponentAuthoringDialog, { attachTo: document.body });
    window.dispatchEvent(new CustomEvent('gz:open-component-authoring'));
    await nextTick();

    await wrapper.find('[data-authoring-component-name]').setValue('未绑定组件');
    await wrapper.find('.component-icon-picker button').trigger('click');
    await wrapper.find('[data-test-authored-component]').trigger('click');
    expect(wrapper.text()).toContain('组件定义校验通过');
    await wrapper.find('[data-save-authored-component]').trigger('click');
    await nextTick();

    const created = useAuthoredComponentCatalog().components.find((component) => component.name === '未绑定组件');
    createdUnboundType = created?.type ?? '';
    expect(created).toMatchObject({ executionMode: 'mock', rawSource: '', fileName: '' });
    expect(fetchImpl).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
