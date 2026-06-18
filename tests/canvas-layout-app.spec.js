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

    const pkg = loadPublicPackage('evtol_small_nonlinear_fault_injected.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
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

  it('runs model diagnostics and renders actionable results in the inspector', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(document.querySelector('.canvas-check__button')?.textContent).toContain('模型检查');
    expect(typeof window.runModelCheck).toBe('function');

    window.doCreateBlankWorkspace();
    window.createNode('instrument_scope', 420, 260);
    await flushRuntime();

    const diagnostics = window.runModelCheck({ silent: true });
    await flushRuntime();

    expect(diagnostics.some((item) => item.title === '测量仪器尚未接入信号')).toBe(true);
    expect(document.getElementById('pd')?.textContent).toContain('模型检查');
    expect(document.getElementById('pd')?.textContent).toContain('测量仪器尚未接入信号');
    expect(document.querySelector('.diagnostics-card__button')).not.toBeNull();
    expect(document.querySelector('.diagnostics-title')).not.toBeNull();
    expect(document.querySelector('.diagnostics-score__num')).not.toBeNull();
    expect(document.querySelector('.diagnostics-pill__value')).not.toBeNull();

    const statusEntry = Array.from(document.querySelectorAll('[data-log-entry]')).find((row) =>
      row.textContent?.includes('模型检查')
    );
    expect(statusEntry).not.toBeNull();
    expect(statusEntry?.dataset.view).toBe('alerts');

    wrapper.unmount();
  });

  it('docks simulation controls above the canvas and removes the old global taskbar', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    expect(document.querySelector('.workbench-taskbar')).toBeNull();
    expect(document.querySelector('header .header-project')).not.toBeNull();
    expect(document.querySelector('header .header-project__name')?.textContent).toContain('飞控系统仿真项目');
    expect(document.querySelector('header .header-project__state')?.textContent).toContain('已保存');
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
    expect(consoleCss).toContain('.header-project');
    expect(consoleCss).toContain('.canvas-sim-dock .simbar');
    expect(consoleCss).toContain('@media (max-width:1680px)');
    expect(consoleCss).toContain('grid-template-rows:104px minmax(0,1fr)');
    expect(consoleCss).toContain('header .toolbar .tbtn{\n  flex:0 0 auto;');
    expect(consoleCss).toContain('header .toolbar{\n    grid-column:2 / 4;');
    expect(consoleCss).toContain('@media (max-width:1120px)');
    expect(consoleCss).toContain('grid-template-rows:156px minmax(0,1fr)');
    expect(consoleCss).toContain('top:140px');
    expect(ibmCss).toContain('@media (min-width:1281px) and (max-width:1900px)');
    expect(ibmCss).toContain('@media (min-width:1121px) and (max-width:1280px)');
    expect(ibmCss).toContain('grid-template-rows:56px minmax(0,1fr)');
    expect(ibmCss).toContain('grid-template-rows:104px minmax(0,1fr)');
    expect(ibmCss).toContain('grid-column:1 / 4;');
    expect(ibmCss).toContain('minmax(520px,max-content)');
    expect(ibmCss).toContain('grid-template-rows:52px 48px');
    expect(ibmCss).toContain('top:100px');
    expect(ibmCss).toContain('top:112px');
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

  it('renders the multi-signal flow view as a single testpoint diagnosis workbench', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.setCanvasView).toBe('function');
    expect(typeof window.buildDiagnosticTestPointModel).toBe('function');

    window.setCanvasView('dataflow');
    await flushRuntime();

    const panel = document.getElementById('dataflow-panel');
    const model = window.buildDiagnosticTestPointModel();

    expect(document.getElementById('cw')?.dataset.view).toBe('dataflow');
    expect(panel?.querySelector('[data-dataflow-view="testpoint-diagnosis"]')).not.toBeNull();
    expect(panel?.querySelector('[data-testpoint-workbench]')).not.toBeNull();
    expect(panel?.querySelector('[data-testpoint-position-select]')).not.toBeNull();
    expect(panel?.querySelector('[data-install-testpoint]')).not.toBeNull();
    expect(panel?.querySelectorAll('[data-fixed-testpoint-position]').length).toBe(model.positions.length);
    expect(panel?.querySelectorAll('[data-installed-testpoint]').length).toBe(model.installed.length);
    expect(panel?.textContent).toContain('测点诊断台');
    expect(panel?.textContent).toContain('固定测点');
    expect(panel?.textContent).toContain('人工确认');

    expect(panel?.querySelector('[data-measurement-response-panel]')).toBeNull();
    expect(panel?.querySelector('[data-propagation-groups]')).toBeNull();
    expect(panel?.querySelector('.signal-chain-map')).toBeNull();
    expect(panel?.querySelector('.signal-flow-legacy')).toBeNull();
    expect(panel?.querySelector('[data-dataflow-section="signals"]')).toBeNull();
    expect(panel?.querySelectorAll('.signal-flow-node')).toHaveLength(0);

    wrapper.unmount();
  });

  it('models measurement points as fixed installable positions in the dataflow view', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.buildDiagnosticTestPointModel).toBe('function');
    expect(typeof window.installDiagnosticTestPoint).toBe('function');
    expect(typeof window.removeDiagnosticTestPoint).toBe('function');

    const semantic = window.buildDataflowSemanticModel();
    const initialModel = window.buildDiagnosticTestPointModel();
    const installablePosition = initialModel.positions.find((point) => !point.installed);

    expect(semantic.measurementPoints.length).toBeGreaterThanOrEqual(initialModel.positions.length);
    expect(initialModel.positions.length).toBeGreaterThanOrEqual(pkg.diagnosticModel.testPoints.length);
    expect(pkg.diagnosticModel.testPoints.every((point) =>
      initialModel.positions.some((position) => position.pointId === point.pointId)
    )).toBe(true);
    expect(initialModel.installed.length).toBe(0);
    expect(installablePosition).toBeTruthy();
    expect(initialModel.positions.every((point) =>
      point.pointId &&
      point.edgeId &&
      point.positionNameZh &&
      typeof point.installed === 'boolean'
    )).toBe(true);

    expect(window.installDiagnosticTestPoint(installablePosition.pointId)).toBe(true);
    const afterInstall = window.buildDiagnosticTestPointModel();
    expect(afterInstall.installed.some((point) => point.pointId === installablePosition.pointId)).toBe(true);
    expect(afterInstall.installed.length).toBe(1);

    window.setCanvasView('dataflow');
    await flushRuntime();

    const panel = document.getElementById('dataflow-panel');
    expect(panel?.querySelector('[data-testpoint-workbench]')).not.toBeNull();
    expect(panel?.querySelector('[data-testpoint-position-select]')).not.toBeNull();
    expect(panel?.querySelector('[data-install-testpoint]')).not.toBeNull();
    expect(panel?.querySelectorAll('[data-installed-testpoint]').length).toBe(afterInstall.installed.length);
    expect(panel?.querySelector(`[data-installed-testpoint="${installablePosition.pointId}"]`)).not.toBeNull();
    expect(panel?.querySelector(`[data-fixed-testpoint-position="${installablePosition.pointId}"]`)?.textContent).toContain('已启用');

    expect(window.removeDiagnosticTestPoint(installablePosition.pointId)).toBe(true);
    const afterRemove = window.buildDiagnosticTestPointModel();
    expect(afterRemove.installed.some((point) => point.pointId === installablePosition.pointId)).toBe(false);
    expect(afterRemove.installed.length).toBe(0);

    window.clearDiagnosticTestPoints();
    window.setCanvasView('dataflow');
    await flushRuntime();
    expect(window.buildDiagnosticTestPointModel().installed).toHaveLength(0);

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

    const addResult = window.addDiagnosticTestPointFromEdge('edge-manual-output', {
      name: 'Manual output measurement',
      detects: ['manual-output-bias']
    });
    expect(addResult).toMatchObject({ ok: true });

    const testPointModel = window.buildDiagnosticTestPointModel();
    const outputPoint = testPointModel.positions.find((point) => point.edgeId === 'edge-manual-output');
    expect(outputPoint).toBeTruthy();
    expect(outputPoint.detects).toEqual(['manual-output-bias']);
    expect(window.installDiagnosticTestPoint(outputPoint.pointId)).toBe(true);
    expect(window.buildDiagnosticTestPointModel().installed.map((point) => point.edgeId)).toEqual(['edge-manual-output']);

    window.setCanvasView('dataflow');
    await flushRuntime();
    const dataflowPanel = document.getElementById('dataflow-panel');
    expect(dataflowPanel?.querySelector(`[data-installed-testpoint="${outputPoint.pointId}"]`)).not.toBeNull();

    const matrix = window.buildDetectionMatrixModel();
    expect(matrix.points.map((point) => point.edgeId)).toEqual(['edge-manual-output']);
    expect(matrix.rows.some((row) => row.faultId === 'manual-output-bias')).toBe(true);
    expect(matrix.rows.some((row) => row.faultId === 'sensor_bias_imu_pitch')).toBe(false);

    const manualRow = matrix.rows.find((row) => row.faultId === 'manual-output-bias');
    expect(manualRow.cells.find((cell) => cell.edgeId === 'edge-manual-output')?.detectable).toBe(true);
    expect(manualRow.cells.some((cell) => cell.edgeId === 'edge-manual-command')).toBe(false);

    window.setCanvasView('dmatrix');
    await flushRuntime();
    expect(document.getElementById('d-matrix-panel')?.textContent).toContain('manual-output-bias');

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
    expect(addResult).toMatchObject({ ok: true });
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

  it('shows layered fault runtime behavior and target parameter in D matrix rows', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const state = window.__GZ_STATE__;
    const controller = state.modelNodes.find((node) => node.id === 'node-controller');
    const physicalInjector = window.createNode('physical_fault_injector', 420, 260);
    await flushRuntime();

    const result = window.bindLayeredFaultInjectorToTarget(physicalInjector.id, {
      targetKind: 'node',
      targetId: controller.id,
      slotId: 'physical:controller_gain',
      mathModel: 'bias',
      parameters: { bias: 0.2, start: 1, duration: 3 }
    });
    await flushRuntime();

    expect(result).toMatchObject({
      ok: true,
      bindingObject: 'controller_gain'
    });

    window.setCanvasView('dmatrix');
    await flushRuntime();

    const matrixPanel = document.getElementById('d-matrix-panel');
    const targetRow = Array.from(matrixPanel?.querySelectorAll('tbody tr') || [])
      .find((row) => row.textContent?.includes('controller_gain'));
    expect(targetRow).not.toBeNull();
    expect(targetRow?.querySelector('.d-matrix-sticky strong')?.textContent).toBe('偏差故障');
    expect(targetRow?.querySelector('.d-matrix-sticky small')?.textContent).toBe('controller_gain');

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

  it('searches configured dataflow test points after importing the closed-loop demo', async () => {
    window.__compactDiagnosisConsoleEvents = true;
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    window.setCanvasView('dataflow');
    await flushRuntime();

    const before = window.buildDiagnosticTestPointModel();
    expect(before.positions.some((point) => point.edgeId === 'edge-command-scope')).toBe(false);
    expect(before.candidateEdges.some((edge) => edge.id === 'edge-command-scope')).toBe(true);

    const panel = document.getElementById('dataflow-panel');
    const search = panel?.querySelector('[data-testpoint-search]');
    const searchButton = panel?.querySelector('[data-testpoint-search-submit]');
    expect(search).not.toBeNull();
    expect(searchButton).not.toBeNull();
    const allPointCount = document.getElementById('dataflow-panel')?.querySelectorAll('[data-fixed-testpoint-position]').length;

    ['姿', '姿态', '姿态指令'].forEach((value) => {
      search.value = value;
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushRuntime();
    expect(Array.from(document.getElementById('dataflow-panel')?.querySelectorAll('[data-fixed-testpoint-position]') || [])
      .filter((element) => !element.hidden).length)
      .toBe(allPointCount);

    searchButton.click();
    await flushRuntime();

    const after = window.buildDiagnosticTestPointModel();
    const addedPoint = after.positions.find((point) => String(point.name || '').includes('姿态指令'));
    expect(addedPoint).toBeTruthy();
    expect(document.getElementById('dataflow-panel')?.querySelector('[data-testpoint-search]')?.value)
      .toBe('姿态指令');
    expect(document.getElementById('dataflow-panel')?.querySelector(
      `[data-fixed-testpoint-position="${addedPoint.pointId}"]`
    )).not.toBeNull();
    expect(Array.from(document.getElementById('dataflow-panel')?.querySelectorAll('[data-fixed-testpoint-position]') || [])
      .filter((element) => !element.hidden).length)
      .toBe(1);
    expect(Array.from(document.getElementById('dataflow-panel')?.querySelectorAll('[data-fixed-testpoint-position]') || [])
      .filter((element) => element.style.display !== 'none').length)
      .toBe(1);

    const nameSearch = document.getElementById('dataflow-panel')?.querySelector('[data-testpoint-search]');
    const nameSearchButton = document.getElementById('dataflow-panel')?.querySelector('[data-testpoint-search-submit]');
    nameSearch.value = 'edge-command-scope';
    nameSearch.dispatchEvent(new Event('input', { bubbles: true }));
    await flushRuntime();
    expect(Array.from(document.getElementById('dataflow-panel')?.querySelectorAll('[data-fixed-testpoint-position]') || [])
      .filter((element) => !element.hidden).length)
      .toBe(1);

    nameSearchButton.click();
    await flushRuntime();

    expect(Array.from(document.getElementById('dataflow-panel')?.querySelectorAll('[data-fixed-testpoint-position]') || [])
      .filter((element) => !element.hidden).length)
      .toBe(0);
    expect(Array.from(document.getElementById('dataflow-panel')?.querySelectorAll('[data-fixed-testpoint-position]') || [])
      .filter((element) => element.style.display !== 'none').length)
      .toBe(0);
    expect(document.getElementById('dataflow-panel')?.textContent).toContain('没有匹配的测点。');

    nameSearch.value = 'M1';
    nameSearch.dispatchEvent(new Event('input', { bubbles: true }));
    nameSearchButton.click();
    await flushRuntime();

    expect(Array.from(document.getElementById('dataflow-panel')?.querySelectorAll('[data-fixed-testpoint-position]') || [])
      .filter((element) => element.style.display !== 'none').length)
      .toBe(0);

    wrapper.unmount();
  });

  it('toggles fixed diagnostic point markers from the fault view', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    window.clearDiagnosticTestPoints();
    const point = window.buildDiagnosticTestPointModel().positions[0];
    expect(point?.pointId).toBeTruthy();

    window.setCanvasView('components');
    await flushRuntime();
    window.renderCanvasDiagnosticTestPointMarkers();
    await flushRuntime();

    const toggle = document.querySelector('[data-toggle-fault-view-testpoints]');
    const positionCount = window.buildDiagnosticTestPointModel().positions.length;

    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toContain('显示测点');
    expect(document.querySelectorAll('[data-canvas-testpoint-marker]')).toHaveLength(0);

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushRuntime();

    expect(toggle?.textContent).toContain('隐藏测点');
    expect(document.querySelectorAll('[data-canvas-testpoint-marker]')).toHaveLength(positionCount);
    expect(document.querySelector(`[data-canvas-testpoint-marker][data-testpoint-id="${point.pointId}"]`)).not.toBeNull();

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushRuntime();

    expect(toggle?.textContent).toContain('显示测点');
    expect(document.querySelectorAll('[data-canvas-testpoint-marker]')).toHaveLength(0);

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

  it('detects possible fault types from an installed measurement point and records manual confirmations', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.runDiagnosticTestPointDetection).toBe('function');
    expect(typeof window.openDiagnosticTestPointDialog).toBe('function');
    expect(typeof window.toggleDiagnosticFaultConfirmation).toBe('function');

    const model = window.buildDiagnosticTestPointModel();
    const imuPoint = model.positions.find((point) => point.edgeId === 'edge-imu-error');
    expect(imuPoint).toBeTruthy();
    window.installDiagnosticTestPoint(imuPoint.pointId);

    const imuEdge = window.__GZ_STATE__.modelEdges.find((edge) => edge.id === 'edge-imu-error');
    imuEdge.injectedFault = {
      id: 'sensor_additive_bias',
      modelId: 'sensor_additive_bias',
      name: '传感器加性偏置',
      layer: 'electrical',
      runtimeBehavior: 'sensor_bias'
    };

    const diagnosis = window.runDiagnosticTestPointDetection(imuPoint.pointId);
    expect(diagnosis).toMatchObject({
      pointId: imuPoint.pointId,
      edgeId: 'edge-imu-error',
      status: 'abnormal'
    });
    expect(diagnosis.candidates.some((candidate) => candidate.faultTypeId === 'sensor_additive_bias')).toBe(true);
    expect(diagnosis.candidates.every((candidate) => typeof candidate.confirmed === 'boolean')).toBe(true);

    const scanResults = window.runAllDiagnosticTestPointDetections();
    expect(scanResults.some((result) =>
      result.pointId === imuPoint.pointId &&
      result.status === 'abnormal' &&
      result.candidates.some((candidate) => candidate.faultTypeId === 'sensor_additive_bias')
    )).toBe(true);

    window.setCanvasView('dataflow');
    await flushRuntime();

    const panel = document.getElementById('dataflow-panel');
    expect(panel?.querySelector('[data-run-fault-detection]')).not.toBeNull();
    expect(panel?.querySelector(`[data-diagnosis-point="${imuPoint.pointId}"].is-abnormal`)).not.toBeNull();

    document.querySelector(`[data-detect-testpoint="${imuPoint.pointId}"]`)?.click();
    await flushRuntime();

    const dialog = document.getElementById('ov-testpoint-diagnosis');
    expect(dialog?.classList.contains('open')).toBe(true);
    expect(dialog?.querySelectorAll('[data-fault-candidate]').length).toBeGreaterThan(0);
    expect(dialog?.querySelector('[data-fault-candidate="sensor_additive_bias"]')).not.toBeNull();

    const confirmBox = dialog?.querySelector('[data-confirm-fault-candidate="sensor_additive_bias"]');
    confirmBox.checked = true;
    confirmBox.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();

    expect(window.__GZ_STATE__.confirmedDiagnosticFaults[imuPoint.pointId]).toContain('sensor_additive_bias');
    expect(window.__GZ_STATE__.testPointDiagnosis.confirmedFaultTypeIds).toContain('sensor_additive_bias');

    wrapper.unmount();
  });

  it('removes catalog-injected faults from model targets and binding arrays', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.doImportFault).toBe('function');
    expect(typeof window.selectFaultCatalogModel).toBe('function');
    expect(typeof window.confirmImportFault).toBe('function');
    expect(typeof window.removeInjectedFault).toBe('function');

    const faultId = 'sensor_additive_bias';
    const state = window.__GZ_STATE__;
    const targetEdge = state.modelEdges.find((edge) => edge.id === 'edge-imu-error');
    expect(targetEdge).toBeTruthy();
    targetEdge.injectedFault = {
      modelId: faultId,
      name: 'sensor additive bias',
      layer: 'electrical',
      runtimeBehavior: 'sensor_bias'
    };
    targetEdge.faultBindings = [
      {
        bindingId: `${faultId}::edge-imu-error`,
        faultModelId: faultId,
        active: true,
        injectedFault: {
          modelId: faultId,
          name: 'sensor additive bias'
        }
      }
    ];
    targetEdge.status = 'fault';

    const allTargets = () => [...state.modelNodes, ...state.modelEdges, ...(state.nodes || []), ...(state.edges || [])];

    expect(allTargets().some((target) => targetHasFaultRef(target, faultId))).toBe(true);

    const removed = window.removeInjectedFault(faultId);
    await flushRuntime();

    expect(removed).toBe(true);
    expect(allTargets().some((target) => targetHasFaultRef(target, faultId))).toBe(false);
    expect(state.injectedFaultMap?.[faultId]).toBeUndefined();

    wrapper.unmount();
  });

  it('distinguishes detectable and non-detectable faults on the same component for one measurement point', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const model = window.buildDiagnosticTestPointModel();
    const imuPoint = model.positions.find((point) => point.shortName === 'M6');
    const imuNode = window.__GZ_STATE__.modelNodes.find((node) => node.id === 'node-motor-1');
    expect(imuPoint).toBeTruthy();
    expect(imuNode).toBeTruthy();

    window.installDiagnosticTestPoint(imuPoint.pointId);
    imuNode.faults = [
      {
        id: 'sensor_additive_bias',
        modelId: 'sensor_additive_bias',
        name: '传感器加性偏置',
        category: '传感器故障'
      },
      {
        id: 'motor_1_stuck_position',
        modelId: 'motor_1_stuck_position',
        name: 'IMU 自检状态异常',
        category: '本地状态故障'
      }
    ];

    const mixedDiagnosis = window.runDiagnosticTestPointDetection(imuPoint.pointId);
    expect(mixedDiagnosis.status).toBe('abnormal');
    expect(mixedDiagnosis.candidates.some((candidate) => candidate.faultTypeId === 'sensor_additive_bias')).toBe(true);
    expect(mixedDiagnosis.candidates.some((candidate) => candidate.faultTypeId === 'motor_1_stuck_position')).toBe(false);

    imuNode.faults = [
      {
        id: 'motor_1_stuck_position',
        modelId: 'motor_1_stuck_position',
        name: 'IMU 自检状态异常',
        category: '本地状态故障'
      }
    ];

    const localOnlyDiagnosis = window.runDiagnosticTestPointDetection(imuPoint.pointId);
    expect(localOnlyDiagnosis.status).toBe('normal');
    expect(localOnlyDiagnosis.candidates.some((candidate) => candidate.faultTypeId === 'motor_1_stuck_position')).toBe(false);

    wrapper.unmount();
  });

  it('keeps dataflow controls mounted while simulation steps update values', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const model = window.buildDiagnosticTestPointModel();
    window.installDiagnosticTestPoint(model.positions[0].pointId);

    window.setCanvasView('dataflow');
    await flushRuntime();

    const panel = document.getElementById('dataflow-panel');
    const workspaceBefore = panel?.querySelector('.dataflow-workspace');
    const detectButtonBefore = panel?.querySelector('[data-detect-testpoint]');
    const scanButtonBefore = panel?.querySelector('[data-run-fault-detection]');

    expect(workspaceBefore).not.toBeNull();
    expect(detectButtonBefore).not.toBeNull();
    expect(scanButtonBefore).not.toBeNull();

    window.simInit(true);
    await flushRuntime();

    expect(panel?.querySelector('.dataflow-workspace')).toBe(workspaceBefore);
    expect(panel?.querySelector('[data-detect-testpoint]')).toBe(detectButtonBefore);

    window.simStep();
    await flushRuntime();

    expect(panel?.querySelector('.dataflow-workspace')).toBe(workspaceBefore);
    expect(panel?.querySelector('[data-detect-testpoint]')).toBe(detectButtonBefore);

    wrapper.unmount();
  });

  it('builds a Chinese measurement-point semantic model for the closed-loop flight-control demo', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.buildDataflowSemanticModel).toBe('function');
    expect(typeof window.collectMeasurementPoints).toBe('function');
    expect(typeof window.classifyFaultPropagation).toBe('function');

    const semantic = window.buildDataflowSemanticModel();
    const imuPolicyEdge = semantic.edges.find((edge) => edge.id === 'edge-imu-error');
    const imuPolicyPoint = semantic.measurementPoints.find((point) => point.edgeId === 'edge-imu-error');

    expect(semantic.stages.map((stage) => stage.labelZh)).toEqual([
      '指令与参考',
      '控制与分配',
      '执行与机体',
      '测量与估计',
      '诊断与残差'
    ]);
    expect(semantic.measurementPoints.length).toBeGreaterThanOrEqual(6);
    expect(semantic.measurementPoints.some((point) => point.labelZh.includes('测点 M1'))).toBe(true);
    expect(semantic.measurementPoints.some((point) => point.signalNameZh.includes('姿态指令'))).toBe(true);
    expect(semantic.measurementPoints.some((point) => point.signalNameZh.includes('IMU'))).toBe(true);
    expect(semantic.measurementPoints.some((point) => point.role === 'residual')).toBe(true);
    expect(semantic.edges.some((edge) => edge.signalPathZh.includes('IMU') && edge.signalPathZh.includes('反馈'))).toBe(true);
    expect(semantic.edges.every((edge) => edge.mapping?.engineeringKey)).toBe(true);
    expect(semantic.edges.some((edge) => edge.mapping?.signalId === 'imu.pitch_rate')).toBe(true);
    expect(semantic.measurementPoints.every((point) =>
      point.signalId &&
      point.nodeId &&
      Number.isInteger(point.portIndex) &&
      point.stageId &&
      point.stageLabelZh
    )).toBe(true);
    expect(semantic.edges.every((edge) => Array.isArray(edge.affectedMeasurementPointIds))).toBe(true);
    expect(imuPolicyEdge?.propagationPolicyKind).toBe('propagated');
    expect(imuPolicyEdge?.propagationPolicyLabelZh).toBeTruthy();
    expect(imuPolicyEdge?.propagationKind).toBe('none');
    expect(imuPolicyPoint?.faultInfluence).toBe('none');

    expect(window.classifyFaultPropagation(null, { faultPropagationPolicy: 'propagates' })).toBe('none');
    expect(window.classifyFaultPropagation({ layer: 'sensor', runtimeBehavior: 'sensor_bias' })).toBe('propagated');
    expect(window.classifyFaultPropagation({ layer: 'physical', runtimeBehavior: 'sensor_bias', name: 'IMU bias' })).toBe('propagated');
    expect(window.classifyFaultPropagation({ layer: 'communication', runtimeBehavior: 'delay' })).toBe('propagated');
    expect(window.classifyFaultPropagation({ layer: 'protocol', runtimeBehavior: 'packet_loss' })).toBe('blocked');
    expect(window.classifyFaultPropagation({ layer: 'diagnostic', runtimeBehavior: 'residual_alarm' })).toBe('diagnosticOnly');
    expect(window.classifyFaultPropagation({ layer: 'physical', runtimeBehavior: 'parameter_bias' })).toBe('localEffect');
    expect(window.classifyFaultPropagation({ layer: 'control', runtimeBehavior: 'gain_drift' })).toBe('localEffect');
    expect(semantic.propagationClasses.propagated.labelZh).toBe('传播型');
    expect(semantic.propagationClasses.localEffect.descriptionZh).toContain('本地参数');

    wrapper.unmount();
  });

  it('builds a measurement response snapshot for a temporary link cut', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.buildMeasurementScenarioOptions).toBe('function');
    expect(typeof window.buildMeasurementTargetOptions).toBe('function');
    expect(typeof window.createMeasurementScenario).toBe('function');
    expect(typeof window.calculateMeasurementResponse).toBe('function');

    const targetEdge = window.__GZ_STATE__.modelEdges.find((edge) => edge.id === 'edge-imu-error');
    expect(targetEdge).toBeTruthy();
    expect(targetEdge.injectedFault).toBeUndefined();

    const scenario = window.createMeasurementScenario({
      type: 'link_cut',
      targetKind: 'edge',
      targetId: 'edge-imu-error',
      parameters: { time: 0 }
    });
    const response = window.calculateMeasurementResponse(scenario);
    const semantic = window.buildDataflowSemanticModel();
    const targetPoint = response.points.find((point) => point.edgeId === 'edge-imu-error');

    expect(response.mode).toBe('snapshot');
    expect(response.points.length).toBe(semantic.measurementPoints.length);
    expect(response.summary.total).toBe(semantic.measurementPoints.length);
    expect(response.summary.cut).toBeGreaterThanOrEqual(1);
    expect(response.summary.affected).toBeGreaterThanOrEqual(1);
    expect(targetPoint).toMatchObject({
      edgeId: 'edge-imu-error',
      status: 'cut',
      statusLabelZh: '链路截断',
      affectedByTarget: true
    });
    expect(targetPoint.operatedValue).toBeNull();
    expect(Array.isArray(targetPoint.samples)).toBe(true);
    expect(targetEdge.injectedFault).toBeUndefined();

    wrapper.unmount();
  });

  it('only renders installed diagnostic points on the canvas and keeps them after edge rerendering', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.addDiagnosticTestPoint).toBe('function');
    expect(typeof window.clearDiagnosticTestPoints).toBe('function');
    expect(typeof window.renderCanvasDiagnosticTestPointMarkers).toBe('function');

    window.setCanvasView?.('canvas', { silent: true });
    window.clearDiagnosticTestPoints();
    const positions = window.buildDiagnosticTestPointModel().positions;
    const point = positions[0];
    expect(point?.pointId).toBeTruthy();

    window.renderCanvasDiagnosticTestPointMarkers();
    await flushRuntime();
    expect(document.querySelectorAll('[data-canvas-testpoint-marker]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-canvas-testpoint-marker].is-uninstalled')).toHaveLength(0);

    window.addDiagnosticTestPoint(point.pointId);
    await flushRuntime();
    expect(document.querySelectorAll('[data-canvas-testpoint-marker]')).toHaveLength(1);
    expect(document.querySelector(`[data-canvas-testpoint-marker][data-testpoint-id="${point.pointId}"]`)?.classList.contains('is-installed')).toBe(true);

    window.renderEdges();
    await flushRuntime();
    expect(document.querySelectorAll('[data-canvas-testpoint-marker]')).toHaveLength(1);
    expect(document.querySelector(`[data-canvas-testpoint-marker][data-testpoint-id="${point.pointId}"]`)?.classList.contains('is-installed')).toBe(true);

    wrapper.unmount();
  });

  it('does not leak parent diagnostic points into an empty subsystem canvas', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    const rootPoint = window.buildDiagnosticTestPointModel().positions[0];
    expect(rootPoint?.pointId).toBeTruthy();
    expect(window.addDiagnosticTestPoint(rootPoint.pointId)).toBe(true);
    await flushRuntime();
    expect(document.querySelectorAll('[data-canvas-testpoint-marker]')).toHaveLength(1);

    window.createNode('subsystem_block', 1180, 260);
    await flushRuntime();
    const subsystem = window.__GZ_STATE__.modelNodes.find((node) => node.type === 'subsystem_block');
    expect(subsystem?.targetCanvasId).toBeTruthy();

    window.openSubsystemCanvas(subsystem.id);
    await flushRuntime();
    window.renderCanvasDiagnosticTestPointMarkers();
    await flushRuntime();

    expect(window.__GZ_STATE__.activeCanvasId).toBe(subsystem.targetCanvasId);
    expect(window.buildDiagnosticTestPointModel().positions).toHaveLength(0);
    expect(document.querySelectorAll('[data-canvas-testpoint-marker]')).toHaveLength(0);
    expect(window.__GZ_STATE__.installedDiagnosticTestPointIds).toContain(rootPoint.pointId);

    document.querySelector('[data-breadcrumb-root]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    await flushRuntime();
    expect(window.buildDiagnosticTestPointModel().positions.length).toBeGreaterThan(0);
    expect(document.querySelector(`[data-canvas-testpoint-marker][data-testpoint-id="${rootPoint.pointId}"]`)).not.toBeNull();

    wrapper.unmount();
  });

  it('clears diagnostic points and injected faults when the canvas is reset', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();
    expect(importResult).toMatchObject({ ok: true });

    const point = window.buildDiagnosticTestPointModel().positions[0];
    expect(point?.pointId).toBeTruthy();
    const stateBeforeReset = window.__GZ_STATE__;
    stateBeforeReset.installedDiagnosticTestPointIds = [point.pointId];
    stateBeforeReset.selectedDiagnosticTestPointId = point.pointId;
    stateBeforeReset.diagnosticScanResults = [{ pointId: point.pointId, status: 'abnormal', candidates: [{ faultTypeId: 'gyro_zero_bias_offset' }] }];
    stateBeforeReset.lastDiagnosticTestPointResult = stateBeforeReset.diagnosticScanResults[0];
    stateBeforeReset.testPointDiagnosis = stateBeforeReset.diagnosticScanResults[0];
    stateBeforeReset.confirmedDiagnosticFaults = { [point.pointId]: ['gyro_zero_bias_offset'] };
    stateBeforeReset.importedFaultModels = [{ id: 'gyro_zero_bias_offset', name: 'Gyro 零偏' }];
    stateBeforeReset.faultedBlks = ['node-command-shaper'];
    stateBeforeReset.faultTags = [{
      id: 'fault-tag-reset-test',
      faultModelId: 'gyro_zero_bias_offset',
      hostNodeId: 'node-command-shaper',
      targetId: 'node-command-shaper',
      expanded: true
    }];
    stateBeforeReset.faultInjectionLinks = [{
      id: 'fault-link-reset-test',
      faultModelId: 'gyro_zero_bias_offset',
      sourceNodeId: 'fault-tag-reset-test',
      targetNodeId: 'node-command-shaper'
    }];
    window.renderCanvasDiagnosticTestPointMarkers();
    await flushRuntime();

    expect(window.__GZ_STATE__.installedDiagnosticTestPointIds.length).toBeGreaterThan(0);
    expect(window.__GZ_STATE__.faultTags.length).toBeGreaterThan(0);
    expect(window.__GZ_STATE__.faultInjectionLinks.length).toBeGreaterThan(0);
    expect(window.__GZ_STATE__.diagnosticScanResults.length).toBeGreaterThan(0);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.doResetWorkspace();
    await flushRuntime();

    const state = window.__GZ_STATE__;
    expect(state.modelNodes).toHaveLength(0);
    expect(state.modelEdges).toHaveLength(0);
    expect(state.activeModelPackage).toBeNull();
    expect(state.installedDiagnosticTestPointIds).toEqual([]);
    expect(state.diagnosticTestPoints || []).toEqual([]);
    expect(state.diagnosticScanResults || []).toEqual([]);
    expect(state.confirmedDiagnosticFaults || {}).toEqual({});
    expect(state.faultTags || []).toEqual([]);
    expect(state.faultInjectionLinks || []).toEqual([]);
    expect(state.faultedBlks || []).toEqual([]);
    expect(state.importedFaultModels || []).toEqual([]);
    expect(document.querySelectorAll('[data-canvas-testpoint-marker]')).toHaveLength(0);
    expect(document.querySelectorAll('.fault-tag-card')).toHaveLength(0);

    wrapper.unmount();
  });

  it('keeps fault injection target lookup available without rendering redundant F markers', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.buildFaultInjectionAnnotationModel).toBe('function');
    expect(typeof window.renderCanvasDiagnosticAnnotations).toBe('function');
    expect(typeof window.locateFaultCatalogInjectionTarget).toBe('function');

    const annotations = window.buildFaultInjectionAnnotationModel();
    expect(annotations.length).toBeGreaterThan(0);
    expect(annotations.some((item) => item.targetEdgeId || item.targetNodeId)).toBe(true);
    expect(annotations.every((item) => item.targetLabel)).toBe(true);
    expect(annotations.some((item) => item.targetLabel.includes('IMU') || item.targetLabel.includes('测量'))).toBe(true);

    window.renderCanvasDiagnosticAnnotations();
    await flushRuntime();

    expect(document.querySelectorAll('[data-canvas-fault-marker]').length).toBe(0);

    const firstFault = annotations.find((item) => item.models?.length)?.models[0];
    const located = window.locateFaultCatalogInjectionTarget(firstFault.id);
    await flushRuntime();

    expect(located).toMatchObject({
      faultId: firstFault.id,
      targetId: expect.any(String),
      targetKind: expect.stringMatching(/node|edge/)
    });
    if (located.targetKind === 'edge') {
      expect(window.__GZ_STATE__.selEdge).toBe(located.targetId);
    } else {
      expect(window.__GZ_STATE__.selBlk).toBe(located.targetId);
    }

    wrapper.unmount();
  });

  it('places layered fault injector blocks without injecting immediately', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.createNode).toBe('function');

    const created = window.createNode('physical_fault_injector', 420, 260);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const injector = created ?? state.modelNodes.find((node) => node.type === 'physical_fault_injector');
    expect(injector).toMatchObject({
      type: 'physical_fault_injector',
      faultInjector: {
        layer: 'physical',
        bound: false
      }
    });
    expect(state.faultTags || []).toHaveLength(0);
    expect(state.faultInjectionLinks || []).toHaveLength(0);
    expect(document.getElementById(`b-${injector.id}`)).not.toBeNull();

    wrapper.unmount();
  });

  it('keeps layered fault injector cards visually complete on the canvas', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    window.createNode('electrical_fault_injector', 420, 260);
    await flushRuntime();

    const injector = window.__GZ_STATE__.modelNodes.find((node) => node.type === 'electrical_fault_injector');
    const el = document.getElementById(`b-${injector.id}`);
    const ibmCss = readIbmWorkbenchCss();

    expect(injector.h).toBeGreaterThanOrEqual(92);
    expect(el).not.toBeNull();
    expect(el?.classList.contains('b-fault')).toBe(true);
    expect(el?.querySelector('.blk-lbl')?.textContent?.trim().length).toBeGreaterThan(0);
    const subtitle = el?.querySelector('.blk-sub')?.textContent?.trim() ?? '';
    expect(subtitle).toContain('电气层 / 未绑定');
    expect(subtitle).not.toContain('先放置后绑定');
    const componentsCss = readComponentsCss();
    expect(findCssRule(componentsCss, '.layered-fault-node-actions button.is-active')).toMatch(/background\s*:\s*#2563eb/);
    expect(findCssRule(componentsCss, '.diagram.fault-drop-preview .blk.is-layered-fault-binding-source')).toMatch(/opacity\s*:\s*1!important/);
    expect(findCssRule(ibmCss, '.canvas-wrap[data-view="canvas"] .diagram.fault-drop-preview .blk.is-layered-fault-binding-source')).toMatch(/opacity\s*:\s*1/);
    expect(findCssRule(ibmCss, '.canvas-wrap[data-view="canvas"] .b-fault::before')).toMatch(/clip-path\s*:\s*none!important/);
    expect(findCssRule(ibmCss, '.canvas-wrap[data-view="canvas"] .b-fault::before')).toMatch(/border-radius\s*:\s*6px!important/);
    expect(ibmCss).toMatch(/\.canvas-wrap\[data-view="canvas"\]\s+\.b-fault\s+\.blk-sub\s*\{[\s\S]*?display\s*:\s*block/);
    expect(findCssRule(ibmCss, '.canvas-wrap[data-view="canvas"] .b-fault .node-port__label')).toMatch(/display\s*:\s*none!important/);

    wrapper.unmount();
  });

  it('matches layered fault injectors by component capability and converts a valid binding into a fault tag', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.getLayeredFaultSlotsForTarget).toBe('function');
    expect(typeof window.canBindLayeredFaultInjectorToTarget).toBe('function');
    expect(typeof window.bindLayeredFaultInjectorToTarget).toBe('function');

    const state = window.__GZ_STATE__;
    const physicalTarget = state.modelNodes.find((node) => node.id === 'node-imu');
    const signalOnlyTarget = state.modelNodes.find((node) => node.type === 'signal_source');
    const physicalInjector = window.createNode('physical_fault_injector', 420, 260);
    await flushRuntime();

    expect(window.getLayeredFaultSlotsForTarget(physicalTarget).some((slot) => slot.layer === 'physical')).toBe(true);
    expect(window.getLayeredFaultSlotsForTarget(signalOnlyTarget).some((slot) => slot.layer === 'physical')).toBe(false);
    expect(window.canBindLayeredFaultInjectorToTarget(physicalInjector, signalOnlyTarget)).toBe(false);
    expect(window.canBindLayeredFaultInjectorToTarget(physicalInjector, physicalTarget)).toBe(true);

    const result = window.bindLayeredFaultInjectorToTarget(physicalInjector.id, {
      targetKind: 'node',
      targetId: physicalTarget.id,
      slotId: 'physical:imu_zero_bias',
      mathModel: 'bias',
      parameters: { bias: 0.1, start: 2, duration: 8 }
    });
    await flushRuntime();

    expect(result).toMatchObject({
      ok: true,
      targetId: physicalTarget.id,
      layer: 'physical',
      injectionForm: 'module-variable'
    });
    expect(state.modelNodes.some((node) => node.id === physicalInjector.id)).toBe(false);
    const tag = state.faultTags.find((item) => item.targetId === physicalTarget.id);
    expect(tag).toMatchObject({
      targetKind: 'node',
      targetId: physicalTarget.id,
      layerKey: 'physical',
      runtimeBehavior: 'bias',
      bindingObject: 'imu_zero_bias',
      targetVariable: 'imu_zero_bias',
      injectionForm: 'module-variable'
    });
    expect(result).toMatchObject({ bindingObject: 'imu_zero_bias' });
    expect(physicalTarget.injectedFault).toMatchObject({
      slotId: 'physical:imu_zero_bias',
      bindingObject: 'imu_zero_bias',
      targetVariable: 'imu_zero_bias',
      injectionForm: 'module-variable'
    });
    expect(physicalTarget.faultBindings[0]).toMatchObject({
      slotId: 'physical:imu_zero_bias',
      bindingObject: 'imu_zero_bias',
      targetVariable: 'imu_zero_bias',
      injectionForm: 'module-variable'
    });
    expect(state.faultInstances).toContainEqual(expect.objectContaining({
      targetId: physicalTarget.id,
      slotId: 'physical:imu_zero_bias',
      bindingObject: 'imu_zero_bias',
      targetVariable: 'imu_zero_bias',
      injectionForm: 'module-variable'
    }));
    expect(tag.parameters).toMatchObject({ bias: 0.1, start: 2, duration: 8 });
    expect(state.faultedBlks).toContain(physicalTarget.id);

    wrapper.unmount();
  });

  it('allows protocol injectors to bind to CAN edges but rejects normal signal edges', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const state = window.__GZ_STATE__;
    const canEdge = state.modelEdges.find((edge) => edge.id === 'edge-motor-motor1')
      || state.modelEdges.find((edge) => edge.lineType === 'can');
    const normalEdge = state.modelEdges.find((edge) => edge.lineType !== 'can');
    const protocolCapableNode = state.modelNodes.find((node) => node.id === 'node-motor');
    const protocolInjector = window.createNode('protocol_fault_injector', 420, 260);
    await flushRuntime();

    expect(window.getLayeredFaultSlotsForTarget(canEdge).some((slot) => slot.layer === 'protocol')).toBe(true);
    expect(window.getLayeredFaultSlotsForTarget(normalEdge).some((slot) => slot.layer === 'protocol')).toBe(false);
    expect(window.canBindLayeredFaultInjectorToTarget(protocolInjector, protocolCapableNode)).toBe(false);
    expect(window.canBindLayeredFaultInjectorToTarget(protocolInjector, normalEdge)).toBe(false);
    expect(window.canBindLayeredFaultInjectorToTarget(protocolInjector, canEdge)).toBe(true);

    mockNearestEdgePathGeometry(canEdge.id, { x: 120, y: 120 });

    document.querySelector(`[data-layered-fault-bind="${protocolInjector.id}"]`)?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    expect(document.getElementById('diagram')?.classList.contains('fault-drop-preview--edge')).toBe(true);
    expect(document.getElementById('diagram')?.classList.contains('fault-drop-preview--protocol')).toBe(true);
    expect(document.getElementById(`b-${protocolCapableNode.id}`)?.classList.contains('fault-drop-compatible')).toBe(false);
    expect(document.querySelector(`.edge-hit[data-edge-id="${canEdge.id}"]`)?.classList.contains('is-fault-drop-compatible')).toBe(true);
    expect(document.querySelector(`.edge-label[data-edge-id="${canEdge.id}"]`)?.classList.contains('is-fault-drop-compatible')).toBe(true);
    const protocolMarker = document.querySelector(`[data-layered-fault-edge-marker][data-edge-id="${canEdge.id}"]`);
    expect(protocolMarker).not.toBeNull();
    expect(protocolMarker?.textContent).toContain('F');

    protocolMarker?.dispatchEvent(new MouseEvent('pointerup', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('协议链路/报文');
    expect(dialog?.textContent).toContain('1号电机 CAN 指令');
    expect(dialog?.querySelector('select[data-layered-fault-slot]')).toBeNull();
    expect(dialog?.querySelector('select[data-layered-fault-model]')).toBeNull();
    expect(dialog?.querySelector('[data-layered-fault-dropdown="slot"]')).not.toBeNull();
    expect(dialog?.querySelector('[data-layered-fault-dropdown="model"]')).not.toBeNull();
    const slotOptions = Array.from(dialog?.querySelectorAll('[data-layered-fault-option="slot"]') || [])
      .map((option) => option.textContent?.trim());
    expect(slotOptions).toContain('motor.command.m1');
    expect(slotOptions).not.toContain('motor_command_payload');

    dialog?.querySelector('[data-layered-fault-option="model"][data-layered-fault-option-value="dropout"]')?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    expect(dialog?.querySelector('[data-layered-fault-model]')?.value).toBe('dropout');
    const parameterText = dialog?.querySelector('[data-layered-fault-params]')?.textContent || '';
    expect(parameterText).toContain('丢包率');
    expect(parameterText).toContain('随机种子');
    expect(parameterText).toContain('开始时间');
    expect(parameterText).toContain('持续时间');
    expect(parameterText).not.toContain('drop_rate');
    expect(parameterText).not.toContain('start');
    expect(parameterText).not.toContain('duration');

    dialog?.querySelector('[data-layered-fault-confirm]')?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    expect(state.faultInstances).toContainEqual(expect.objectContaining({
      targetId: canEdge.id,
      targetKind: 'edge',
      layer: 'protocol',
      bindingObject: 'motor.command.m1',
      targetVariable: 'motor.command.m1',
      injectionForm: 'protocol-bus'
    }));

    const edgeTag = state.faultTags.find((tag) => tag.targetKind === 'edge' && tag.targetId === canEdge.id);
    expect(edgeTag).toBeTruthy();
    expect(edgeTag.expanded).toBe(false);
    expect(document.getElementById(`visual-${edgeTag.id}`)).toBeNull();

    const edgeFaultToggle = document.querySelector(`[data-edge-fault-toggle][data-edge-id="${canEdge.id}"]`);
    const toggleLayer = document.getElementById('canvas-edge-control-layer');
    const nodeLayer = document.getElementById('node-layer');
    expect(edgeFaultToggle).not.toBeNull();
    expect(toggleLayer).not.toBeNull();
    expect(edgeFaultToggle?.closest('#canvas-edge-control-layer')).toBe(toggleLayer);
    expect(toggleLayer?.parentElement).toBe(nodeLayer?.parentElement);
    expect(Array.from(toggleLayer?.parentElement?.children || []).indexOf(toggleLayer)).toBeGreaterThan(
      Array.from(nodeLayer?.parentElement?.children || []).indexOf(nodeLayer)
    );
    expect(edgeFaultToggle?.textContent).toContain('F');
    expect(edgeFaultToggle?.querySelector('.edge-fault-toggle__hit')).not.toBeNull();

    edgeFaultToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushRuntime();
    expect(edgeTag.expanded).toBe(true);
    expect(document.getElementById(`visual-${edgeTag.id}`)).not.toBeNull();
    expect(state.selFaultTag).toBe(edgeTag.id);
    expect(document.querySelector(`[data-fault-tag-inspector="${edgeTag.id}"]`)).not.toBeNull();

    const openEdgeFaultToggle = document.querySelector(`[data-edge-fault-toggle][data-edge-id="${canEdge.id}"]`);
    openEdgeFaultToggle?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();
    expect(edgeTag.expanded).toBe(false);
    expect(document.getElementById(`visual-${edgeTag.id}`)).toBeNull();

    wrapper.unmount();
  });

  it('opens the protocol binding dialog when the edge target marker receives the click', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const state = window.__GZ_STATE__;
    state.canvasOffsetX = 0;
    state.canvasOffsetY = 0;
    state.canvasScale = 1;

    const canEdge = state.modelEdges.find((edge) => edge.id === 'edge-motor-motor1')
      || state.modelEdges.find((edge) => edge.lineType === 'can');
    const protocolInjector = window.createNode('protocol_fault_injector', 420, 260);
    await flushRuntime();

    mockNearestEdgePathGeometry(canEdge.id, { x: 120, y: 120 });

    document.querySelector(`[data-layered-fault-bind="${protocolInjector.id}"]`)?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    const edgeTargetMarker = document.querySelector(`[data-layered-fault-edge-marker][data-edge-id="${canEdge.id}"]`);
    const edgeControlLayer = document.getElementById('canvas-edge-control-layer');
    const nodeLayer = document.getElementById('node-layer');
    expect(edgeTargetMarker).not.toBeNull();
    expect(edgeTargetMarker?.closest('#canvas-edge-control-layer')).toBe(edgeControlLayer);
    expect(edgeControlLayer?.parentElement).toBe(nodeLayer?.parentElement);
    expect(Array.from(edgeControlLayer?.parentElement?.children || []).indexOf(edgeControlLayer)).toBeGreaterThan(
      Array.from(nodeLayer?.parentElement?.children || []).indexOf(nodeLayer)
    );

    edgeTargetMarker?.dispatchEvent(new MouseEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 120
    }));
    await flushRuntime();

    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('motor.command.m1');

    wrapper.unmount();
  });

  it('runs the 0526 independent layered fault tasks and records oscilloscope deltas', async () => {
    const scenarios = [
      {
        name: 'gyro bias',
        createInjector: () => window.createNode('electrical_fault_injector', 420, 260),
        targetKind: 'node',
        targetId: 'node-imu',
        slotId: 'electrical:测量角速度',
        mathModel: 'bias',
        parameters: { bias: 5, start: 1, duration: 2 },
        scopeChannel: 'ch2',
        minDiff: 1
      },
      {
        name: 'motor stuck',
        createInjector: () => window.createNode('physical_fault_injector', 420, 260),
        targetKind: 'node',
        targetId: 'node-motor-1',
        slotId: 'physical:motor_max_output',
        mathModel: 'freeze',
        parameters: { mode: 'zero', value: 0, start: 1, duration: 2 },
        scopeChannel: 'ch2',
        minDiff: 0.001
      },
      {
        name: 'command tamper',
        createInjector: () => window.createNode('protocol_fault_injector', 420, 260),
        targetKind: 'edge',
        targetId: 'edge-shaper-error',
        slotId: 'protocol:edge-shaper-error:can',
        mathModel: 'tamper',
        parameters: { scale: 1.5, bias: 0, start: 1, duration: 2 },
        scopeChannel: 'ch2',
        minDiff: 0.0001
      }
    ];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createCanvasContextStub());

    for (const scenario of scenarios) {
      const wrapper = mount(App, { attachTo: document.body });
      await flushRuntime();

      const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
      const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
      await flushRuntime();

      expect(importResult, scenario.name).toMatchObject({ ok: true });
      const state = window.__GZ_STATE__;
      const target = scenario.targetKind === 'edge'
        ? state.modelEdges.find((edge) => edge.id === scenario.targetId)
        : state.modelNodes.find((node) => node.id === scenario.targetId);
      expect(target, scenario.name).toBeTruthy();
      expect(window.getLayeredFaultSlotsForTarget(target).some((slot) => slot.id === scenario.slotId), scenario.name).toBe(true);

      const injector = scenario.createInjector();
      await flushRuntime();
      const result = window.bindLayeredFaultInjectorToTarget(injector.id, {
        targetKind: scenario.targetKind,
        targetId: scenario.targetId,
        slotId: scenario.slotId,
        mathModel: scenario.mathModel,
        parameters: scenario.parameters
      });
      await flushRuntime();

      expect(result, scenario.name).toMatchObject({
        ok: true,
        targetId: scenario.targetId
      });
      expect(target.faultBindings?.[0]?.parameters, scenario.name).toMatchObject(scenario.parameters);

      document.getElementById('sim-dur').value = '4';
      document.getElementById('sim-step').value = '0.1';
      window.simInit(true);
      for (let step = 0; step < 41; step += 1) {
        window.simStep();
      }
      await flushRuntime();

      window.openScope('node-scope');
      await flushRuntime();

      const actual = window.__GZ_SIM__?.actual?.scopeSamples?.['node-scope']?.[scenario.scopeChannel] ?? [];
      const reference = window.__GZ_SIM__?.reference?.scopeSamples?.['node-scope']?.[scenario.scopeChannel] ?? [];
      expect(actual.length, scenario.name).toBeGreaterThan(0);
      expect(reference.length, scenario.name).toBeGreaterThan(0);
      expect(maxScopeDiff(actual, reference, 1, 3), scenario.name).toBeGreaterThan(scenario.minDiff);
      expect(document.querySelector('.scope-window[data-scope-id="node-scope"]'), scenario.name).not.toBeNull();

      wrapper.unmount();
      document.body.innerHTML = '';
      __resetLegacyRuntimeForTests();
    }

    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
    await flushRuntime();

    for (const scenario of scenarios) {
      const injector = scenario.createInjector();
      await flushRuntime();
      const result = window.bindLayeredFaultInjectorToTarget(injector.id, {
        targetKind: scenario.targetKind,
        targetId: scenario.targetId,
        slotId: scenario.slotId,
        mathModel: scenario.mathModel,
        parameters: scenario.parameters
      });
      expect(result, scenario.name).toMatchObject({ ok: true });
      await flushRuntime();
    }

    document.getElementById('sim-dur').value = '4';
    document.getElementById('sim-step').value = '0.1';
    window.simInit(true);
    for (let step = 0; step < 41; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    const combinedActual = window.__GZ_SIM__?.actual?.scopeSamples?.['node-scope']?.ch2 ?? [];
    const combinedReference = window.__GZ_SIM__?.reference?.scopeSamples?.['node-scope']?.ch2 ?? [];
    expect(window.__GZ_STATE__.faultInstances).toHaveLength(3);
    expect(maxScopeDiff(combinedActual, combinedReference, 1, 3)).toBeGreaterThan(1);

    wrapper.unmount();
  }, 15000);

  it('routes Python-bound output through protocol dropout faults before scope sampling', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createCanvasContextStub());
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const state = window.__GZ_STATE__;
    const commandShaper = state.modelNodes.find((node) => node.id === 'node-command-shaper');
    const scopeEdge = state.modelEdges.find((edge) => edge.id === 'edge-command-scope');

    expect(commandShaper?.pythonBinding?.bound).toBe(true);
    expect(commandShaper?.pythonBinding?.rawSource).toContain('shaped_command');
    expect(scopeEdge).toBeTruthy();

    scopeEdge.lineType = 'can';
    scopeEdge.channelId = 'CAN-FC-SCOPE';
    scopeEdge.messageId = '0x121';
    scopeEdge.faultSlots = [
      {
        slotId: 'protocol:edge-command-scope:can',
        slotName: 'Scope CAN payload',
        layer: 'protocol',
        targetField: 'can.payload',
        allowedModels: ['dropout', 'tamper', 'delay', 'stale'],
        bindingObject: 'scope.command',
        targetVariable: 'scope.command',
        signalId: 'scope.command',
        channelId: 'CAN-FC-SCOPE',
        messageId: '0x121'
      }
    ];

    const injector = window.createNode('protocol_fault_injector', 420, 260);
    await flushRuntime();

    const result = window.bindLayeredFaultInjectorToTarget(injector.id, {
      targetKind: 'edge',
      targetId: scopeEdge.id,
      slotId: 'protocol:edge-command-scope:can',
      mathModel: 'dropout',
      parameters: { drop_rate: 1, strategy: 'gap', start: 1, duration: 1 }
    });
    await flushRuntime();

    expect(result).toMatchObject({ ok: true, targetId: scopeEdge.id });
    expect(scopeEdge.faultBindings?.[0]?.runtimeBehavior).toBe('dropout');

    document.getElementById('sim-dur').value = '2.2';
    document.getElementById('sim-step').value = '0.1';
    window.simInit(true);
    for (let step = 0; step < 23; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    const actual = window.__GZ_SIM__?.actual?.scopeSamples?.['node-scope']?.ch1 ?? [];
    const reference = window.__GZ_SIM__?.reference?.scopeSamples?.['node-scope']?.ch1 ?? [];
    const beforeFault = actual.filter((sample) => sample.t < 1 && sample.dropped !== true);

    expect(beforeFault.length).toBeGreaterThan(0);
    expect(reference.filter((sample) => sample.t >= 1 && sample.t <= 2)).toHaveLength(11);
    expect(countDroppedScopeSamples(actual, 1, 2)).toBeGreaterThanOrEqual(10);
    expect(actual.filter((sample) => sample.t >= 1 && sample.t <= 2 && sample.dropped !== true)).toHaveLength(0);

    wrapper.unmount();
  });

  it('keeps the flight-control demo response bounded during a long nominal run', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createCanvasContextStub());
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    document.getElementById('sim-dur').value = '80';
    document.getElementById('sim-step').value = '0.1';
    window.simInit(true);
    for (let step = 0; step < 801; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    const feedback = window.__GZ_SIM__?.actual?.scopeSamples?.['node-scope']?.ch2 ?? [];
    const values = feedback.map(scopeSampleValue).filter(Number.isFinite);
    const lateValues = feedback
      .filter((sample) => sample.t >= 60)
      .map(scopeSampleValue)
      .filter(Number.isFinite);

    expect(values.length).toBeGreaterThan(0);
    expect(Math.max(...values.map(Math.abs))).toBeLessThan(0.4);
    expect(Math.max(...lateValues.map(Math.abs))).toBeLessThan(0.16);

    wrapper.unmount();
  }, 15000);

  it('stops dragging a scope window after pointer cancellation', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createCanvasContextStub());
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
    await flushRuntime();

    window.openScope('node-scope');
    await flushRuntime();

    const scopeWindow = window.__GZ_SIM__.scopeWindows['node-scope'];
    const header = document.querySelector('.scope-window[data-scope-id="node-scope"] [data-scope-drag-handle]');
    expect(header).not.toBeNull();
    const original = { x: scopeWindow.x, y: scopeWindow.y };

    dispatchPointer(header, 'pointerdown', { pointerId: 91, clientX: 120, clientY: 120 });
    dispatchPointer(window, 'pointercancel', { pointerId: 91, clientX: 120, clientY: 120 });
    dispatchPointer(window, 'pointermove', { pointerId: 91, clientX: 260, clientY: 260 });
    await flushRuntime();

    expect(scopeWindow.x).toBe(original.x);
    expect(scopeWindow.y).toBe(original.y);

    wrapper.unmount();
  });

  it('clears the active scope window samples without changing the simulation clock', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createCanvasContextStub());
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
    await flushRuntime();

    document.getElementById('sim-dur').value = '3';
    document.getElementById('sim-step').value = '0.1';
    window.simInit(true);
    for (let step = 0; step < 16; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    window.openScope('node-scope');
    await flushRuntime();

    expect((window.__GZ_SIM__?.actual?.scopeSamples?.['node-scope']?.ch1 ?? []).length).toBeGreaterThan(0);
    expect((window.__GZ_SIM__?.actual?.scopeSamples?.['node-scope']?.ch2 ?? []).length).toBeGreaterThan(0);
    const timeBeforeClear = window.__GZ_SIM__.time;

    const clearButton = document.querySelector('[data-scope-clear="node-scope"]');
    expect(clearButton).not.toBeNull();
    clearButton.click();
    await flushRuntime();

    expect(window.__GZ_SIM__.time).toBe(timeBeforeClear);
    expect(window.__GZ_SIM__?.actual?.scopeSamples?.['node-scope']?.ch1 ?? []).toHaveLength(0);
    expect(window.__GZ_SIM__?.actual?.scopeSamples?.['node-scope']?.ch2 ?? []).toHaveLength(0);
    expect(window.__GZ_SIM__?.reference?.scopeSamples?.['node-scope']?.ch1 ?? []).toHaveLength(0);
    expect(window.__GZ_SIM__?.reference?.scopeSamples?.['node-scope']?.ch2 ?? []).toHaveLength(0);
    expect(document.querySelector('[data-scope-channel="ch1"] [data-field="current"]')?.textContent).toBe('--');

    wrapper.unmount();
  });

  it('downloads a JSON snapshot when saving completed simulation results', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createCanvasContextStub());
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
    await flushRuntime();

    document.getElementById('sim-name').value = 'result-json-run';
    document.getElementById('sim-dur').value = '2';
    document.getElementById('sim-step').value = '0.5';
    window.simInit(true);
    for (let step = 0; step < 4; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    window.doSaveRes();
    await flushRuntime();

    expect(window.__GZ_LAST_SIMULATION_RESULT_EXPORT__?.filename).toMatch(/^result-json-run-\d{4}-\d{2}-\d{2}\.json$/);
    const saved = JSON.parse(window.__GZ_LAST_SIMULATION_RESULT_EXPORT__.json);
    expect(saved.schemaVersion).toBe(1);
    expect(saved.kind).toBe('simulation-result');
    expect(saved.meta).toMatchObject({
      datasetName: 'result-json-run',
      duration: 2,
      stepSize: 0.5,
      stepIndex: 4,
      status: 'completed'
    });
    expect(saved.model.nodes.length).toBeGreaterThan(0);
    expect(saved.model.edges.length).toBeGreaterThan(0);
    expect(saved.samples.actual.scopeSamples['node-scope'].ch1.length).toBeGreaterThan(0);
    expect(saved.samples.reference.scopeSamples['node-scope'].ch1.length).toBeGreaterThan(0);
    expect(saved.summary.faultCount).toBeGreaterThanOrEqual(0);

    wrapper.unmount();
  });

  it('switches scope channels and time windows while the simulation is running', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createCanvasContextStub());
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
    await flushRuntime();

    document.getElementById('sim-dur').value = '4';
    document.getElementById('sim-step').value = '0.1';
    window.simInit(true);
    for (let step = 0; step < 8; step += 1) {
      window.simStep();
    }
    window.openScope('node-scope');
    window.simRun();
    await flushRuntime();

    document.querySelector('[data-scope-mode="ch2"][data-scope-id="node-scope"]')?.click();
    document.querySelector('[data-scope-window-size="2"][data-scope-id="node-scope"]')?.click();
    await flushRuntime();

    expect(window.__GZ_SIM__.scopeWindows['node-scope'].mode).toBe('ch2');
    expect(window.__GZ_SIM__.scopeWindows['node-scope'].windowSeconds).toBe(2);
    expect(document.querySelector('[data-scope-mode="ch2"].is-active')).not.toBeNull();
    expect(document.querySelector('[data-scope-window-size="2"].is-active')).not.toBeNull();

    const countBeforeTick = window.__GZ_SIM__.actual.scopeSamples['node-scope'].ch2.length;
    window.runSimulationTick();
    await flushRuntime();

    expect(window.__GZ_SIM__.scopeWindows['node-scope'].mode).toBe('ch2');
    expect(window.__GZ_SIM__.scopeWindows['node-scope'].windowSeconds).toBe(2);
    expect(document.querySelector('[data-scope-mode="ch2"].is-active')).not.toBeNull();
    expect(document.querySelector('[data-scope-window-size="2"].is-active')).not.toBeNull();
    expect(window.__GZ_SIM__.actual.scopeSamples['node-scope'].ch2.length).toBeGreaterThan(countBeforeTick);

    window.simStop('stopped');
    wrapper.unmount();
  });

  it('loads the 0526 fault task presets from the top fault-model button', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const taskButton = document.getElementById('btn-imp-flt');
    expect(taskButton?.textContent).toContain('加载故障模型');
    expect(taskButton?.disabled).toBe(false);
    expect(typeof window.applyFaultTaskPreset).toBe('function');

    window.doImportFault();
    await flushRuntime();

    expect(document.querySelector('[data-fault-task-loader]')).not.toBeNull();
    expect(document.querySelector('[data-fault-task-preset="gyro-bias"]')?.textContent).toContain('陀螺仪零偏');
    expect(document.querySelector('[data-fault-task-preset="combined-0526"]')?.textContent).toContain('组合注入');

    const result = window.applyFaultTaskPreset('gyro-bias');
    await flushRuntime();

    expect(result).toMatchObject({ ok: true, applied: 1 });
    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      targetId: 'node-imu',
      slotId: 'electrical:测量角速度',
      parameters: expect.objectContaining({ bias: 5, start: 1, duration: 2 })
    }));
    expect(document.getElementById('ov-ifm')?.classList.contains('open')).not.toBe(true);

    wrapper.unmount();
  });

  it('saves and reloads the current fault task package from the task loader', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.applyFaultTaskPreset('gyro-bias')).toMatchObject({ ok: true });
    await flushRuntime();

    window.doImportFault();
    await flushRuntime();

    document.querySelector('[data-fault-task-save]')?.click();
    await flushRuntime();

    const loadSavedButton = document.querySelector('[data-fault-task-load-saved]');
    expect(loadSavedButton?.disabled).toBe(false);

    loadSavedButton?.click();
    await flushRuntime();

    expect(document.querySelector('[data-fault-task-loader]')).toBeNull();
    expect(window.__GZ_STATE__.faultInstances).toContainEqual(expect.objectContaining({
      targetId: 'node-imu',
      slotId: 'electrical:测量角速度'
    }));

    wrapper.unmount();
  });

  it('places protocol injectors from palette drops instead of opening the legacy fault-library dialog', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const state = window.__GZ_STATE__;
    const beforeCount = state.modelNodes.filter((node) => node.type === 'protocol_fault_injector').length;
    const canEdge = state.modelEdges.find((edge) => edge.id === 'edge-motor-motor1')
      || state.modelEdges.find((edge) => edge.lineType === 'can');
    const viewport = document.getElementById('canvas-viewport');
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        getData: () => 'protocol_fault_injector',
        dropEffect: ''
      }
    });
    Object.defineProperty(dropEvent, 'clientX', { value: 780 });
    Object.defineProperty(dropEvent, 'clientY', { value: 360 });

    viewport?.dispatchEvent(dropEvent);
    await flushRuntime();

    expect(state.modelNodes.filter((node) => node.type === 'protocol_fault_injector')).toHaveLength(beforeCount + 1);
    expect(document.querySelector('[data-target-fault-dialog]')).toBeNull();
    expect(canEdge.injectedFault).toBeUndefined();
    expect(state.faultInstances || []).not.toContainEqual(expect.objectContaining({
      targetKind: 'edge',
      targetId: canEdge.id
    }));

    wrapper.unmount();
  });

  it('binds a layered injector only after explicit bind and confirmation', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const state = window.__GZ_STATE__;
    const physicalTarget = state.modelNodes.find((node) => node.id === 'node-imu');
    const signalOnlyTarget = state.modelNodes.find((node) => node.type === 'signal_source');
    const injector = window.createNode('physical_fault_injector', 420, 260);
    await flushRuntime();

    expect(injector.faultInjector).toMatchObject({ layer: 'physical', bound: false });
    expect(document.getElementById(`b-${physicalTarget.id}`)?.classList.contains('fault-drop-compatible')).toBe(false);

    const bindButton = document
      .getElementById(`b-${injector.id}`)
      ?.querySelector(`[data-layered-fault-bind="${injector.id}"]`);
    expect(bindButton).not.toBeNull();
    bindButton?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    const activeBindButton = document
      .getElementById(`b-${injector.id}`)
      ?.querySelector(`[data-layered-fault-bind="${injector.id}"]`);
    expect(activeBindButton?.textContent).toContain('取消绑定');
    expect(activeBindButton?.classList.contains('is-active')).toBe(true);
    expect(document.getElementById(`b-${injector.id}`)?.classList.contains('is-layered-fault-binding-source')).toBe(true);
    expect(document.getElementById(`b-${physicalTarget.id}`)?.classList.contains('fault-drop-compatible')).toBe(true);
    expect(document.getElementById(`b-${signalOnlyTarget.id}`)?.classList.contains('fault-drop-compatible')).toBe(false);

    document.getElementById(`b-${physicalTarget.id}`)?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    expect(state.modelNodes.some((node) => node.id === injector.id)).toBe(true);
    expect(document.querySelector('[data-layered-fault-binding-dialog]')).not.toBeNull();
    expect(state.faultTags?.some((tag) => tag.targetId === physicalTarget.id && tag.layerKey === 'physical')).not.toBe(true);

    document.querySelector('[data-layered-fault-confirm]')?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    expect(state.modelNodes.some((node) => node.id === injector.id)).toBe(false);
    expect(state.faultTags.some((tag) => tag.targetId === physicalTarget.id && tag.layerKey === 'physical')).toBe(true);

    wrapper.unmount();
  });

  it('opens the layered binding dialog from a real pointer selection on a compatible block', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const state = window.__GZ_STATE__;
    const imuTarget = state.modelNodes.find((node) => node.id === 'node-imu');
    expect(imuTarget).toBeTruthy();

    const injector = window.createNode('electrical_fault_injector', 420, 260);
    await flushRuntime();

    document.querySelector(`[data-layered-fault-bind="${injector.id}"]`)?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    const targetEl = document.getElementById(`b-${imuTarget.id}`);
    expect(targetEl?.classList.contains('fault-drop-compatible')).toBe(true);

    dispatchPointer(targetEl, 'pointerdown', { pointerId: 42, clientX: 720, clientY: 320 });
    dispatchPointer(targetEl, 'pointerup', { pointerId: 42, clientX: 720, clientY: 320 });
    await flushRuntime();

    const dialog = document.querySelector('[data-layered-fault-binding-dialog]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('IMU');
    const handle = dialog?.querySelector('[data-layered-fault-dialog-handle]');
    expect(handle).not.toBeNull();
    dispatchPointer(handle, 'pointerdown', { pointerId: 77, clientX: 300, clientY: 200 });
    dispatchPointer(window, 'pointermove', { pointerId: 77, clientX: 360, clientY: 246 });
    dispatchPointer(window, 'pointerup', { pointerId: 77, clientX: 360, clientY: 246 });
    await flushRuntime();
    expect(dialog?.style.left).not.toBe('');
    expect(dialog?.style.top).not.toBe('');
    expect(dialog?.style.right).toBe('auto');

    wrapper.unmount();
  });

  it('opens the binding dialog for demo capability-map targets without dimming every other element', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const state = window.__GZ_STATE__;
    const imuTarget = state.modelNodes.find((node) => node.id === 'node-imu');
    expect(imuTarget).toBeTruthy();

    const injector = window.createNode('electrical_fault_injector', 420, 260);
    await flushRuntime();

    document.querySelector(`[data-layered-fault-bind="${injector.id}"]`)?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    expect(document.getElementById('diagram')?.classList.contains('fault-drop-preview')).toBe(true);
    expect(document.getElementById(`b-${imuTarget.id}`)?.classList.contains('fault-drop-compatible')).toBe(true);
    expect(document.querySelectorAll('.fault-drop-incompatible,.is-fault-drop-incompatible')).toHaveLength(0);

    document.getElementById(`b-${imuTarget.id}`)?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    expect(document.querySelector('[data-layered-fault-binding-dialog]')).not.toBeNull();
    expect(document.querySelector('[data-layered-fault-binding-dialog]')?.textContent).toContain('IMU');

    wrapper.unmount();
  });

  it('renders an exportable D matrix view for fault detectability by test point', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.buildDetectionMatrixModel).toBe('function');
    expect(typeof window.exportDetectionMatrixCsv).toBe('function');
    expect(window.buildDetectionMatrixModel().points).toHaveLength(0);
    window.installAllDiagnosticTestPoints();

    const matrix = window.buildDetectionMatrixModel();
    expect(matrix.points.length).toBeGreaterThanOrEqual(10);
    expect(matrix.faults.length).toBeGreaterThanOrEqual(10);
    expect(matrix.rows.some((row) => row.faultId === 'sensor_additive_bias')).toBe(true);
    expect(matrix.rows.some((row) => row.faultId === 'fault_bias_overlay')).toBe(true);
    expect(matrix.rows.some((row) => row.faultId === 'fault_noise_injection')).toBe(true);
    expect(matrix.rows.some((row) => row.faultId === 'gyro_zero_bias_offset')).toBe(true);
    expect(matrix.rows.some((row) => row.faultId === 'motor_1_stuck_position')).toBe(true);
    expect(matrix.rows.some((row) => row.faultId === 'control_command_tamper')).toBe(true);
    expect(matrix.rows.find((row) => row.faultId === 'sensor_additive_bias')?.cells.some((cell) => cell.detectable)).toBe(true);
    const motorCommandPoint = matrix.points.find((point) => point.shortName === 'M6');
    const motorResponsePoint = matrix.points.find((point) => point.shortName === 'M7');
    const motorStuckRow = matrix.rows.find((row) => row.faultId === 'motor_1_stuck_position');
    const commandTamperRow = matrix.rows.find((row) => row.faultId === 'control_command_tamper');
    expect(commandTamperRow?.cells.find((cell) => cell.pointId === motorCommandPoint?.pointId)?.detectable).toBe(true);
    expect(motorStuckRow?.cells.find((cell) => cell.pointId === motorCommandPoint?.pointId)?.detectable).toBe(false);
    expect(motorStuckRow?.cells.find((cell) => cell.pointId === motorResponsePoint?.pointId)?.detectable).toBe(true);

    const dMatrixTab = document.querySelector('[data-canvas-view="dmatrix"]');
    expect(dMatrixTab).not.toBeNull();
    dMatrixTab.click();
    await flushRuntime();

    const panel = document.getElementById('d-matrix-panel');
    expect(document.getElementById('cw')?.dataset.view).toBe('dmatrix');
    expect(panel?.querySelector('[data-d-matrix-view]')).not.toBeNull();
    expect(panel?.querySelector('[data-d-matrix-export]')).not.toBeNull();
    expect(panel?.textContent).toContain('D矩阵');
    expect(panel?.textContent).toContain('已启用测点');
    expect(panel?.textContent).not.toContain('固定测点');

    const componentsCss = readComponentsCss();
    const dMatrixPanelRule = findCssRule(componentsCss, '.d-matrix-panel');
    const dMatrixRule = findCssRule(componentsCss, '.d-matrix');
    const dMatrixHeaderRule = findCssRule(componentsCss, '.d-matrix-header');
    const dMatrixTitleRule = findCssRule(componentsCss, '.d-matrix-header h2');
    const dMatrixHeaderCopyRule = findCssRule(componentsCss, '.d-matrix-header p');
    const dMatrixSummaryRule = findCssRule(componentsCss, '.d-matrix-summary');
    const dMatrixChromeRule = findCssRule(componentsCss, '.canvas-wrap[data-view="dmatrix"] .canvas-chrome');
    const dMatrixTabsRule = findCssRule(componentsCss, '.canvas-wrap[data-view="dmatrix"] .canvas-tabs');
    const canvasChromeRule = findCssRule(componentsCss, '.canvas-chrome');
    const canvasTabsRule = findCssRule(componentsCss, '.canvas-tabs');
    const tableWrapRule = findCssRule(componentsCss, '.d-matrix-table-wrap');
    const tableStickyBodyRule = findCssRule(componentsCss, '.d-matrix-table td.d-matrix-sticky');
    const tableStickyHeaderRule = findCssRule(componentsCss, '.d-matrix-table th.d-matrix-sticky');
    const troubleshootingPathRule = findCssRule(componentsCss, '.troubleshooting-path');
    const exportRule = findCssRule(componentsCss, '.d-matrix-export');
    expect(componentsCss).toContain('.canvas-wrap[data-view="dmatrix"] .canvas-floating');
    expect(componentsCss).toContain('.canvas-wrap[data-view="dmatrix"] .canvas-tools');
    expect(componentsCss).toContain('.canvas-wrap[data-view="dmatrix"] .canvas-sim-dock');
    expect(dMatrixPanelRule).toMatch(/top\s*:\s*48px/);
    expect(dMatrixPanelRule).toMatch(/z-index\s*:\s*var\(--canvas-layer-panel\)/);
    expect(dMatrixChromeRule).toMatch(/grid-template-rows\s*:\s*48px/);
    expect(dMatrixChromeRule).toMatch(/height\s*:\s*48px/);
    expect(dMatrixTabsRule).toMatch(/grid-row\s*:\s*1/);
    expect(componentsCss).toMatch(/--canvas-layer-panel\s*:\s*11/);
    expect(canvasChromeRule).toMatch(/z-index\s*:\s*20/);
    expect(canvasTabsRule).toMatch(/background\s*:\s*#fff/);
    expect(dMatrixPanelRule).toMatch(/overflow\s*:\s*hidden/);
    expect(dMatrixPanelRule).toMatch(/border-radius\s*:\s*0/);
    expect(dMatrixPanelRule).not.toMatch(/box-shadow/);
    expect(dMatrixRule).toMatch(/min-width\s*:\s*0/);
    expect(dMatrixRule).toMatch(/position\s*:\s*relative/);
    expect(dMatrixRule).toMatch(/font-family\s*:\s*"IBM Plex Sans"/);
    expect(dMatrixRule).toMatch(/isolation\s*:\s*isolate/);
    expect(dMatrixHeaderRule).toMatch(/align-items\s*:\s*center/);
    expect(dMatrixHeaderRule).toMatch(/position\s*:\s*relative/);
    expect(dMatrixHeaderRule).toMatch(/z-index\s*:\s*10/);
    expect(dMatrixTitleRule).toMatch(/font-size\s*:\s*22px/);
    expect(dMatrixHeaderCopyRule).toMatch(/display\s*:\s*none/);
    expect(dMatrixSummaryRule).toMatch(/position\s*:\s*relative/);
    expect(dMatrixSummaryRule).toMatch(/z-index\s*:\s*9/);
    expect(tableWrapRule).toMatch(/min-height\s*:\s*0/);
    expect(tableWrapRule).toMatch(/position\s*:\s*relative/);
    expect(tableWrapRule).toMatch(/z-index\s*:\s*1/);
    expect(tableStickyBodyRule).toMatch(/z-index\s*:\s*3/);
    expect(tableStickyHeaderRule).toMatch(/top\s*:\s*0/);
    expect(tableStickyHeaderRule).toMatch(/z-index\s*:\s*5/);
    expect(troubleshootingPathRule).toMatch(/z-index\s*:\s*12/);
    expect(exportRule).toMatch(/border-radius\s*:\s*0/);

    const firstPathAction = panel?.querySelector('[data-build-troubleshooting-path]');
    expect(firstPathAction).not.toBeNull();
    firstPathAction.click();
    await flushRuntime();
    const pathPanel = panel?.querySelector('[data-troubleshooting-path-panel]');
    expect(pathPanel).not.toBeNull();
    expect(pathPanel?.textContent).toContain('最优排故路径');
    expect(pathPanel?.querySelector('[data-close-troubleshooting-path]')).not.toBeNull();

    const csv = window.exportDetectionMatrixCsv({ download: false });
    expect(csv).toContain('故障类型');
    expect(csv).toContain('M1');
    expect(csv).toContain('sensor_additive_bias');

    wrapper.unmount();
  });

  it('separates propagating faults from local parameter faults in dataflow semantics', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    const edgeById = new Map(window.__GZ_STATE__.modelEdges.map((edge) => [edge.id, edge]));
    const nodeById = new Map(window.__GZ_STATE__.modelNodes.map((node) => [node.id, node]));
    edgeById.get('edge-imu-error').injectedFault = {
      modelId: 'test-sensor-bias',
      name: 'IMU sensor bias',
      layer: 'sensor',
      runtimeBehavior: 'sensor_bias',
      faultCode: 'sensor_bias'
    };
    edgeById.get('edge-command-shaper').injectedFault = {
      modelId: 'test-packet-loss',
      name: 'CAN packet loss',
      layer: 'protocol',
      runtimeBehavior: 'packet_loss',
      faultCode: 'packet_loss'
    };
    nodeById.get('node-controller').injectedFault = {
      modelId: 'test-controller-gain',
      name: 'Controller gain drift',
      layer: 'control',
      runtimeBehavior: 'gain_drift',
      parameter: 'kp'
    };

    const semantic = window.buildDataflowSemanticModel();
    const groups = semantic.propagationGroups;
    const propagatedEdge = semantic.edges.find((edge) => edge.id === 'edge-imu-error');
    const blockedEdge = semantic.edges.find((edge) => edge.id === 'edge-command-shaper');
    const localEdge = semantic.edges.find((edge) => edge.id === 'edge-controller-allocator');
    const diagnosticEdge = semantic.edges.find((edge) => edge.propagationKind === 'diagnosticOnly');
    const normalEdge = semantic.edges.find((edge) => edge.propagationKind === 'none');

    expect(Object.keys(groups)).toEqual(['propagated', 'localEffect', 'blocked', 'diagnosticOnly', 'none']);
    Object.entries(groups).forEach(([kind, group]) => {
      expect(group).toMatchObject({
        kind,
        labelZh: expect.any(String),
        descriptionZh: expect.any(String),
        count: group.points.length
      });
      expect(Array.isArray(group.points)).toBe(true);
      expect(Array.isArray(group.edges)).toBe(true);
    });
    expect(groups.propagated.descriptionZh).toContain('沿链路传播');
    expect(groups.localEffect.descriptionZh).toContain('本地参数影响');
    expect(groups.blocked.descriptionZh).toContain('阻断当前链路');
    expect(groups.diagnosticOnly.descriptionZh).toContain('只作为诊断观测');
    expect(groups.propagated.edges.map((edge) => edge.id)).toContain('edge-imu-error');
    expect(groups.localEffect.edges.map((edge) => edge.id)).toContain('edge-controller-allocator');
    expect(groups.blocked.edges.map((edge) => edge.id)).toContain('edge-command-shaper');
    expect(groups.diagnosticOnly.edges.length).toBeGreaterThan(0);
    expect(groups.none.edges.length).toBeGreaterThan(0);

    expect(propagatedEdge).toMatchObject({
      propagationKind: 'propagated',
      canPropagateFault: true,
      propagationScopeZh: '沿链路传播到下游测点'
    });
    expect(propagatedEdge.affectedMeasurementPointIds.length).toBeGreaterThan(1);
    expect(propagatedEdge.affectedMeasurementPointIds).toContain(propagatedEdge.measurementPointId);
    expect(blockedEdge).toMatchObject({
      propagationKind: 'blocked',
      canPropagateFault: false,
      propagationScopeZh: '阻断当前链路'
    });
    expect(blockedEdge.affectedMeasurementPointIds).toContain(blockedEdge.measurementPointId);
    expect(localEdge).toMatchObject({
      propagationKind: 'localEffect',
      canPropagateFault: false,
      propagationScopeZh: '本地参数影响，不直接沿线传播',
      affectedMeasurementPointIds: []
    });
    expect(diagnosticEdge).toMatchObject({
      canPropagateFault: false,
      propagationScopeZh: '只作为诊断观测',
      affectedMeasurementPointIds: []
    });
    expect(normalEdge).toMatchObject({
      canPropagateFault: false,
      propagationScopeZh: '正常/未受故障影响',
      affectedMeasurementPointIds: []
    });

    window.setCanvasView('dataflow');
    await flushRuntime();

    const panel = document.getElementById('dataflow-panel');
    expect(panel?.querySelector('[data-testpoint-workbench]')).not.toBeNull();
    expect(panel?.querySelector('[data-propagation-groups]')).toBeNull();
    expect(panel?.textContent).toContain('测点诊断台');
    expect(panel?.textContent).not.toContain('故障传播分区');

    wrapper.unmount();
    return;

    const partition = document.querySelector('[data-propagation-groups]');
    expect(partition).not.toBeNull();
    expect(partition?.textContent).toContain('故障传播分区');
    expect(partition?.textContent).toContain('沿链路传播');
    expect(partition?.textContent).toContain('本地参数影响');
    expect(partition?.textContent).toContain('阻断当前链路');
    expect(partition?.textContent).toContain('只作为诊断观测');
    expect(partition?.querySelector('[data-propagation-group="propagated"]')?.textContent).toContain('edge-imu-error');
    expect(partition?.querySelector('[data-propagation-group="localEffect"]')?.textContent).toContain('edge-controller-allocator');
    expect(partition?.querySelector('[data-propagation-group="blocked"]')?.textContent).toContain('edge-command-shaper');
    ['propagated', 'localEffect', 'blocked', 'diagnosticOnly', 'none'].forEach((kind) => {
      expect(partition?.querySelector(`[data-propagation-group="${kind}"]`)).not.toBeNull();
    });

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
