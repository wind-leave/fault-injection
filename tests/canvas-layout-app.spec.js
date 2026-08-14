import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import App from '../src/App.vue';
import { __resetLegacyRuntimeForTests } from '../src/services/legacyRuntimeBootstrap.js';

function loadPublicPackage(fileName) {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const targetPath = path.resolve(testDir, '..', 'public', 'model-packages', fileName);
  return JSON.parse(readFileSync(targetPath, 'utf8'));
}

async function flushRuntime() {
  await nextTick();
  await Promise.resolve();
}

function countForwardEdges(state) {
  const nodesById = new Map(state.modelNodes.map((node) => [node.id, node]));
  return state.modelEdges.filter((edge) => {
    const source = nodesById.get(edge.sourceNodeId);
    const target = nodesById.get(edge.targetNodeId);
    return source && target && source.x <= target.x;
  }).length;
}

function dispatchPointer(target, type, init = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0
  });
  Object.defineProperty(event, 'pointerId', {
    value: init.pointerId ?? 1
  });
  target.dispatchEvent(event);
}

function readComponentsCss() {
  return readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'components.css'),
    'utf8'
  );
}

function readDialogsCss() {
  return readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'dialogs.css'),
    'utf8'
  );
}

function readIbmWorkbenchCss() {
  return readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'ibm-workbench.css'),
    'utf8'
  );
}

function findCssRule(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\}`))?.[0] ?? '';
}

function faultRefMatches(entry, faultId) {
  if (!entry || !faultId) return false;
  if (typeof entry === 'string') return entry === faultId;
  return [
    entry.id,
    entry.faultId,
    entry.modelId,
    entry.faultModelId,
    entry.faultTypeId,
    entry.instanceId,
    entry.key,
    entry.type
  ].includes(faultId) ||
    faultRefMatches(entry.injectedFault, faultId) ||
    faultRefMatches(entry.fault, faultId);
}

function targetHasFaultRef(target, faultId) {
  if (!target) return false;
  return faultRefMatches(target.fault, faultId) ||
    faultRefMatches(target.injectedFault, faultId) ||
    ['faults', 'faultBindings', 'activeFaults', 'faultInstances', 'appliedFaults'].some((key) =>
      Array.isArray(target[key]) && target[key].some((entry) => faultRefMatches(entry, faultId))
    );
}

function mockNearestEdgePathGeometry(targetEdgeId, point = { x: 120, y: 120 }) {
  document.querySelectorAll('.edge-path[data-edge-id]').forEach((path) => {
    const isTarget = path.dataset.edgeId === targetEdgeId;
    path.getTotalLength = () => 100;
    path.getPointAtLength = () => (isTarget ? point : { x: 5000, y: 5000 });
  });
}

function scopeSampleValue(sample) {
  return Number.isFinite(sample?.actual) ? sample.actual : Number.isFinite(sample?.v) ? sample.v : 0;
}

function maxScopeDiff(actualSamples = [], referenceSamples = [], start = 1, end = 3) {
  const referenceByTime = new Map(referenceSamples.map((sample) => [Number(sample.t).toFixed(3), scopeSampleValue(sample)]));
  return actualSamples
    .filter((sample) => sample.t >= start && sample.t <= end)
    .reduce((maxDiff, sample) => {
      const reference = referenceByTime.get(Number(sample.t).toFixed(3));
      if (!Number.isFinite(reference)) {
        return maxDiff;
      }
      return Math.max(maxDiff, Math.abs(scopeSampleValue(sample) - reference));
    }, 0);
}

function countDroppedScopeSamples(samples = [], start = 0, end = Number.POSITIVE_INFINITY) {
  return samples
    .filter((sample) => sample?.t >= start && sample?.t <= end && sample?.dropped === true)
    .length;
}

function createCanvasContextStub() {
  return {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
    setTransform() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
    measureText() {
      return { width: 24 };
    }
  };
}

describe('canvas layout cleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('exposes extracted canvas graph geometry helpers to the legacy runtime', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(window.__GZ_CANVAS_GRAPH__).toBeTruthy();
    expect(typeof window.__GZ_CANVAS_GRAPH__.resolvePortInfo).toBe('function');
    expect(typeof window.__GZ_CANVAS_GRAPH__.buildEdgePath).toBe('function');

    const source = {
      type: 'signal_source',
      x: 100,
      y: 80
    };
    const ports = {
      inputs: [],
      outputs: [{ key: 'signal', label: '输出' }]
    };
    const sourcePort = window.__GZ_CANVAS_GRAPH__.resolvePortInfo(source, 'output', 0, {
      ports,
      componentLibrary: window.__GZ_COMPONENT_LIBRARY__
    });
    const targetPort = { x: 360, y: 112, side: 'left' };

    expect(sourcePort).toMatchObject({
      x: 264,
      y: 122,
      side: 'right'
    });
    expect(window.__GZ_CANVAS_GRAPH__.buildEdgePath(sourcePort, targetPort)).toBe(
      'M 264 122 C 328 122, 296 112, 360 112'
    );

    wrapper.unmount();
  });

  it('exposes extracted canvas state helpers to the legacy runtime', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(window.__GZ_CANVAS_STATE__).toBeTruthy();
    expect(typeof window.__GZ_CANVAS_STATE__.createSubsystemCanvas).toBe('function');
    expect(typeof window.__GZ_CANVAS_STATE__.openCanvasRecord).toBe('function');

    window.doCreateBlankWorkspace();
    const subsystem = window.createNode('subsystem_block', 320, 180);
    const canvas = window.__GZ_CANVAS_STATE__.createSubsystemCanvas(window.__GZ_STATE__, subsystem);

    expect(canvas.id).toBe(subsystem.targetCanvasId);
    expect(canvas.parentSubsystemNodeId).toBe(subsystem.id);
    expect(window.__GZ_CANVAS_STATE__.openCanvasRecord(
      window.__GZ_STATE__,
      canvas.id,
      ['canvas-root', canvas.id]
    )).toBe(true);
    expect(window.__GZ_STATE__.activeCanvasId).toBe(canvas.id);
    expect(window.__GZ_STATE__.canvasTrail).toEqual(['canvas-root', canvas.id]);

    wrapper.unmount();
  });

  it('syncs simulation duration inputs into backend simulation config', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const durationInput = document.getElementById('sim-dur');
    const stepInput = document.getElementById('sim-step');
    const durationUnit = document.getElementById('sim-dur-unit');
    const stepUnit = document.getElementById('sim-step-unit');
    expect(durationInput.value).toBe('10');
    expect(durationUnit.value).toBe('s');
    durationInput.value = '250';
    durationUnit.value = 'ms';
    stepInput.value = '100';
    stepUnit.value = 'us';

    durationInput.dispatchEvent(new Event('input', { bubbles: true }));
    durationUnit.dispatchEvent(new Event('change', { bubbles: true }));
    stepInput.dispatchEvent(new Event('input', { bubbles: true }));
    stepUnit.dispatchEvent(new Event('change', { bubbles: true }));

    expect(window.__GZ_STATE__.simulationConfig).toEqual({ duration: 0.25, stepSize: 0.0001 });

    const pkg = window.__GZ_BACKEND_SIMULATION__.buildExecutablePackage(window.__GZ_STATE__);
    expect(pkg.simulationConfig).toEqual({ duration: 0.25, stepSize: 0.0001 });

    wrapper.unmount();
  });

  it('rejects simulation startup when the step size exceeds the duration', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    const durationInput = document.getElementById('sim-dur');
    const stepInput = document.getElementById('sim-step');
    const durationUnit = document.getElementById('sim-dur-unit');
    const stepUnit = document.getElementById('sim-step-unit');
    durationInput.value = '1';
    durationUnit.value = 'ms';
    stepInput.value = '2';
    stepUnit.value = 'ms';

    durationInput.dispatchEvent(new Event('input', { bubbles: true }));
    durationUnit.dispatchEvent(new Event('change', { bubbles: true }));
    stepInput.dispatchEvent(new Event('input', { bubbles: true }));
    stepUnit.dispatchEvent(new Event('change', { bubbles: true }));
    await window.simRun();
    await flushRuntime();

    expect(window.__GZ_SIM__.inited).toBe(false);
    expect(window.__GZ_SIM__.running).toBe(false);
    expect(document.body.textContent).toContain('仿真步长不能大于仿真时长');

    wrapper.unmount();
  });

  it('shows simulation progress in the selected duration unit', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    document.getElementById('sim-dur-unit').value = 'ms';
    document.getElementById('sim-dur-unit').dispatchEvent(new Event('change', { bubbles: true }));
    window.__GZ_SIM__.duration = 0.01;
    window.__GZ_SIM__.time = 0.002;
    window.__GZ_SIM__.running = true;
    window.__GZ_SIM__.paused = false;
    window.updateUI();
    await flushRuntime();

    expect(document.getElementById('stxt')?.textContent).toContain('t = 2ms / 10ms');

    wrapper.unmount();
  });

  it('uses the editable task name when saving a system model', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const taskNameInput = document.getElementById('task-name');
    expect(document.querySelector('.simbar-title__kicker')?.textContent).toBe('任务名称');
    expect(taskNameInput).not.toBeNull();

    window.doCreateBlankWorkspace();
    window.createNode('signal_source', 320, 220);
    taskNameInput.value = '姿态控制回归任务';
    taskNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushRuntime();

    expect(window.__GZ_STATE__.taskName).toBe('姿态控制回归任务');
    const exportedPackage = window.__GZ_FLIGHT_MODEL_PACKAGE__.exportCurrent();
    expect(exportedPackage.modelName).toBe('姿态控制回归任务');
    expect(exportedPackage.workbenchSnapshot.taskName).toBe('姿态控制回归任务');

    window.doSaveSys();
    await flushRuntime();
    const savedSnapshot = JSON.parse(window.localStorage.getItem('gz-workbench-system-model'));
    expect(savedSnapshot.taskName).toBe('姿态控制回归任务');

    wrapper.unmount();
  });

  it('exposes extracted canvas selection helpers to the legacy runtime', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(window.__GZ_CANVAS_SELECTION__).toBeTruthy();
    expect(typeof window.__GZ_CANVAS_SELECTION__.getNode).toBe('function');
    expect(typeof window.__GZ_CANVAS_SELECTION__.clearCanvasSelectionState).toBe('function');
    expect(typeof window.__GZ_CANVAS_SELECTION__.markTopologyDirty).toBe('function');

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 120, 160);
    window.selectNode(source.id);
    await flushRuntime();

    expect(window.__GZ_CANVAS_SELECTION__.getNode(window.__GZ_STATE__, source.id)).toBe(source);
    expect(window.__GZ_STATE__.selBlk).toBe(source.id);

    window.__GZ_CANVAS_SELECTION__.clearCanvasSelectionState(window.__GZ_STATE__);
    expect(window.__GZ_STATE__.selBlk).toBeNull();
    expect(window.__GZ_STATE__.selEdge).toBeNull();

    window.__GZ_STATE__.systemSaved = true;
    window.__GZ_STATE__.step = 3;
    window.__GZ_STATE__.simDone = true;
    window.__GZ_CANVAS_SELECTION__.markTopologyDirty(window.__GZ_STATE__, window.__GZ_SIM__, 'system');
    expect(window.__GZ_STATE__.systemSaved).toBe(false);
    expect(window.__GZ_STATE__.step).toBe(1);
    expect(window.__GZ_SIM__.running).toBe(false);

    wrapper.unmount();
  });

  it('exposes extracted canvas render helpers to the legacy runtime', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(window.__GZ_CANVAS_RENDER__).toBeTruthy();
    expect(typeof window.__GZ_CANVAS_RENDER__.renderCanvasBreadcrumbs).toBe('function');
    expect(typeof window.__GZ_CANVAS_RENDER__.createEdgeDomElements).toBe('function');

    const host = document.createElement('div');
    window.__GZ_CANVAS_RENDER__.renderCanvasBreadcrumbs(host, {
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-child',
      trail: ['canvas-root', 'canvas-child'],
      getCanvasRecord(canvasId) {
        return canvasId === 'canvas-child' ? { name: '子系统' } : { name: '顶层' };
      }
    });

    expect(host.querySelectorAll('[data-canvas-id]')).toHaveLength(2);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain('子系统');

    wrapper.unmount();
  });

  it('exposes extracted fault template render helpers to the legacy runtime', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(window.__GZ_FAULT_TEMPLATE_RENDER__).toBeTruthy();
    expect(typeof window.__GZ_FAULT_TEMPLATE_RENDER__.renderFaultTemplateGrid).toBe('function');
    expect(typeof window.__GZ_FAULT_TEMPLATE_RENDER__.renderFaultTemplateDetail).toBe('function');

    const host = document.createElement('div');
    window.__GZ_FAULT_TEMPLATE_RENDER__.renderFaultTemplateGrid(host, {
      category: 'physical',
      templates: [{ id: 'fault-a', name: 'Fault A', desc: 'Fault desc', tags: ['tag'], c: '#2563eb' }],
      selectedTemplates: []
    });

    expect(host.querySelectorAll('.tcard')).toHaveLength(1);
    expect(host.querySelector('.tcard-name')?.textContent).toBe('Fault A');

    wrapper.unmount();
  });

  it('exposes extracted fault catalog render helpers to the legacy runtime', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(window.__GZ_FAULT_CATALOG_RENDER__).toBeTruthy();
    expect(typeof window.__GZ_FAULT_CATALOG_RENDER__.renderFaultCatalogList).toBe('function');

    const host = document.createElement('div');
    const hint = document.createElement('div');
    window.__GZ_FAULT_CATALOG_RENDER__.renderFaultCatalogList(host, hint, {
      models: [{ id: 'fault-a', name: 'Fault A', layer: 'physical', tags: ['tag'] }],
      importedModels: [],
      selectedId: 'fault-a',
      getLayerLabel: () => 'Physical Layer'
    });

    expect(host.querySelectorAll('.ifm-item')).toHaveLength(1);
    expect(hint.textContent).toBe('已选：Fault A · Physical Layer');

    wrapper.unmount();
  });

  it('exposes one-click layout cleanup and arranges imported model edges left-to-right', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    window.createNode('signal_source', 620, 400);
    window.createNode('gain_block', 120, 400);
    await flushRuntime();

    const stateBeforeArrange = window.__GZ_STATE__;
    const [sourceNode, gainNode] = stateBeforeArrange.modelNodes;
    stateBeforeArrange.modelEdges.push({
      id: 'edge-layout-test',
      lineType: 'normal',
      sourceNodeId: sourceNode.id,
      targetNodeId: gainNode.id,
      sourcePortIndex: 0,
      targetPortIndex: 0
    });
    expect(document.querySelector('.canvas-arrange__button')?.textContent).toContain('一键整理');
    expect(typeof window.autoArrangeCanvas).toBe('function');

    const beforeForward = countForwardEdges(window.__GZ_STATE__);
    window.autoArrangeCanvas();
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const afterForward = countForwardEdges(state);

    expect(afterForward).toBeGreaterThanOrEqual(beforeForward);
    expect(afterForward / state.modelEdges.length).toBeGreaterThanOrEqual(0.75);
    expect(state.modelNodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);

    wrapper.unmount();
  });

  it('does not expose the removed model-check command or inspector entry', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(document.querySelector('.canvas-check__button')).toBeNull();
    expect(document.querySelector('[data-canvas-command="model-check"]')).toBeNull();
    expect(window.runModelCheck).toBeUndefined();

    wrapper.unmount();
  });

  it('collapses and restores the component library without leaving an empty layout column', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const toggle = wrapper.get('[data-testid="left-palette-toggle"]');
    expect(toggle.attributes('aria-expanded')).toBe('true');

    await toggle.trigger('click');
    expect(wrapper.get('[data-testid="workbench-root"]').classes()).toContain('is-left-panel-collapsed');
    expect(wrapper.get('[data-testid="left-palette"]').classes()).toContain('is-collapsed');
    expect(toggle.attributes('aria-expanded')).toBe('false');

    await toggle.trigger('click');
    expect(wrapper.get('[data-testid="workbench-root"]').classes()).not.toContain('is-left-panel-collapsed');
    expect(toggle.attributes('aria-expanded')).toBe('true');

    const ibmCss = readIbmWorkbenchCss();
    expect(ibmCss).toContain('.gz-app.is-left-panel-collapsed .workbench-main');
    expect(ibmCss).toContain('grid-template-columns:minmax(0,1fr) var(--layout-resizer-size) var(--workbench-right-w)');
    expect(ibmCss).toContain('top:280px;');
    expect(ibmCss).toContain('opacity:.42;');
    expect(ibmCss).toContain('width:18px;');
    expect(ibmCss).toContain('height:48px;');
    expect(ibmCss).toContain('.workbench-main .lpanel .lscroll');
    expect(toggle.text()).not.toContain('收起');

    wrapper.unmount();
  });

  it('collapses and restores the right inspector while preserving its edge toggle', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const toggle = wrapper.get('[data-testid="right-inspector-toggle"]');
    expect(toggle.attributes('aria-expanded')).toBe('true');

    await toggle.trigger('click');
    expect(wrapper.get('[data-testid="workbench-root"]').classes()).toContain('is-right-panel-collapsed');
    expect(wrapper.get('[data-testid="right-inspector"]').classes()).toContain('is-collapsed');
    expect(toggle.attributes('aria-expanded')).toBe('false');

    await toggle.trigger('click');
    expect(wrapper.get('[data-testid="workbench-root"]').classes()).not.toContain('is-right-panel-collapsed');
    expect(toggle.attributes('aria-expanded')).toBe('true');

    const ibmCss = readIbmWorkbenchCss();
    expect(ibmCss).toContain('.gz-app.is-right-panel-collapsed .workbench-main');
    expect(ibmCss).toContain('grid-template-columns:var(--workbench-left-w) var(--layout-resizer-size) minmax(0,1fr)');
    expect(ibmCss).toContain('.right-panel-toggle');

    wrapper.unmount();
  });

  it('collapses and restores the canvas chrome and status bar', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const topToggle = wrapper.get('[data-testid="canvas-top-toggle"]');
    window.dispatchEvent(new CustomEvent('gz:toggle-canvas-top-chrome'));
    await nextTick();
    expect(wrapper.get('[data-testid="workbench-root"]').classes()).toContain('is-canvas-top-chrome-collapsed');
    await topToggle.trigger('click');
    expect(wrapper.get('[data-testid="workbench-root"]').classes()).not.toContain('is-canvas-top-chrome-collapsed');

    const statusToggle = wrapper.get('[data-testid="status-bar-toggle"]');
    await statusToggle.trigger('click');
    expect(wrapper.get('[data-testid="workbench-root"]').classes()).toContain('is-status-bar-collapsed');
    expect(statusToggle.attributes('aria-expanded')).toBe('false');
    await statusToggle.trigger('click');
    expect(wrapper.get('[data-testid="workbench-root"]').classes()).not.toContain('is-status-bar-collapsed');

    const ibmCss = readIbmWorkbenchCss();
    expect(ibmCss).toContain('.canvas-top-toggle');
    expect(ibmCss).toContain('.status-bar-toggle');
    expect(ibmCss).toContain('border-bottom:6px solid currentColor;');
    expect(ibmCss).toContain('top:126px;');
    expect(ibmCss).toContain('top:-34px;');
    expect(ibmCss).toContain('grid-template-rows:minmax(0,1fr)');

    wrapper.unmount();
  });

  it('reveals canvas floating tools only after their round toggle is activated', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const toggle = wrapper.get('[data-testid="canvas-floating-toggle"]');
    expect(wrapper.get('[data-testid="workbench-root"]').classes()).not.toContain('is-canvas-floating-controls-open');

    await toggle.trigger('click');
    expect(wrapper.get('[data-testid="workbench-root"]').classes()).toContain('is-canvas-floating-controls-open');

    await toggle.trigger('click');
    expect(wrapper.get('[data-testid="workbench-root"]').classes()).not.toContain('is-canvas-floating-controls-open');

    const ibmCss = readIbmWorkbenchCss();
    expect(ibmCss).toContain('.canvas-floating-toggle');
    expect(ibmCss).toContain('border-radius:50%;');
    expect(ibmCss).toContain('.canvas-floating-content');

    wrapper.unmount();
  });

  it('keeps the status log entries in a dedicated scroll region', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const scrollRegion = wrapper.get('[data-status-log-scroll]');
    expect(scrollRegion.attributes('role')).toBe('region');
    expect(scrollRegion.attributes('tabindex')).toBe('0');
    expect(scrollRegion.find('[data-log-entry]').exists()).toBe(true);

    window.__GZ_STATUS_BAR__.pushEntry({ source: '画布工具', message: '最新日志' });
    expect(scrollRegion.find('[data-log-entry]').text()).toContain('最新日志');

    const ibmCss = readIbmWorkbenchCss();
    expect(ibmCss).toContain('.sbar-log-scroll');
    expect(ibmCss).toContain('overscroll-behavior:contain;');
    expect(ibmCss).toContain('scrollbar-gutter:stable;');
    expect(ibmCss).toContain('.sbar-card{\n  height:auto;');
    expect(ibmCss).toContain('max-height:none;');

    wrapper.unmount();
  });

  it('docks simulation controls above the canvas and removes obsolete header project details', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(document.querySelector('.workbench-taskbar')).toBeNull();
    expect(document.querySelector('header .header-project')).toBeNull();
    expect(document.querySelector('.canvas-sim-dock #simbar')).not.toBeNull();
    expect(document.querySelector('header > .toolbar #btn-imp-sys')).not.toBeNull();
    expect(document.querySelector('.canvas-wrap > #simbar')).toBeNull();
    expect(document.querySelectorAll('.sbar-row')).toHaveLength(3);
    expect(document.querySelectorAll('.sbar-card')).toHaveLength(4);

    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const normalizeLineEndings = (value) => value.replace(/\r\n/g, '\n');
    const baseCss = normalizeLineEndings(readFileSync(path.resolve(testDir, '..', 'src', 'styles', 'base.css'), 'utf8'));
    const componentsCss = normalizeLineEndings(readFileSync(path.resolve(testDir, '..', 'src', 'styles', 'components.css'), 'utf8'));
    const dialogsCss = normalizeLineEndings(readDialogsCss());
    const consoleCss = normalizeLineEndings(readFileSync(path.resolve(testDir, '..', 'src', 'styles', 'console-redesign.css'), 'utf8'));
    const ibmCss = normalizeLineEndings(readFileSync(path.resolve(testDir, '..', 'src', 'styles', 'ibm-workbench.css'), 'utf8'));

    expect(baseCss).toContain('grid-template-rows:minmax(0,1fr) var(--layout-resizer-size) var(--workbench-status-h)');
    expect(baseCss).toContain('--workbench-status-h:100px');
    expect(consoleCss).toContain('grid-template-rows:56px minmax(0,1fr)');
    expect(consoleCss).toContain('.workbench-taskbar');
    expect(consoleCss).toContain('display:none!important');
    expect(consoleCss).not.toContain('.header-project');
    expect(consoleCss).toContain('.canvas-sim-dock .simbar');
    expect(consoleCss).toContain('@media (max-width:1680px)');
    expect(consoleCss).toContain('grid-template-rows:104px minmax(0,1fr)');
    expect(consoleCss).toContain('header .toolbar .tbtn{\n  flex:0 0 auto;');
    expect(consoleCss).toContain('header .toolbar{\n    grid-column:2;');
    expect(consoleCss).toContain('@media (max-width:1120px)');
    expect(consoleCss).toContain('grid-template-rows:156px minmax(0,1fr)');
    expect(consoleCss).toContain('top:140px');
    expect(ibmCss).toContain('@media (min-width:1281px) and (max-width:1900px)');
    expect(ibmCss).toContain('@media (min-width:1121px) and (max-width:1280px)');
    expect(ibmCss).toContain('grid-template-rows:56px minmax(0,1fr)');
    expect(ibmCss).toContain('grid-template-rows:104px minmax(0,1fr)');
    expect(ibmCss).toContain('grid-column:1 / -1;');
    expect(ibmCss).toContain('grid-template-columns:minmax(168px,var(--workbench-left-w,220px)) minmax(300px,1fr) max-content');
    expect(ibmCss).toContain('grid-template-rows:70px 48px');
    expect(ibmCss).toContain('top:118px');
    expect(ibmCss).toContain('top:130px');
    const ibmSimTitleRule = findCssRule(ibmCss, '.simbar-title');
    const ibmSimFieldRule = findCssRule(ibmCss, '.canvas-sim-dock .sim-field');
    const ibmSimRtRule = findCssRule(ibmCss, '.canvas-sim-dock .simbar-rt');
    expect(ibmSimTitleRule).toMatch(/min-width\s*:\s*112px/);
    expect(ibmSimTitleRule).toMatch(/padding\s*:\s*0 12px/);
    expect(ibmSimFieldRule).toMatch(/flex\s*:\s*0 0 auto/);
    expect(ibmSimFieldRule).toMatch(/min-width\s*:\s*112px/);
    expect(ibmSimFieldRule).toMatch(/padding\s*:\s*0 10px/);
    expect(ibmSimRtRule).toMatch(/flex\s*:\s*0 0 112px/);
    const canvasStageRule = findCssRule(componentsCss, '.canvas-stage');
    expect(canvasStageRule).toMatch(/width\s*:\s*2400px/);
    expect(canvasStageRule).toMatch(/height\s*:\s*1500px/);
    expect(canvasStageRule).toMatch(/--canvas-stage-layer-edges\s*:\s*1/);
    expect(canvasStageRule).toMatch(/--canvas-stage-layer-nodes\s*:\s*4/);
    expect(canvasStageRule).toMatch(/--canvas-stage-layer-edge-controls\s*:\s*8/);
    expect(canvasStageRule).toMatch(/--canvas-stage-layer-windows\s*:\s*12/);
    expect(findCssRule(componentsCss, '.canvas-edge-control-layer')).toMatch(/z-index\s*:\s*var\(--canvas-stage-layer-edge-controls\)/);
    expect(findCssRule(dialogsCss, '.scope-window-layer')).toMatch(/z-index\s*:\s*var\(--canvas-stage-layer-windows\)/);
    expect(document.getElementById('edge-layer')?.getAttribute('viewBox')).toBe('0 0 2400 1500');
    expect(readFileSync(path.resolve(testDir, '..', 'src', 'fragments', 'canvas.html'), 'utf8')).not.toContain('viewBox="0 0 1600 980"');
    expect(ibmCss).not.toContain('--canvas-chrome-h:84px');
    expect(ibmCss).toContain('.tbtn-imp-flt');
    expect(ibmCss).toContain('.fault-tag-param-actions');
    expect(findCssRule(ibmCss, '.fault-tag-param-actions div')).toMatch(/flex-wrap\s*:\s*nowrap/);
    expect(findCssRule(ibmCss, '.fault-tag-param-actions div')).toMatch(/white-space\s*:\s*nowrap/);
    expect(findCssRule(ibmCss, '.fault-tag-param-actions button')).toMatch(/white-space\s*:\s*nowrap/);
    expect(findCssRule(ibmCss, '.fault-tag-param-actions button')).toMatch(/word-break\s*:\s*keep-all/);
    expect(componentsCss).toContain('.sbar{\n  height:100%;');
    expect(componentsCss).toContain('.sbar-log-head');
    expect(componentsCss).toContain('flex:0 0 30px');
    expect(componentsCss).toContain('height:17px;');
    expect(findCssRule(componentsCss, '.props-panel-hero')).toMatch(/display\s*:\s*block/);
    expect(findCssRule(componentsCss, '.props-panel-hero')).toMatch(/height\s*:\s*auto/);
    expect(findCssRule(componentsCss, '.rpanel[data-props-panel-kind="fault-tag"] .props-tabs')).toMatch(/grid-template-columns\s*:\s*repeat\(2/);
    expect(findCssRule(componentsCss, '.rpanel[data-props-panel-kind="scope"] .props-tabs')).toMatch(/grid-template-columns\s*:\s*repeat\(3/);
    expect(findCssRule(componentsCss, '.scope-overview-open')).toMatch(/background\s*:\s*#16a34a/);
    expect(findCssRule(componentsCss, '.scope-export-actions')).toMatch(/grid-template-columns\s*:\s*1fr 1fr/);
    expect(findCssRule(componentsCss, '.layered-fault-dialog')).toMatch(/width\s*:\s*min\(520px/);
    expect(findCssRule(componentsCss, '.layered-fault-dialog')).toMatch(/right\s*:\s*calc\(var\(--workbench-right-w/);
    expect(findCssRule(componentsCss, '.layered-fault-dialog__head')).toMatch(/cursor\s*:\s*move/);
    expect(findCssRule(componentsCss, '.edge-hit.is-fault-drop-compatible')).toMatch(/stroke-width\s*:\s*36!important/);
    expect(findCssRule(componentsCss, '.edge-label.is-fault-drop-compatible')).toMatch(/pointer-events\s*:\s*auto/);
    expect(findCssRule(componentsCss, '.diagram.fault-drop-preview--protocol .edge-path.is-fault-drop-compatible')).toMatch(/stroke\s*:\s*#2f73ff!important/);
    expect(findCssRule(componentsCss, '.layered-fault-edge-marker__pin')).toMatch(/fill\s*:\s*#dc2626/);
    expect(findCssRule(componentsCss, '.diagram.fault-drop-preview .fault-tag-card')).toMatch(/opacity\s*:\s*\.16/);
    expect(componentsCss).not.toMatch(/@media\s*\(max-height:820px\)[\s\S]*?\.sbar\s*\{[\s\S]*?height:78px/);
    expect(componentsCss).not.toMatch(/\.sbar\s*\{[\s\S]*?max-height:78px/);

    wrapper.unmount();
  });

  it('lets users resize side panels and the bottom status layer with drag handles', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const root = document.querySelector('[data-testid="workbench-root"]');
    const main = document.querySelector('.workbench-main');
    expect(root).not.toBeNull();
    expect(main).not.toBeNull();

    Object.defineProperty(main, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 140,
        width: 1500,
        height: 760,
        top: 140,
        left: 0,
        right: 1500,
        bottom: 900,
        toJSON() {
          return this;
        }
      })
    });

    const leftHandle = document.querySelector('[data-layout-resizer="left"]');
    const rightHandle = document.querySelector('[data-layout-resizer="right"]');
    const bottomHandle = document.querySelector('[data-layout-resizer="bottom"]');
    expect(leftHandle).not.toBeNull();
    expect(rightHandle).not.toBeNull();
    expect(bottomHandle).not.toBeNull();

    dispatchPointer(leftHandle, 'pointerdown', { pointerId: 21, clientX: 236, clientY: 220 });
    dispatchPointer(window, 'pointermove', { pointerId: 21, clientX: 292, clientY: 220 });
    dispatchPointer(window, 'pointerup', { pointerId: 21, clientX: 292, clientY: 220 });
    await flushRuntime();
    expect(root.style.getPropertyValue('--workbench-left-w')).toBe('292px');

    dispatchPointer(rightHandle, 'pointerdown', { pointerId: 22, clientX: 1194, clientY: 220 });
    dispatchPointer(window, 'pointermove', { pointerId: 22, clientX: 1148, clientY: 220 });
    dispatchPointer(window, 'pointerup', { pointerId: 22, clientX: 1148, clientY: 220 });
    await flushRuntime();
    expect(root.style.getPropertyValue('--workbench-right-w')).toBe('352px');

    dispatchPointer(bottomHandle, 'pointerdown', { pointerId: 23, clientX: 800, clientY: 900 });
    dispatchPointer(window, 'pointermove', { pointerId: 23, clientX: 800, clientY: 850 });
    dispatchPointer(window, 'pointerup', { pointerId: 23, clientX: 800, clientY: 850 });
    await flushRuntime();
    expect(root.style.getPropertyValue('--workbench-status-h')).toBe('150px');

    expect(window.localStorage.getItem('gz.layoutSizes.v3')).toContain('"left":292');
    expect(window.localStorage.getItem('gz.layoutSizes.v3')).toContain('"right":352');
    expect(window.localStorage.getItem('gz.layoutSizes.v3')).toContain('"status":150');

    wrapper.unmount();
  });

  it('lets dragged nodes reach the visible top of the canvas stage', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('flow_block', 420, 260);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const node = state.modelNodes.find((item) => item.type === 'flow_block');
    const nodeEl = document.getElementById(`b-${node.id}`);
    const viewport = document.getElementById('canvas-viewport');
    expect(node.y).toBeGreaterThan(24);

    dispatchPointer(nodeEl, 'pointerdown', { pointerId: 41, clientX: 420, clientY: 260 });
    dispatchPointer(viewport, 'pointermove', { pointerId: 41, clientX: 420, clientY: -260 });
    dispatchPointer(viewport, 'pointerup', { pointerId: 41, clientX: 420, clientY: -260 });
    await flushRuntime();

    expect(node.y).toBe(24);

    wrapper.unmount();
  });

  it('expands the canvas stage when a dragged node reaches its outer edge', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    const node = window.createNode('flow_block', 420, 260);
    await flushRuntime();

    const nodeEl = document.getElementById(`b-${node.id}`);
    const viewport = document.getElementById('canvas-viewport');
    const stage = document.getElementById('canvas-stage');
    expect(stage.style.width).toBe('2400px');
    expect(stage.style.height).toBe('1500px');

    dispatchPointer(nodeEl, 'pointerdown', { pointerId: 42, clientX: 420, clientY: 260 });
    dispatchPointer(viewport, 'pointermove', { pointerId: 42, clientX: 2800, clientY: 2100 });
    dispatchPointer(viewport, 'pointerup', { pointerId: 42, clientX: 2800, clientY: 2100 });
    await flushRuntime();

    expect(Number.parseInt(stage.style.width, 10)).toBeGreaterThan(2400);
    expect(Number.parseInt(stage.style.height, 10)).toBeGreaterThan(1500);
    expect(document.getElementById('edge-layer')?.getAttribute('viewBox')).toBe(`0 0 ${stage.style.width.replace('px', '')} ${stage.style.height.replace('px', '')}`);
    expect(node.x + node.w).toBeLessThan(Number.parseInt(stage.style.width, 10));
    expect(node.y + node.h).toBeLessThan(Number.parseInt(stage.style.height, 10));

    wrapper.unmount();
  });

  it('keeps extending the workspace while panning into empty canvas space', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    const viewport = document.getElementById('canvas-viewport');
    const stage = document.getElementById('canvas-stage');
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 640 }
    });

    dispatchPointer(viewport, 'pointerdown', { pointerId: 43, clientX: 500, clientY: 400 });
    dispatchPointer(viewport, 'pointermove', { pointerId: 43, clientX: -2600, clientY: -2100 });
    dispatchPointer(viewport, 'pointerup', { pointerId: 43, clientX: -2600, clientY: -2100 });
    await flushRuntime();

    expect(Number.parseInt(stage.style.width, 10)).toBeGreaterThan(2400);
    expect(Number.parseInt(stage.style.height, 10)).toBeGreaterThan(1500);
    expect(document.getElementById('edge-layer')?.getAttribute('viewBox')).toBe(`0 0 ${stage.style.width.replace('px', '')} ${stage.style.height.replace('px', '')}`);

    wrapper.unmount();
  });

  it('lets both side panels span through the bottom layer while logs stay under the canvas only', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const main = document.querySelector('.workbench-main');
    expect(main?.querySelector('.lpanel')).not.toBeNull();
    expect(main?.querySelector('.rpanel')).not.toBeNull();
    expect(main?.querySelector('.sbar')).not.toBeNull();
    expect(document.querySelector('.gz-app > .sbar')).toBeNull();

    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const baseCss = readFileSync(path.resolve(testDir, '..', 'src', 'styles', 'base.css'), 'utf8');
    const componentsCss = readFileSync(path.resolve(testDir, '..', 'src', 'styles', 'components.css'), 'utf8');

    expect(baseCss).toContain('grid-template-rows:auto var(--workbench-taskbar-h) minmax(0,1fr)');
    expect(baseCss).toContain('grid-template-rows:minmax(0,1fr) var(--layout-resizer-size) var(--workbench-status-h)');
    expect(componentsCss).toMatch(/\.workbench-main \.lpanel\{[\s\S]*?grid-column:1;[\s\S]*?grid-row:1 \/ 4;/);
    expect(componentsCss).toMatch(/\.workbench-main \.rpanel\{[\s\S]*?grid-column:5;[\s\S]*?grid-row:1 \/ 4;/);
    expect(componentsCss).toMatch(/\.workbench-main \.sbar\{[\s\S]*?grid-column:3;[\s\S]*?grid-row:3;/);
    expect(componentsCss).toMatch(/\.workbench-main \.layout-resizer--left\{[\s\S]*?grid-column:2;[\s\S]*?grid-row:1 \/ 4;/);
    expect(componentsCss).toMatch(/\.workbench-main \.layout-resizer--bottom\{[\s\S]*?grid-column:3;[\s\S]*?grid-row:2;/);

    wrapper.unmount();
  });

  it('uses a cohesive bottom status deck with log actions and compact metric cards', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(document.querySelector('.sbar-log-head')).not.toBeNull();
    expect(document.querySelectorAll('.sbar-action')).toHaveLength(3);
    expect(document.querySelectorAll('.sbar-card__accent')).toHaveLength(4);

    const componentsCss = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'components.css'),
      'utf8'
    );
    expect(componentsCss).toContain('background:linear-gradient(180deg,#f8fbff 0%,#eef4fb 100%)');
    expect(componentsCss).toContain('.sbar-log-head');
    expect(componentsCss).toContain('.sbar-card__accent');
    expect(componentsCss).toContain('grid-template-columns:repeat(2,minmax(0,1fr));');
    expect(componentsCss).toContain('grid-template-rows:repeat(2,minmax(0,1fr));');
    expect(componentsCss).toContain('height:38px;');
    expect(componentsCss).toContain('font-size:12px;');

    wrapper.unmount();
  });

  it('formats bottom metrics with coordinated numeric typography instead of heavy sentence text', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(typeof window.__GZ_STATUS_BAR__?.formatMetrics).toBe('function');
    window.__GZ_STATUS_BAR__.formatMetrics({
      components: 9,
      links: 14,
      faults: 2,
      state: '待机',
      time: '00:00:00'
    });
    await flushRuntime();

    const componentCard = document.getElementById('sblk');
    const faultCard = document.getElementById('sflt');
    expect(componentCard?.querySelectorAll('.sbar-metric-number')).toHaveLength(2);
    expect(componentCard?.querySelectorAll('.sbar-metric-unit')).toHaveLength(2);
    expect(componentCard?.textContent).toContain('9');
    expect(componentCard?.textContent).toContain('14');
    expect(faultCard?.querySelector('.sbar-metric-number')?.textContent).toBe('2');

    const componentsCss = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'components.css'),
      'utf8'
    );
    expect(componentsCss).toContain('.sbar-metric-number');
    expect(componentsCss).toContain('font-variant-numeric:tabular-nums');
    expect(componentsCss).toContain('font-family:var(--font-data)');

    wrapper.unmount();
  });

  it('turns status log actions into working controls and preserves a visible empty state', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const levelButton = document.querySelector('[data-status-action="level"]');
    const clearButton = document.querySelector('[data-status-action="clear"]');
    const exportButton = document.querySelector('[data-status-action="export"]');
    const alertTab = document.querySelector('[data-status-tab="alerts"]');
    const logTab = document.querySelector('[data-status-tab="log"]');

    expect(typeof window.__GZ_STATUS_BAR__?.applyLevelFilter).toBe('function');
    expect(typeof window.__GZ_STATUS_BAR__?.exportLog).toBe('function');
    expect(levelButton).not.toBeNull();
    expect(clearButton).not.toBeNull();
    expect(exportButton).not.toBeNull();

    levelButton.click();
    await flushRuntime();
    expect(levelButton.textContent).toContain('信息');
    expect(document.querySelector('.sbar')?.dataset.filterLevel).toBe('info');
    expect(document.querySelector('[data-log-entry][data-level="ok"]')?.classList.contains('is-hidden')).toBe(true);

    alertTab.click();
    await flushRuntime();
    expect(alertTab.classList.contains('is-active')).toBe(true);
    expect(document.querySelector('[data-status-empty]')?.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('[data-status-empty]')?.textContent).toContain('暂无告警记录');

    logTab.click();
    clearButton.click();
    await flushRuntime();
    expect(document.querySelectorAll('[data-log-entry]:not(.is-hidden)')).toHaveLength(0);
    expect(document.querySelector('[data-status-empty]')?.textContent).toContain('日志已清空');

    const exportResult = window.__GZ_STATUS_BAR__.exportLog();
    expect(exportResult.ok).toBe(true);
    expect(exportResult.content).toContain('时间,级别,来源,消息');

    wrapper.unmount();
  });

  it('accepts runtime status events and routes warning entries into the alert view', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pushResult = window.__GZ_STATUS_BAR__.pushEntry({
      level: 'warn',
      source: '故障注入',
      message: 'F1_舵机卡滞接近触发窗口'
    });
    await flushRuntime();

    expect(pushResult.ok).toBe(true);
    const alertRow = document.querySelector('[data-log-entry][data-level="warn"]');
    expect(alertRow).not.toBeNull();
    expect(alertRow?.textContent).toContain('故障注入');
    expect(alertRow?.textContent).toContain('F1_舵机卡滞接近触发窗口');

    document.querySelector('[data-status-tab="alerts"]').click();
    await flushRuntime();
    expect(alertRow?.classList.contains('is-hidden')).toBe(false);
    expect(window.__GZ_STATUS_BAR__.exportLog().content).toContain('F1_舵机卡滞接近触发窗口');

    wrapper.unmount();
  });

  it('publishes simulation summaries into result and performance status views', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(typeof window.__GZ_STATUS_BAR__?.publishSimulationSummary).toBe('function');

    const publishResult = window.__GZ_STATUS_BAR__.publishSimulationSummary({
      datasetName: 'ui-regression-run',
      duration: 1200,
      elapsedSeconds: 4.2,
      faults: 2,
      sampleRate: '100 Hz',
      status: 'completed',
      stepIndex: 42
    });
    await flushRuntime();

    expect(publishResult.ok).toBe(true);

    document.querySelector('[data-status-tab="results"]').click();
    await flushRuntime();
    const resultRow = document.querySelector('[data-log-entry][data-view="results"]');
    expect(resultRow).not.toBeNull();
    expect(resultRow?.classList.contains('is-hidden')).toBe(false);
    expect(resultRow?.textContent).toContain('ui-regression-run');
    expect(resultRow?.textContent).toContain('42');

    document.querySelector('[data-status-tab="performance"]').click();
    await flushRuntime();
    const performanceRow = document.querySelector('[data-log-entry][data-view="performance"]');
    expect(performanceRow).not.toBeNull();
    expect(performanceRow?.classList.contains('is-hidden')).toBe(false);
    expect(performanceRow?.textContent).toContain('100 Hz');
    expect(performanceRow?.textContent).toContain('4.2');

    wrapper.unmount();
  });

  it('keeps the live status row after more than 29 simulation summary updates', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    for (let stepIndex = 1; stepIndex <= 65; stepIndex += 1) {
      window.__GZ_STATUS_BAR__.publishSimulationSummary({
        datasetName: 'long-run',
        duration: 10,
        elapsedSeconds: stepIndex * 0.1,
        status: 'stepped',
        stepIndex
      });
    }

    expect(document.querySelector('[data-status-live-row]')).not.toBeNull();
    expect(document.getElementById('stxt')).not.toBeNull();
    expect(document.querySelectorAll('[data-log-entry][data-view="results"]')).toHaveLength(60);
    expect(document.querySelectorAll('[data-log-entry][data-view="performance"]')).toHaveLength(60);
    expect(() => window.updateUI()).not.toThrow();

    wrapper.unmount();
  });

  it('updates the live status row with the operation time instead of a fixed template time', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const result = window.__GZ_STATUS_BAR__.updateLiveStatus('仿真运行中', {
      key: 'simulation-running',
      time: '12:39:55',
      updateTime: true
    });
    window.__GZ_STATUS_BAR__.updateLiveStatus('仿真运行中 · t = 2.9s / 10s', {
      key: 'simulation-running',
      time: '12:40:24'
    });

    expect(result.ok).toBe(true);
    expect(document.querySelector('[data-status-live-time]')?.textContent).toBe('12:39:55');
    expect(document.getElementById('stxt')?.textContent).toBe('仿真运行中 · t = 2.9s / 10s');
    expect(document.body.textContent).not.toContain('10:24:31');

    wrapper.unmount();
  });

  it('creates a new time-sorted live log row for every simulation run', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.__GZ_STATUS_BAR__.beginLiveStatus({
      key: 'simulation-starting',
      message: '第一次仿真',
      source: '仿真控制',
      time: '12:39:55',
      timestamp: 1000
    });
    window.__GZ_STATUS_BAR__.updateLiveStatus('第一次仿真 · t = 10s / 10s', {
      key: 'simulation-running'
    });
    window.__GZ_STATUS_BAR__.beginLiveStatus({
      key: 'simulation-starting',
      message: '第二次仿真',
      source: '仿真控制',
      time: '12:45:02',
      timestamp: 2000
    });

    const runRows = Array.from(document.querySelectorAll('[data-log-entry]')).filter((row) => (
      row.textContent.includes('第一次仿真') || row.textContent.includes('第二次仿真')
    ));
    expect(runRows).toHaveLength(2);
    expect(runRows[0].textContent).toContain('第二次仿真');
    expect(runRows[0].textContent).toContain('12:45:02');
    expect(runRows[1].textContent).toContain('第一次仿真');
    expect(runRows[1].textContent).toContain('12:39:55');
    expect(document.querySelectorAll('[data-status-live-row]')).toHaveLength(1);
    expect(document.querySelectorAll('#stxt')).toHaveLength(1);

    wrapper.unmount();
  });

  it('formats status-bar simulation time using the duration unit', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.__GZ_STATUS_BAR__.publishSimulationSummary({
      datasetName: 'millisecond-run',
      duration: 0.25,
      elapsedSeconds: 0.0042,
      stepSize: 0.0001,
      timeUnit: 'ms',
      status: 'running',
      stepIndex: 42
    });
    await flushRuntime();

    expect(document.querySelector('[data-log-entry][data-view="results"]')?.textContent).toContain('250ms');
    expect(document.querySelector('[data-log-entry][data-view="performance"]')?.textContent).toContain('elapsed 4.2ms');
    expect(document.querySelector('[data-log-entry][data-view="performance"]')?.textContent).toContain('step 0.1ms');

    wrapper.unmount();
  });

  it('supports undo and redo for canvas model editing commands', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(typeof window.__GZ_CANVAS_COMMANDS__?.undo).toBe('function');
    expect(typeof window.undoCanvasCommand).toBe('function');
    expect(document.querySelector('[data-canvas-command="undo"]')?.disabled).toBe(true);

    window.doCreateBlankWorkspace();
    await flushRuntime();
    window.createNode('signal_source', 300, 240);
    await flushRuntime();

    expect(window.__GZ_STATE__.modelNodes).toHaveLength(1);
    expect(window.__GZ_CANVAS_COMMANDS__.canUndo()).toBe(true);
    expect(document.querySelector('[data-canvas-command="undo"]')?.disabled).toBe(false);

    const undoResult = window.undoCanvasCommand();
    await flushRuntime();
    expect(undoResult.ok).toBe(true);
    expect(window.__GZ_STATE__.modelNodes).toHaveLength(0);
    expect(window.__GZ_CANVAS_COMMANDS__.canRedo()).toBe(true);
    expect(document.querySelector('[data-canvas-command="redo"]')?.disabled).toBe(false);

    const redoResult = window.redoCanvasCommand();
    await flushRuntime();
    expect(redoResult.ok).toBe(true);
    expect(window.__GZ_STATE__.modelNodes).toHaveLength(1);
    expect(window.__GZ_STATUS_BAR__.exportLog().content).toContain('撤销');

    wrapper.unmount();
  });

  it('wires canvas toolbar view, interaction, zoom, and fullscreen controls to runtime state', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const canvasWrap = document.getElementById('cw');
    const panButton = document.querySelector('[data-canvas-command="pan"]');
    const dataflowTab = document.querySelector('[data-canvas-view="dataflow"]');
    const zoomInButton = document.querySelector('[data-canvas-command="zoom-in"]');
    const fullscreenButton = document.querySelector('[data-canvas-command="fullscreen"]');

    expect(typeof window.setCanvasInteractionMode).toBe('function');
    expect(typeof window.setCanvasView).toBe('function');
    expect(typeof window.toggleCanvasFullscreen).toBe('function');
    expect(panButton).not.toBeNull();
    expect(dataflowTab).not.toBeNull();

    panButton.click();
    await flushRuntime();
    expect(canvasWrap?.dataset.interactionMode).toBe('pan');
    expect(panButton.classList.contains('is-active')).toBe(true);

    dataflowTab.click();
    await flushRuntime();
    expect(canvasWrap?.dataset.view).toBe('dataflow');
    expect(dataflowTab.classList.contains('is-active')).toBe(true);

    const beforeZoom = window.__GZ_STATE__.canvasScale;
    zoomInButton.click();
    await flushRuntime();
    expect(window.__GZ_STATE__.canvasScale).toBeGreaterThan(beforeZoom);
    expect(document.getElementById('canvas-toolbar-zoom')?.textContent).toContain('%');

    fullscreenButton.click();
    await flushRuntime();
    expect(canvasWrap?.dataset.fullscreen).toBe('true');
    expect(fullscreenButton.classList.contains('is-active')).toBe(true);

    expect(window.__GZ_CANVAS_COMMANDS__.syncFullscreen().ok).toBe(true);
    await flushRuntime();
    expect(canvasWrap?.dataset.fullscreen).toBe('false');
    expect(fullscreenButton.classList.contains('is-active')).toBe(false);

    wrapper.unmount();
  });



  it('builds measurement points and D matrix rows only from configured workspace test points', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 220, 220);
    const controller = window.createNode('simulation_block', 460, 220);
    const scope = window.createNode('instrument_scope', 700, 220);
    source.props.name = '手动输入';
    controller.props.name = '手动控制器';
    scope.props.name = '手动示波器';

    const state = window.__GZ_STATE__;
    state.modelEdges.push(
      {
        id: 'edge-manual-command',
        lineType: 'normal',
        sourceNodeId: source.id,
        targetNodeId: controller.id,
        sourcePortIndex: 0,
        targetPortIndex: 0,
        signalId: 'manual.command',
        sourcePort: { displayName: '指令输出', type: 'scalar' },
        targetPort: { displayName: '控制输入', type: 'scalar' }
      },
      {
        id: 'edge-manual-output',
        lineType: 'normal',
        sourceNodeId: controller.id,
        targetNodeId: scope.id,
        sourcePortIndex: 0,
        targetPortIndex: 0,
        signalId: 'manual.output',
        sourcePort: { displayName: '控制输出', type: 'scalar' },
        targetPort: { displayName: 'CH1', type: 'scalar' },
        injectedFault: {
          id: 'manual-output-bias',
          faultId: 'manual-output-bias',
          name: '手动输出偏差',
          layer: 'electrical',
          category: '手动故障',
          targetEdgeId: 'edge-manual-output',
          affectedEdges: ['edge-manual-output']
        }
      }
    );
    window.renderEdges();
    await flushRuntime();

    const automaticTestPointModel = window.buildDiagnosticTestPointModel();
    expect(automaticTestPointModel.positions).toEqual([]);

    state.manualDiagnosticTestPoints = [
      {
        pointId: 'tp-manual-output-detects',
        shortName: 'M1',
        name: 'Manual output measurement',
        edgeId: 'edge-manual-output',
        detects: ['manual-output-bias']
      },
      {
        pointId: 'tp-manual-output-observer',
        shortName: 'M2',
        name: 'Manual output observer',
        edgeId: 'edge-manual-output',
        detects: []
      }
    ];
    state.diagnosticModel = {
      dMatrix: {
        rows: [
          {
            faultId: 'manual-output-bias',
            points: {
              'tp-manual-output-observer': true
            }
          }
        ]
      }
    };

    const testPointModel = window.buildDiagnosticTestPointModel();
    const outputPoints = testPointModel.positions.filter((point) => point.edgeId === 'edge-manual-output');
    const outputPoint = outputPoints.find((point) => point.name === 'Manual output measurement');
    const observerOnlyPoint = outputPoints.find((point) => point.name === 'Manual output observer');
    expect(outputPoint).toBeTruthy();
    expect(observerOnlyPoint).toBeTruthy();
    expect(outputPoint.detects).toEqual(['manual-output-bias']);
    expect(observerOnlyPoint.detects).toEqual([]);
    expect(window.installDiagnosticTestPoint(outputPoint.pointId)).toBe(true);
    expect(window.installDiagnosticTestPoint(observerOnlyPoint.pointId)).toBe(true);
    expect(window.buildDiagnosticTestPointModel().installed.map((point) => point.edgeId)).toEqual([
      'edge-manual-output',
      'edge-manual-output'
    ]);

    window.setCanvasView('dataflow');
    await flushRuntime();
    const dataflowPanel = document.getElementById('dataflow-panel');
    expect(dataflowPanel?.querySelector(`[data-installed-testpoint="${outputPoint.pointId}"]`)).not.toBeNull();

    const matrix = window.buildDetectionMatrixModel();
    expect(matrix.points.map((point) => point.edgeId)).toEqual([
      'edge-manual-output',
      'edge-manual-output'
    ]);
    expect(matrix.rows.some((row) => row.faultId === 'manual-output-bias')).toBe(true);
    expect(matrix.rows.some((row) => row.faultId === 'sensor_bias_imu_pitch')).toBe(false);

    const manualRow = matrix.rows.find((row) => row.faultId === 'manual-output-bias');
    expect(manualRow.cells.find((cell) => cell.pointId === outputPoint.pointId)?.detectable).toBe(true);
    expect(manualRow.cells.find((cell) => cell.pointId === observerOnlyPoint.pointId)?.detectable).toBe(false);
    expect(manualRow.cells.some((cell) => cell.edgeId === 'edge-manual-command')).toBe(false);

    window.setCanvasView('dmatrix');
    await flushRuntime();
    expect(document.getElementById('d-matrix-panel')?.textContent).toContain('manual-output-bias');

    vi.stubGlobal('fetch', async (url, request) => {
      expect(url).toBe('/api/troubleshooting/plan');
      expect(JSON.parse(request.body)).toMatchObject({ targetFaultId: 'manual-output-bias' });
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          plan: {
            ok: true,
            faultId: 'manual-output-bias',
            faultName: 'Manual output bias',
            targetLabel: 'Manual output',
            layer: 'electrical',
            source: 'backend-algorithm',
            steps: [{
              index: 1,
              pointId: outputPoint.pointId,
              pointCode: 'M1',
              pointName: 'Manual output measurement',
              expected: 'backend checks the output',
              remainingFaultIds: ['manual-output-bias'],
              remainingFaultNames: ['Manual output bias']
            }],
            keySteps: [
              { id: 'confirm-target', text: 'Backend confirms the fault target.' },
              { id: 'confirm-result', text: 'Backend confirms the result.' }
            ],
            summary: 'Backend-generated plan.'
          }
        })
      };
    });
    const pathPanel = window.openTroubleshootingPathPanel('manual-output-bias');
    await flushRuntime();
    const algorithmPath = window.buildTroubleshootingPathForFault('manual-output-bias');
    expect(algorithmPath).toMatchObject({ ok: true, source: 'backend-algorithm', isCustomized: false });
    expect(algorithmPath.keySteps[0].text).toBe('Backend confirms the fault target.');
    pathPanel?.querySelector('[data-edit-troubleshooting-path]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();

    const pathExpected = pathPanel?.querySelector('[data-troubleshooting-path-expected]');
    pathExpected.value = 'Manual output check.';
    pathExpected.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    const keyStep = pathPanel?.querySelector('[data-troubleshooting-key-step]');
    keyStep.value = 'Manual output link confirmation.';
    keyStep.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();
    expect(window.buildTroubleshootingPathForFault('manual-output-bias')).toMatchObject({
      source: 'custom',
      isCustomized: true
    });
    expect(window.buildTroubleshootingPathForFault('manual-output-bias').steps[0].expected).toBe('Manual output check.');
    expect(window.buildTroubleshootingPathForFault('manual-output-bias').keySteps[0].text).toBe('Manual output link confirmation.');

    pathPanel?.querySelector('[data-reset-troubleshooting-path]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();
    expect(window.buildTroubleshootingPathForFault('manual-output-bias')).toMatchObject({
      source: 'backend-algorithm',
      isCustomized: false
    });

    wrapper.unmount();
  });

  it('clears manually added edge test points when creating a blank workspace', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    window.__GZ_STATE__.manualDiagnosticTestPoints = [{
      pointId: 'tp-previous-model-edge',
      edgeId: 'edge-previous-model',
      name: 'Previous model measurement point'
    }];

    window.doCreateBlankWorkspace();

    expect(window.__GZ_STATE__.manualDiagnosticTestPoints).toEqual([]);
    wrapper.unmount();
  });

  it('removes an injected runtime fault row from the D matrix when the fault is cancelled', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 220, 220);
    const controller = window.createNode('simulation_block', 460, 220);
    const scope = window.createNode('instrument_scope', 700, 220);
    const state = window.__GZ_STATE__;
    state.modelEdges.push(
      {
        id: 'edge-command-input',
        lineType: 'normal',
        sourceNodeId: source.id,
        targetNodeId: controller.id,
        sourcePortIndex: 0,
        targetPortIndex: 0,
        signalId: 'manual.command'
      },
      {
        id: 'edge-controller-output',
        lineType: 'normal',
        sourceNodeId: controller.id,
        targetNodeId: scope.id,
        sourcePortIndex: 0,
        targetPortIndex: 0,
        signalId: 'manual.output',
        injectedFault: {
          id: 'runtime-output-bias',
          modelId: 'runtime-output-bias',
          name: 'Runtime Output Bias',
          layer: 'electrical',
          targetEdgeId: 'edge-controller-output',
          affectedEdges: ['edge-controller-output']
        },
        faultBindings: [
          {
            bindingId: 'binding-runtime-output-bias',
            faultModelId: 'runtime-output-bias',
            name: 'Runtime Output Bias',
            layer: 'electrical',
            active: true
          }
        ]
      }
    );
    state.faultInstances = [
      {
        instanceId: 'fault-inst-runtime-output-bias',
        faultTypeId: 'runtime-output-bias',
        targetKind: 'edge',
        targetId: 'edge-controller-output',
        targetEdgeId: 'edge-controller-output',
        active: true,
        affectedEdges: ['edge-controller-output']
      }
    ];
    window.renderEdges();
    await flushRuntime();

    const addResult = window.addDiagnosticTestPointFromEdge('edge-controller-output');
    expect(addResult).toMatchObject({ ok: true, point: { pointType: 'virtual' } });
    expect(window.installDiagnosticTestPoint(addResult.point.pointId)).toBe(true);

    window.setCanvasView('dmatrix');
    await flushRuntime();
    const matrixBeforeRemove = window.buildDetectionMatrixModel();
    expect(matrixBeforeRemove.rows.map((row) => `${row.faultId} ${row.faultName}`).join('\n')).toContain('runtime-output-bias');
    expect(document.getElementById('d-matrix-panel')?.textContent).toContain('runtime-output-bias');

    expect(window.removeFaultBinding('edge', 'edge-controller-output', 'binding-runtime-output-bias')).toBe(true);
    await flushRuntime();

    const matrixAfterRemove = window.buildDetectionMatrixModel();
    expect(matrixAfterRemove.rows.map((row) => `${row.faultId} ${row.faultName}`).join('\n')).not.toContain('runtime-output-bias');
    expect(document.getElementById('d-matrix-panel')?.textContent).not.toContain('runtime-output-bias');

    wrapper.unmount();
  });


  it('does not automatically list dataflow edges as fixed diagnostic test points', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 220, 220);
    const sensor = window.createNode('airspeed_sensor', 460, 220);

    window.__GZ_STATE__.modelEdges.push({
      id: 'edge-airspeed-output',
      lineType: 'normal',
      sourceNodeId: source.id,
      targetNodeId: sensor.id,
      sourcePortIndex: 0,
      targetPortIndex: 0,
      signalId: 'airspeed.true',
      sourcePort: { displayName: '真实空速', type: 'scalar' },
      targetPort: { displayName: '真实空速', type: 'scalar' }
    });
    window.renderEdges();
    window.setCanvasView('dataflow');
    await flushRuntime();

    const panel = document.getElementById('dataflow-panel');
    const search = panel?.querySelector('[data-testpoint-search]');

    expect(search).not.toBeNull();
    expect(panel?.querySelector('[data-testpoint-edge-select]')).toBeNull();
    expect(panel?.querySelector('[data-add-testpoint-from-edge]')).toBeNull();

    const model = window.buildDiagnosticTestPointModel();
    expect(model.positions).toEqual([]);
    expect(model.installed).toHaveLength(0);
    expect(document.getElementById('dataflow-panel')?.querySelector('[data-fixed-testpoint-position]')).toBeNull();

    wrapper.unmount();
  });

  it('selects and installs a fixed diagnostic test point from dataflow header actions', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 220, 220);
    const sensor = window.createNode('airspeed_sensor', 460, 220);

    window.__GZ_STATE__.modelEdges.push({
      id: 'edge-delete-testpoint',
      lineType: 'normal',
      sourceNodeId: source.id,
      targetNodeId: sensor.id,
      sourcePortIndex: 0,
      targetPortIndex: 0,
      signalId: 'airspeed.delete',
      sourcePort: { displayName: '真实空速', type: 'scalar' },
      targetPort: { displayName: '真实空速', type: 'scalar' }
    });
    window.renderEdges();
    window.addDiagnosticTestPointFromEdge('edge-delete-testpoint');
    window.setCanvasView('dataflow');
    await flushRuntime();

    let model = window.buildDiagnosticTestPointModel();
    const point = model.positions.find((item) => item.edgeId === 'edge-delete-testpoint');
    expect(point).toBeTruthy();
    const pointCard = document.querySelector(`[data-fixed-testpoint-position="${point.pointId}"]`);
    expect(pointCard).not.toBeNull();
    expect(pointCard.querySelector('[data-delete-fixed-testpoint]')).toBeNull();
    const fixedPanel = document.querySelector('.tp-console-panel--points');
    const detectPanel = document.querySelectorAll('.tp-console-panel')[1];
    expect(fixedPanel?.querySelector('[data-install-testpoint]')?.textContent).toContain('启用测点');
    expect(fixedPanel?.querySelector('[data-install-all-testpoints]')?.textContent).toContain('全部启用');
    expect(detectPanel?.querySelector('[data-clear-testpoints]')?.textContent).toContain('全部移除');
    expect(detectPanel?.textContent).toContain('先从左侧启用测点。');
    expect(detectPanel?.textContent).not.toContain('先从左侧安装测点。');

    pointCard.click();
    await flushRuntime();

    expect(window.__GZ_STATE__.selectedDiagnosticTestPointId).toBe(point.pointId);
    expect(window.buildDiagnosticTestPointModel().installed).toHaveLength(0);

    const installButton = document.querySelector('[data-install-testpoint]');
    expect(installButton).not.toBeNull();
    installButton.click();
    await flushRuntime();

    model = window.buildDiagnosticTestPointModel();
    expect(model.installed.some((item) => item.pointId === point.pointId)).toBe(true);
    expect(document.querySelector('[data-delete-fixed-testpoint]')).toBeNull();
    expect(document.querySelector(`[data-fixed-testpoint-position="${point.pointId}"]`)).not.toBeNull();

    wrapper.unmount();
  });



  it('uses diagnostic point targetId as the canvas edge binding', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol-small-flight-control-fault-display.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    window.setCanvasView('canvas');
    await flushRuntime();

    window.__GZ_STATE__.diagnosticTestPoints = [{
      pointId: 'M4',
      id: 'M4',
      name: '电压限幅测点',
      targetId: 'edge-voltage-actuator',
      pointType: 'virtual'
    }];

    const point = window.buildDiagnosticTestPointModel().positions.find((item) => item.pointId === 'M4');
    expect(point).toMatchObject({
      pointId: 'M4',
      edgeId: 'edge-voltage-actuator'
    });
    window.__GZ_STATE__.installedDiagnosticTestPointIds = ['M4'];
    window.setCanvasView('dataflow');
    await flushRuntime();
    window.renderCanvasDiagnosticTestPointMarkers();
    expect(document.querySelector('[data-canvas-testpoint-marker][data-testpoint-id="M4"]')).toBeNull();

    window.setCanvasView('canvas');
    await flushRuntime();

    document.querySelector('[data-toggle-canvas-testpoints]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    await flushRuntime();

    const marker = document.querySelector('[data-canvas-testpoint-marker][data-testpoint-id="M4"]');
    expect(marker?.getAttribute('data-edge-id')).toBe('edge-voltage-actuator');

    wrapper.unmount();
  });

  it('shows newly added physical targetId test points in the simulation view', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol-small-flight-control-fault-display.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    window.__GZ_STATE__.diagnosticTestPoints = [{
      pointId: 'tp-voltage-physical',
      id: 'tp-voltage-physical',
      shortName: 'P1',
      name: '电压限幅物理测点',
      targetId: 'edge-voltage-actuator',
      pointType: 'physical'
    }];
    window.__GZ_SIM__.componentOutputs = { time: [], steps: [] };

    window.setCanvasView('components');
    await flushRuntime();

    const panel = document.getElementById('simulation-panel');
    const select = panel?.querySelector('[data-simulation-testpoint-select]');
    select.value = 'tp-voltage-physical';
    panel?.querySelector('[data-add-simulation-testpoint]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();

    expect(panel?.querySelector('.simulation-panel__empty')).toBeNull();
    const card = document.querySelector('[data-simulation-testpoint="tp-voltage-physical"]');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.simulation-point-card__main small')).toBeNull();

    wrapper.unmount();
  });

  it('does not show installed diagnostic points in the simulation view until selected there', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol-small-flight-control-fault-display.json');
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
    await flushRuntime();

    window.__GZ_STATE__.diagnosticTestPoints = [{
      pointId: 'tp-installed-only',
      id: 'tp-installed-only',
      shortName: 'I1',
      name: '已安装但未展示测点',
      targetId: 'edge-voltage-actuator',
      pointType: 'physical'
    }];
    expect(window.addDiagnosticTestPoint('tp-installed-only')).toBe(true);
    window.__GZ_SIM__.componentOutputs = { time: [], steps: [] };

    window.setCanvasView('components');
    await flushRuntime();

    const panel = document.getElementById('simulation-panel');
    expect(panel?.querySelector('[data-simulation-testpoint="tp-installed-only"]')).toBeNull();
    expect(panel?.querySelector('.simulation-panel__empty')).not.toBeNull();

    wrapper.unmount();
  });

  it('can bulk show physical and virtual test points and remove custom selections in the simulation view', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol-small-flight-control-fault-display.json');
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
    await flushRuntime();

    window.__GZ_STATE__.diagnosticTestPoints = [
      {
        pointId: 'tp-physical-sim',
        id: 'tp-physical-sim',
        shortName: 'P1',
        name: '物理仿真测点',
        targetId: 'edge-voltage-actuator',
        pointType: 'physical'
      },
      {
        pointId: 'tp-virtual-sim',
        id: 'tp-virtual-sim',
        shortName: 'V1',
        name: '虚拟仿真测点',
        targetId: 'edge-pid-allocation',
        pointType: 'virtual'
      }
    ];
    window.__GZ_SIM__.componentOutputs = { time: [], steps: [] };

    window.setCanvasView('components');
    await flushRuntime();

    const panel = document.getElementById('simulation-panel');
    expect(panel?.textContent).toContain('测点仿真数据');
    expect(panel?.textContent).not.toContain('物理测点仿真数据');

    panel?.querySelector('[data-simulation-show-physical]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();
    expect(document.querySelector('[data-simulation-testpoint="tp-physical-sim"]')).not.toBeNull();
    expect(document.querySelector('[data-simulation-testpoint="tp-virtual-sim"]')).toBeNull();

    document.querySelector('[data-simulation-show-virtual]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();
    expect(document.querySelector('[data-simulation-testpoint="tp-physical-sim"]')).toBeNull();
    expect(document.querySelector('[data-simulation-testpoint="tp-virtual-sim"]')).not.toBeNull();

    document.querySelector('[data-remove-simulation-testpoint="tp-virtual-sim"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();
    expect(document.querySelector('[data-simulation-testpoint="tp-virtual-sim"]')).toBeNull();

    const select = document.querySelector('[data-simulation-testpoint-select]');
    select.value = 'tp-physical-sim';
    document.querySelector('[data-add-simulation-testpoint]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRuntime();
    expect(document.querySelector('[data-simulation-testpoint="tp-physical-sim"]')).not.toBeNull();

    wrapper.unmount();
  });

  it('describes virtual test points as diagnostic rules in D-matrix troubleshooting paths', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol-small-flight-control-fault-display.json');
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
    await flushRuntime();

    const faultId = 'fault-virtual-observability';
    window.__GZ_STATE__.importedFaultModels = [{
      id: faultId,
      name: '虚拟测点可观测性故障',
      layer: 'physical'
    }];
    window.__GZ_STATE__.diagnosticTestPoints = [{
      pointId: 'tp-virtual-dmatrix',
      id: 'tp-virtual-dmatrix',
      shortName: 'V1',
      name: '虚拟诊断测点',
      edgeId: 'edge-voltage-actuator',
      pointType: 'virtual',
      detects: [faultId]
    }];
    window.__GZ_STATE__.installedDiagnosticTestPointIds = ['tp-virtual-dmatrix'];

    const matrix = window.buildDetectionMatrixModel();
    const cell = matrix.rows.find((row) => row.faultId === faultId)?.cells[0];

    expect(cell).toMatchObject({ detectable: true });
    expect(cell.reason).toContain('虚拟测点');
    expect(cell.reason).not.toContain('直接配置为可观测');

    wrapper.unmount();
  });

  it('uses a virtual test point\'s saved detectable faults over stale imported D-matrix cells', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol-small-flight-control-fault-display.json');
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
    await flushRuntime();

    const faultId = 'fault-virtual-config-sync';
    window.__GZ_STATE__.importedFaultModels = [{
      id: faultId,
      name: 'Virtual point configured fault',
      layer: 'physical'
    }];
    window.__GZ_STATE__.diagnosticTestPoints = [{
      pointId: 'tp-virtual-config-sync',
      id: 'tp-virtual-config-sync',
      shortName: 'V1',
      name: 'Virtual configured point',
      edgeId: 'edge-voltage-actuator',
      pointType: 'virtual',
      detects: [faultId]
    }];
    window.__GZ_STATE__.installedDiagnosticTestPointIds = ['tp-virtual-config-sync'];
    window.__GZ_STATE__.diagnosticModel = {
      dMatrix: {
        rows: [{
          faultId,
          points: { 'tp-virtual-config-sync': false }
        }]
      }
    };

    const matrix = window.buildDetectionMatrixModel();
    const cell = matrix.rows
      .find((row) => row.faultId === faultId)
      ?.cells.find((entry) => entry.pointId === 'tp-virtual-config-sync');

    expect(cell).toMatchObject({ detectable: true });
    expect(cell.reason).toContain('虚拟测点根据配置的诊断规则');

    wrapper.unmount();
  });

  it('does not infer an unconfigured virtual point as detectable from fault propagation', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol-small-flight-control-fault-display.json');
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
    await flushRuntime();

    const faultId = 'layered-node-25-node-control-allocation-physical-allocation_gain';
    const pointId = 'tp-edge-six-dof-attitude-sensor-1';
    window.__GZ_STATE__.installedDiagnosticTestPointIds = [pointId];

    const matrix = window.buildDetectionMatrixModel();
    const cell = matrix.rows
      .find((row) => row.faultId === faultId)
      ?.cells.find((entry) => entry.pointId === pointId);

    expect(cell).toMatchObject({ detectable: false });
    expect(cell.reason).toContain('虚拟测点未配置为可观测');

    wrapper.unmount();
  });

  it('allows the canvas to zoom out to 30 percent', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(typeof window.handleCanvasZoomOut).toBe('function');

    for (let index = 0; index < 10; index += 1) {
      window.handleCanvasZoomOut();
    }
    await flushRuntime();

    expect(window.__GZ_STATE__.canvasScale).toBeCloseTo(0.3, 5);
    expect(document.getElementById('canvas-toolbar-zoom')?.textContent).toContain('30%');

    wrapper.unmount();
  });

  it('prevents native node text selection while keeping clicked nodes draggable', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    window.createNode('signal_source', 260, 240);
    await flushRuntime();

    let nodeEl = document.querySelector('.blk.b-source');
    const nodeId = nodeEl?.id.replace(/^b-/, '');
    expect(nodeEl).not.toBeNull();

    nodeEl?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushRuntime();

    nodeEl = document.getElementById(`b-${nodeId}`);
    const node = window.__GZ_STATE__.modelNodes.find((item) => item.id === nodeId);
    const before = { x: node.x, y: node.y };
    const downEvent = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 260,
      clientY: 240
    });
    Object.defineProperty(downEvent, 'pointerId', { value: 77 });

    nodeEl.dispatchEvent(downEvent);
    dispatchPointer(document.getElementById('canvas-viewport'), 'pointermove', {
      pointerId: 77,
      clientX: 306,
      clientY: 270
    });
    dispatchPointer(document.getElementById('canvas-viewport'), 'pointerup', {
      pointerId: 77,
      clientX: 306,
      clientY: 270
    });
    await flushRuntime();

    expect(downEvent.defaultPrevented).toBe(false);
    expect(node.x).toBeGreaterThan(before.x);
    expect(node.y).toBeGreaterThan(before.y);
    expect(window.getSelection?.().toString()).toBe('');

    const css = `${readComponentsCss()}\n${readIbmWorkbenchCss()}`;
    const viewportRules = css.match(/\.canvas-viewport[^{]*\{[\s\S]*?\}/g) || [];
    const edgeLabelRules = css.match(/\.edge-label[^{]*\{[\s\S]*?\}/g) || [];
    expect(viewportRules.some((rule) => /user-select\s*:\s*none/.test(rule))).toBe(true);
    expect(edgeLabelRules.some((rule) => /user-select\s*:\s*none/.test(rule))).toBe(true);

    wrapper.unmount();
  });





















  it('renders digital signal test points as discrete state timelines in the simulation view', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('signal_source', 160, 260);
    window.createNode('instrument_scope', 420, 260);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const digital = state.modelNodes.find((node) => node.type === 'signal_source');
    const scope = state.modelNodes.find((node) => node.type === 'instrument_scope');
    expect(digital).toBeTruthy();
    expect(scope).toBeTruthy();
    digital.props = {
      ...digital.props,
      name: '数字信号源',
      signalDomain: 'digital',
      digitalMode: 'boolean',
      lowLevel: '0',
      highLevel: '1',
      initialState: '0'
    };
    state.modelEdges.push({
      id: 'edge-digital-scope',
      sourceNodeId: digital.id,
      sourcePortIndex: 0,
      targetNodeId: scope.id,
      targetPortIndex: 0,
      lineType: 'normal',
      label: '数字输入'
    });
    state.diagnosticTestPoints = [{
      pointId: 'tp-digital',
      id: 'tp-digital',
      shortName: 'D1',
      name: '数字输入测点',
      edgeId: 'edge-digital-scope',
      pointType: 'physical'
    }];
    state.simulationTestPointIds = ['tp-digital'];
    window.__GZ_SIM__.componentOutputs = {
      time: [0, 1, 2, 3],
      steps: [
        {
          time: 0,
          actual: { [digital.id]: { output: 0 } },
          reference: { [digital.id]: { output: 0 } }
        },
        {
          time: 1,
          actual: { [digital.id]: { output: 0 } },
          reference: { [digital.id]: { output: 0 } }
        },
        {
          time: 2,
          actual: { [digital.id]: { output: 1 } },
          reference: { [digital.id]: { output: 0 } }
        },
        {
          time: 3,
          actual: { [digital.id]: { output: 1 } },
          reference: { [digital.id]: { output: 1 } }
        }
      ]
    };

    window.setCanvasView('components');
    await flushRuntime();

    const card = document.querySelector('[data-simulation-testpoint="tp-digital"]');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.simulation-point-card__main small')).toBeNull();
    expect(card?.textContent).toContain('当前挡位');
    expect(card?.textContent).toContain('高电平');
    expect(card?.textContent).toContain('最近变更');
    expect(card?.querySelector('[data-digital-simulation-chart="tp-digital"]')).not.toBeNull();
    expect(card?.querySelector('[data-simulation-chart="tp-digital"]')).toBeNull();
    expect(card?.querySelector('[data-digital-step-series="actual"]')?.getAttribute('points')).toMatch(/\d+,\d+ \d+,\d+/);
    expect(card?.querySelectorAll('[data-digital-transition]')).toHaveLength(2);
    expect(card?.textContent).toContain('低电平');

    const controlPanel = document.querySelector('[data-simulation-control-panel]');
    const sourceControl = controlPanel?.querySelector(`[data-simulation-digital-source="${digital.id}"]`);
    expect(controlPanel?.textContent).toContain('控制面板');
    expect(controlPanel?.closest('.simulation-view__sidebar')).not.toBeNull();
    expect(sourceControl?.textContent).toContain('当前取值');
    const outputSlider = sourceControl?.querySelector('[data-simulation-digital-slider]');
    outputSlider.value = '1';
    outputSlider.dispatchEvent(new Event('input', { bubbles: true }));
    await flushRuntime();
    expect(digital.props.initialState).toBe('1');
    expect(window.__GZ_SIM__.signalSourceOutputs[digital.id]?.value).toBe('1');
    expect(document.querySelector(`[data-simulation-digital-value="${digital.id}"]`)?.value).toBe('1');

    wrapper.unmount();
  });

  it('maps enum digital output indexes to the matching added gear in the simulation view', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.createNode('signal_source', 160, 260);
    window.createNode('instrument_scope', 420, 260);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const digital = state.modelNodes.find((node) => node.type === 'signal_source');
    const scope = state.modelNodes.find((node) => node.type === 'instrument_scope');
    digital.props = {
      ...digital.props,
      signalDomain: 'digital',
      digitalMode: 'enum',
      enumValues: 'idle,armed,fault',
      initialState: 'fault'
    };
    state.modelEdges.push({
      id: 'edge-enum-digital-scope',
      sourceNodeId: digital.id,
      sourcePortIndex: 0,
      targetNodeId: scope.id,
      targetPortIndex: 0,
      lineType: 'normal',
      label: '枚举数字输入'
    });
    state.diagnosticTestPoints = [{
      pointId: 'tp-enum-digital',
      id: 'tp-enum-digital',
      shortName: 'D2',
      name: '枚举数字输入测点',
      edgeId: 'edge-enum-digital-scope',
      pointType: 'physical'
    }];
    state.simulationTestPointIds = ['tp-enum-digital'];
    window.__GZ_SIM__.componentOutputs = {
      time: [0, 1],
      steps: [
        {
          time: 0,
          actual: { [digital.id]: { output: 0 } },
          reference: { [digital.id]: { output: 0 } }
        },
        {
          time: 1,
          actual: { [digital.id]: { output: 2 } },
          reference: { [digital.id]: { output: 0 } }
        }
      ]
    };

    window.setCanvasView('components');
    await flushRuntime();

    const card = document.querySelector('[data-simulation-testpoint="tp-enum-digital"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('fault');
    expect(card?.textContent).toContain('当前挡位3');
    expect(card?.textContent).not.toContain('当前取值idle');

    wrapper.unmount();
  });
















  it('keeps the testpoint diagnosis view Carbon styled and responsive', () => {
    const componentsCss = readComponentsCss();
    const compactCss = componentsCss.replace(/\s+/g, '');
    const panelRule = findCssRule(componentsCss, '.dataflow-panel');
    const workspaceRule = findCssRule(componentsCss, '.dataflow-workspace');
    const diagnosisWorkspaceRule = findCssRule(componentsCss, '.dataflow-workspace--diagnosis');
    const headerRule = findCssRule(componentsCss, '.dataflow-diagnosis-header');
    const cardRule = findCssRule(componentsCss, '.dataflow-workspace--diagnosis .testpoint-card');
    const positionRule = findCssRule(componentsCss, '.dataflow-workspace--diagnosis .testpoint-position');

    expect(panelRule).toMatch(/overflow\s*:\s*auto/);
    expect(workspaceRule).toMatch(/height\s*:\s*max\(100%,720px\)/);
    expect(diagnosisWorkspaceRule).toMatch(/background\s*:\s*#fff/);
    expect(diagnosisWorkspaceRule).toMatch(/font-family\s*:\s*"IBM Plex Sans"/);
    expect(headerRule).toMatch(/border-bottom\s*:\s*1px solid #e0e0e0/);
    expect(cardRule).toMatch(/border-radius\s*:\s*0/);
    expect(cardRule).toMatch(/background\s*:\s*#fff/);
    expect(positionRule).toMatch(/border-radius\s*:\s*0/);
    expect(compactCss).toContain('.dataflow-workspace--diagnosis.testpoint-operator-layout{grid-template-columns:minmax(320px,1fr)minmax(320px,1fr)minmax(280px,.85fr)');
    expect(compactCss).toMatch(/@media\(max-width:[^)]+\)\{[\s\S]*?\.dataflow-workspace--diagnosis\.testpoint-operator-layout\{[\s\S]*?grid-template-columns:1fr/);
  });

  it('removes the improvement guidance panel from the lower inspector area', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const guide = document.querySelector('[data-testid="improvement-guide"]');
    expect(guide).toBeNull();
    expect(document.querySelectorAll('.rpanel-guidance__item')).toHaveLength(0);

    const componentsCss = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'components.css'),
      'utf8'
    );
    expect(componentsCss).not.toContain('.rpanel-guidance');
    expect(componentsCss).not.toContain('data-testid="improvement-guide"');

    wrapper.unmount();
  });
});
