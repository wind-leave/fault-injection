import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

async function mountWorkbench() {
  const wrapper = mount(App, { attachTo: document.body });
  await flushRuntime();
  return wrapper;
}

function dispatchDoubleClick(target) {
  target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
}

function dispatchClick(target) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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

function getScopeWindows() {
  return [...document.querySelectorAll('.scope-window')];
}

function peakToPeak(samples = []) {
  const values = samples.map((sample) => sample.actual ?? sample.v).filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) - Math.min(...values) : 0;
}

function createCanvasContextStub() {
  return {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    arc() {},
    fillText() {},
    strokeText() {},
    setLineDash() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    setTransform() {},
    createLinearGradient() {
      return {
        addColorStop() {}
      };
    },
    measureText() {
      return { width: 24 };
    }
  };
}

describe('Oscilloscope app integration', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createCanvasContextStub());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.body.innerHTML = '';
    __resetLegacyRuntimeForTests();
  });

  it('opens one floating window per scope node and exposes CH1/CH2 ports', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('instrument_scope', 320, 220);
    window.createNode('instrument_scope', 620, 260);
    await flushRuntime();

    const scopeNodes = [...document.querySelectorAll('.blk.b-inst')];
    expect(scopeNodes).toHaveLength(2);
    expect(scopeNodes[0].querySelectorAll('.node-port--input')).toHaveLength(2);

    dispatchDoubleClick(scopeNodes[0]);
    await flushRuntime();
    dispatchDoubleClick(scopeNodes[1]);
    await flushRuntime();

    const windows = getScopeWindows();
    expect(windows).toHaveLength(2);
    expect(windows[0].dataset.scopeId).not.toBe(windows[1].dataset.scopeId);

    wrapper.unmount();
  });

  it('opens waveform readouts for the imported fault-injected eVTOL demo package', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_small_nonlinear_fault_injected.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.modelNodes.some((node) => node.injectedFault)).toBe(true);

    window.simInit(true);
    for (let step = 0; step < 8; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    window.openScope('node-11');
    await flushRuntime();

    const scopeWindow = document.querySelector('.scope-window[data-scope-id="node-11"]');
    expect(scopeWindow).not.toBeNull();
    expect(scopeWindow?.querySelector('[data-scope-tag="ch1"]')?.getAttribute('data-connected')).toBe('true');
    expect(scopeWindow?.querySelector('[data-scope-tag="ch2"]')?.getAttribute('data-connected')).toBe('true');
    expect(scopeWindow?.querySelector('[data-scope-channel="ch1"] [data-field="current"]')?.textContent?.trim()).not.toBe('--');
    expect(scopeWindow?.querySelector('[data-scope-channel="ch2"] [data-field="current"]')?.textContent?.trim()).not.toBe('--');

    wrapper.unmount();
  });

  it('imports the compact fault scope demo with prewired scope waveforms', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_fault_scope_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.modelNodes.some((node) => node.injectedFault?.modelId === 'motor_efficiency_loss')).toBe(true);
    expect(window.__GZ_STATE__.modelEdges.filter((edge) => edge.targetNodeId === 'demo-scope')).toHaveLength(2);

    window.simInit(true);
    for (let step = 0; step < 10; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    window.openScope('demo-scope');
    await flushRuntime();

    const scopeWindow = document.querySelector('.scope-window[data-scope-id="demo-scope"]');
    expect(scopeWindow).not.toBeNull();
    expect(scopeWindow?.querySelector('[data-scope-channel="ch1"] [data-field="pp"]')?.textContent?.trim()).not.toBe('--');
    expect(scopeWindow?.querySelector('[data-scope-channel="ch2"] [data-field="pp"]')?.textContent?.trim()).not.toBe('--');

    wrapper.unmount();
  });

  it('imports a normal-versus-fault comparison demo and shows different scope amplitudes', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_fault_comparison_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.modelNodes.some((node) => node.id === 'compare-normal-motor' && !node.injectedFault)).toBe(true);
    expect(window.__GZ_STATE__.modelNodes.some((node) => node.id === 'compare-fault-motor' && node.injectedFault?.modelId === 'motor_efficiency_loss')).toBe(true);
    expect(window.__GZ_STATE__.modelEdges.filter((edge) => edge.targetNodeId === 'compare-scope')).toHaveLength(2);

    window.simInit(true);
    for (let step = 0; step < 28; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    window.selectNode('compare-scope');
    await flushRuntime();

    expect(document.querySelector('[data-scope-panel-channel="ch1"]')?.textContent).toContain('正常响应');
    expect(document.querySelector('[data-scope-panel-channel="ch2"]')?.textContent).toContain('故障响应');

    window.openScope('compare-scope');
    await flushRuntime();

    const scopeWindow = document.querySelector('.scope-window[data-scope-id="compare-scope"]');
    expect(scopeWindow).not.toBeNull();
    expect(scopeWindow?.querySelector('[data-scope-tag="ch1"]')?.getAttribute('data-connected')).toBe('true');
    expect(scopeWindow?.querySelector('[data-scope-tag="ch2"]')?.getAttribute('data-connected')).toBe('true');

    const samples = window.__GZ_SIM__.actual.scopeSamples['compare-scope'];
    const normalPeak = peakToPeak(samples.ch1);
    const faultPeak = peakToPeak(samples.ch2);
    expect(normalPeak).toBeGreaterThan(0.1);
    expect(faultPeak).toBeGreaterThan(0.1);
    expect(faultPeak).toBeLessThan(normalPeak * 0.8);

    wrapper.unmount();
  });

  it('records logger and spectrum instrument samples with dedicated inspectors', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_fault_comparison_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(window.__GZ_STATE__.modelNodes.some((node) => node.type === 'instrument_logger')).toBe(true);
    expect(window.__GZ_STATE__.modelNodes.some((node) => node.type === 'instrument_spectrum')).toBe(true);

    window.simInit(true);
    for (let step = 0; step < 16; step += 1) {
      window.simStep();
    }
    await flushRuntime();

    const loggerSamples = window.__GZ_SIM__.actual.instrumentSamples?.['compare-logger'] ?? [];
    const spectrumSamples = window.__GZ_SIM__.actual.instrumentSamples?.['compare-spectrum'] ?? [];
    expect(loggerSamples.length).toBeGreaterThan(0);
    expect(spectrumSamples.length).toBeGreaterThan(0);

    window.selectNode('compare-logger');
    await flushRuntime();

    const loggerPanel = document.querySelector('[data-instrument-panel="logger"]');
    expect(loggerPanel).not.toBeNull();
    expect(loggerPanel?.textContent).toContain('数据记录仪');
    expect(loggerPanel?.textContent).toContain('记录样本');
    expect(loggerPanel?.textContent).toContain('导出数据');
    expect(loggerPanel?.querySelectorAll('[data-instrument-row]').length).toBeGreaterThan(0);

    dispatchClick(loggerPanel.querySelector('[data-instrument-action="export"]'));
    await flushRuntime();
    expect(window.__GZ_LAST_INSTRUMENT_EXPORT__?.nodeId).toBe('compare-logger');
    expect(window.__GZ_LAST_INSTRUMENT_EXPORT__?.csv).toContain('time,actual,reference');

    window.selectNode('compare-spectrum');
    await flushRuntime();

    const spectrumPanel = document.querySelector('[data-instrument-panel="spectrum"]');
    expect(spectrumPanel).not.toBeNull();
    expect(spectrumPanel?.textContent).toContain('频谱分析仪');
    expect(spectrumPanel?.textContent).toContain('峰值频点');
    expect(spectrumPanel?.querySelectorAll('[data-spectrum-bin]').length).toBeGreaterThan(0);

    wrapper.unmount();
  });

  it('renders dedicated scope property actions that open waveform windows', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_fault_scope_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });

    window.selectNode('demo-scope');
    await flushRuntime();

    const openButton = document.querySelector('[data-scope-action="open"]');
    expect(openButton).not.toBeNull();
    expect(openButton?.textContent).toContain('查看波形');
    expect(document.querySelector('[data-scope-panel="oscilloscope"]')).not.toBeNull();
    expect(document.querySelector('[data-scope-panel-channel="ch1"]')?.textContent).toContain('故障响应');
    expect(document.querySelector('[data-scope-panel-channel="ch2"]')?.textContent).toContain('指令输入');

    dispatchClick(openButton);
    await flushRuntime();

    expect(document.querySelector('.scope-window[data-scope-id="demo-scope"]')).not.toBeNull();

    wrapper.unmount();
  });

  it('focuses an existing scope window when the same node is reopened', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('instrument_scope', 420, 240);
    await flushRuntime();

    const scopeNode = document.querySelector('.blk.b-inst');
    const scopeId = scopeNode.id.replace('b-', '');

    dispatchDoubleClick(scopeNode);
    await flushRuntime();
    const firstWindow = document.querySelector(`.scope-window[data-scope-id="${scopeId}"]`);
    const originalZ = Number(firstWindow?.style.zIndex || 0);

    dispatchDoubleClick(scopeNode);
    await flushRuntime();

    const reopenedWindows = document.querySelectorAll(`.scope-window[data-scope-id="${scopeId}"]`);
    expect(reopenedWindows).toHaveLength(1);
    expect(Number(reopenedWindows[0].style.zIndex || 0)).toBeGreaterThanOrEqual(originalZ);

    wrapper.unmount();
  });

  it('toggles CH1, CH2, and overlay views while showing per-channel readouts', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('instrument_scope', 460, 260);
    await flushRuntime();

    const scopeNode = document.querySelector('.blk.b-inst');
    const scopeId = scopeNode.id.replace('b-', '');
    window.__GZ_SIM__.actual.scopeSamples[scopeId] = {
      ch1: [
        { t: 0, actual: -1.236 },
        { t: 1, actual: 1.234567 }
      ],
      ch2: [
        { t: 0, actual: -0.505 },
        { t: 1, actual: 0.5049 }
      ]
    };

    dispatchDoubleClick(scopeNode);
    await flushRuntime();

    const ch2Button = document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-mode="ch2"]`);
    const overlayButton = document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-mode="overlay"]`);
    expect(ch2Button).not.toBeNull();
    expect(overlayButton).not.toBeNull();

    dispatchClick(ch2Button);
    await flushRuntime();
    dispatchClick(overlayButton);
    await flushRuntime();

    const toolbarLabels = [
      ...document.querySelectorAll(`[data-scope-id="${scopeId}"] [data-scope-mode], [data-scope-id="${scopeId}"] .scope-window__close`)
    ].map((button) => button.textContent?.trim());

    expect(toolbarLabels).toEqual(['关闭 ×', '叠加', 'CH1', 'CH2']);
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-tag="ch1"]`)).not.toBeNull();
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-tag="ch2"]`)).not.toBeNull();
    expect(document.querySelector(`[data-scope-id="${scopeId}"] .scope-window__signals`)).not.toBeNull();
    expect(document.querySelector(`[data-scope-id="${scopeId}"] .scope-window__header-main`)).not.toBeNull();
    expect(document.querySelector(`[data-scope-id="${scopeId}"] .scope-window__header-main .scope-window__close`)).not.toBeNull();
    expect(document.querySelector(`[data-scope-id="${scopeId}"] .scope-window__toolbar[data-scope-toolbar]`)).not.toBeNull();
    expect(document.querySelector(`[data-scope-id="${scopeId}"] .scope-window__header`)?.contains(document.querySelector(`[data-scope-id="${scopeId}"] .scope-window__toolbar`))).toBe(false);
    expect(document.querySelector(`[data-scope-id="${scopeId}"] .scope-window__header`)?.nextElementSibling?.classList.contains('scope-window__toolbar')).toBe(true);
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-mode-group]`)).not.toBeNull();
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-window-group]`)).not.toBeNull();
    expect(document.querySelectorAll(`[data-scope-id="${scopeId}"] .scope-window__control-group`)).toHaveLength(2);
    expect(document.querySelector(`[data-scope-id="${scopeId}"] .scope-window__signal-band`)).not.toBeNull();
    expect(document.querySelector(`[data-scope-id="${scopeId}"] .scope-window__stats`)?.classList.contains('scope-window__stats--strip')).toBe(true);
    expect(document.querySelectorAll(`[data-scope-id="${scopeId}"] .scope-readout.scope-readout--strip`)).toHaveLength(2);
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-tag="ch1"]`)?.getAttribute('title')).toContain('CH1:');
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-tag="ch1"] .scope-window__tag-text`)).not.toBeNull();

    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-channel="ch1"] [data-field="current"]`)?.textContent?.trim()).toBe('1.23');
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-channel="ch1"] [data-field="pp"]`)?.textContent?.trim()).toBe('2.47');
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-channel="ch2"] [data-field="pp"]`)?.textContent?.trim()).toBe('1.01');

    wrapper.unmount();
  });

  it('defaults to realtime playback and draws floating scopes with a fixed sliding time window', async () => {
    const fillTexts = [];
    HTMLCanvasElement.prototype.getContext.mockImplementation(() => ({
      ...createCanvasContextStub(),
      fillText(text) {
        fillTexts.push(String(text));
      }
    }));

    const wrapper = await mountWorkbench();

    expect(document.getElementById('sim-rt')?.checked).toBe(true);
    expect(window.__GZ_SIM__.realtime).toBe(true);

    window.createNode('instrument_scope', 460, 260);
    await flushRuntime();

    const scopeNode = document.querySelector('.blk.b-inst');
    const scopeId = scopeNode.id.replace('b-', '');
    window.__GZ_SIM__.actual.scopeSamples[scopeId] = {
      ch1: Array.from({ length: 11 }, (_, index) => ({ t: index, actual: index })),
      ch2: []
    };

    dispatchDoubleClick(scopeNode);
    await flushRuntime();

    expect(window.__GZ_SIM__.scopeWindows[scopeId].windowSeconds).toBe(4);
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-window-size="4"]`)?.classList.contains('is-active')).toBe(true);
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-window-size="2"]`)).not.toBeNull();
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-window-size="8"]`)).not.toBeNull();
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-window-size="all"]`)).not.toBeNull();
    expect(fillTexts).toContain('6.0s');
    expect(fillTexts).toContain('10.0s');

    fillTexts.length = 0;
    document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-window-size="8"]`)?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }));
    await flushRuntime();

    expect(window.__GZ_SIM__.scopeWindows[scopeId].windowSeconds).toBe(8);
    expect(document.querySelector(`[data-scope-id="${scopeId}"] [data-scope-window-size="8"]`)?.classList.contains('is-active')).toBe(true);
    expect(fillTexts).toContain('2.0s');
    expect(fillTexts).toContain('10.0s');

    wrapper.unmount();
  });

  it('keeps floating scope controls stable while simulation samples update', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    const source = window.createNode('signal_source', 300, 260);
    const scope = window.createNode('instrument_scope', 560, 260);
    const canvas = window.getActiveCanvasRecord();
    canvas.edges.push(window.makeTask5Edge(
      'normal',
      source.id,
      scope.id,
      0,
      0,
      window.getNodePorts(source).outputs[0],
      window.getNodePorts(scope).inputs[0],
      null
    ));
    window.renderEdges();
    await flushRuntime();

    window.openScope(scope.id);
    await flushRuntime();

    document.getElementById('sim-dur').value = '5';
    document.getElementById('sim-step').value = '0.1';
    window.simInit(true);

    const ch2Button = document.querySelector(`[data-scope-id="${scope.id}"] [data-scope-mode="ch2"]`);
    const windowButton = document.querySelector(`[data-scope-id="${scope.id}"] [data-scope-window-size="8"]`);
    expect(ch2Button).not.toBeNull();
    expect(windowButton).not.toBeNull();

    window.runSimulationTick();
    await flushRuntime();

    expect(ch2Button.isConnected).toBe(true);
    expect(windowButton.isConnected).toBe(true);

    let viewportClicks = 0;
    document.getElementById('canvas-viewport').addEventListener('click', () => {
      viewportClicks += 1;
    });

    dispatchClick(ch2Button);
    await flushRuntime();
    expect(window.__GZ_SIM__.scopeWindows[scope.id].mode).toBe('ch2');
    expect(ch2Button.classList.contains('is-active')).toBe(true);
    expect(viewportClicks).toBe(0);

    window.runSimulationTick();
    await flushRuntime();
    expect(ch2Button.isConnected).toBe(true);
    expect(ch2Button.classList.contains('is-active')).toBe(true);

    dispatchClick(windowButton);
    await flushRuntime();
    expect(window.__GZ_SIM__.scopeWindows[scope.id].windowSeconds).toBe(8);
    expect(windowButton.classList.contains('is-active')).toBe(true);

    wrapper.unmount();
  });

  it('shows icons for every simulation toolbar action button', async () => {
    const wrapper = await mountWorkbench();

    const toolbarButtons = [
      document.getElementById('sbtn-init'),
      document.getElementById('sbtn-run'),
      document.getElementById('sbtn-step'),
      document.getElementById('sbtn-pause'),
      document.getElementById('sbtn-stop')
    ];

    expect(toolbarButtons.every(Boolean)).toBe(true);
    toolbarButtons.forEach((button) => {
      const icon = button.querySelector('.sim-btn-icon');
      expect(icon).not.toBeNull();
      expect(icon.textContent?.trim().length).toBeGreaterThan(0);
    });

    wrapper.unmount();
  });

  it('sizes the waveform canvas with device-pixel-ratio awareness', async () => {
    const rectSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      top: 0,
      left: 0,
      right: 320,
      bottom: 180,
      toJSON() {
        return this;
      }
    });

    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      configurable: true
    });

    const wrapper = await mountWorkbench();

    window.createNode('instrument_scope', 420, 240);
    await flushRuntime();

    const scopeNode = document.querySelector('.blk.b-inst');
    dispatchDoubleClick(scopeNode);
    await flushRuntime();

    const waveCanvas = document.querySelector('.scope-window [data-scope-role="wave-canvas"]');
    expect(waveCanvas).not.toBeNull();
    expect(waveCanvas.width).toBe(640);
    expect(waveCanvas.height).toBe(360);

    rectSpy.mockRestore();
    wrapper.unmount();
  });

  it('drags a floating scope window by its header', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('instrument_scope', 400, 240);
    await flushRuntime();

    const scopeNode = document.querySelector('.blk.b-inst');
    dispatchDoubleClick(scopeNode);
    await flushRuntime();

    const scopeWindow = document.querySelector('.scope-window');
    const header = scopeWindow.querySelector('.scope-window__header');
    expect(header.dataset.scopeDragHandle).toBe(scopeWindow.dataset.scopeId);
    const beforeLeft = scopeWindow.style.left;
    const beforeTop = scopeWindow.style.top;

    window.startScopeWindowDrag(
      {
        clientX: 120,
        clientY: 120,
        stopPropagation() {},
        preventDefault() {}
      },
      scopeWindow.dataset.scopeId
    );
    dispatchPointer(document, 'mousemove', { pointerId: 7, clientX: 180, clientY: 168 });
    dispatchPointer(document, 'mouseup', { pointerId: 7, clientX: 180, clientY: 168 });
    await flushRuntime();

    const movedWindow = document.querySelector('.scope-window');
    expect(movedWindow.style.left).not.toBe(beforeLeft);
    expect(movedWindow.style.top).not.toBe(beforeTop);

    wrapper.unmount();
  });

  it('keeps dragging when captured pointer movement is retargeted to the scope header', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('instrument_scope', 400, 240);
    await flushRuntime();

    const scopeNode = document.querySelector('.blk.b-inst');
    dispatchDoubleClick(scopeNode);
    await flushRuntime();

    const scopeWindow = document.querySelector('.scope-window');
    const header = scopeWindow.querySelector('.scope-window__header');
    const title = scopeWindow.querySelector('.scope-window__title');
    const beforeLeft = scopeWindow.style.left;
    const beforeTop = scopeWindow.style.top;

    dispatchPointer(title, 'pointerdown', { pointerId: 41, clientX: 120, clientY: 120 });
    dispatchPointer(header, 'pointermove', { pointerId: 41, clientX: 180, clientY: 168 });
    dispatchPointer(header, 'pointerup', { pointerId: 41, clientX: 180, clientY: 168 });
    await flushRuntime();

    expect(scopeWindow.style.left).not.toBe(beforeLeft);
    expect(scopeWindow.style.top).not.toBe(beforeTop);

    wrapper.unmount();
  });

  it('defers scope canvas redraw while a running simulation window is being dragged', async () => {
    const wrapper = await mountWorkbench();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    expect(window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg)).toMatchObject({ ok: true });
    await flushRuntime();

    document.getElementById('sim-dur').value = '4';
    document.getElementById('sim-step').value = '0.1';
    window.simInit(true);
    for (let step = 0; step < 4; step += 1) {
      window.simStep();
    }
    window.openScope('node-scope');
    window.simRun();
    await flushRuntime();

    const getContextMock = HTMLCanvasElement.prototype.getContext;
    getContextMock.mockClear();

    const scopeWindow = document.querySelector('.scope-window[data-scope-id="node-scope"]');
    const header = scopeWindow.querySelector('[data-scope-drag-handle]');
    const beforeLeft = scopeWindow.style.left;

    dispatchPointer(header, 'pointerdown', { pointerId: 77, clientX: 120, clientY: 120 });
    dispatchPointer(window, 'pointermove', { pointerId: 77, clientX: 180, clientY: 160 });
    window.runSimulationTick();
    window.runSimulationTick();
    await flushRuntime();

    expect(scopeWindow.style.left).not.toBe(beforeLeft);
    expect(getContextMock).not.toHaveBeenCalled();

    dispatchPointer(window, 'pointerup', { pointerId: 77, clientX: 180, clientY: 160 });
    await flushRuntime();

    expect(getContextMock).toHaveBeenCalled();
    window.simStop('stopped');
    wrapper.unmount();
  });

  it('opens scope windows below the simulation toolbar and clamps upward dragging', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('instrument_scope', 360, 220);
    await flushRuntime();

    const scopeNode = document.querySelector('.blk.b-inst');
    dispatchDoubleClick(scopeNode);
    await flushRuntime();

    const scopeWindow = document.querySelector('.scope-window');
    const initialTop = Number.parseInt(scopeWindow.style.top || '0', 10);
    expect(initialTop).toBeGreaterThanOrEqual(96);

    window.startScopeWindowDrag(
      {
        clientX: 180,
        clientY: initialTop + 12,
        stopPropagation() {},
        preventDefault() {}
      },
      scopeWindow.dataset.scopeId
    );
    dispatchPointer(document, 'mousemove', { pointerId: 9, clientX: 150, clientY: 0 });
    dispatchPointer(document, 'mouseup', { pointerId: 9, clientX: 150, clientY: 0 });
    await flushRuntime();

    const movedTop = Number.parseInt(document.querySelector('.scope-window').style.top || '0', 10);
    expect(movedTop).toBeGreaterThanOrEqual(96);

    wrapper.unmount();
  });

  it('keeps the close button stable on press and closes the scope window', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('instrument_scope', 420, 260);
    await flushRuntime();

    const scopeNode = document.querySelector('.blk.b-inst');
    dispatchDoubleClick(scopeNode);
    await flushRuntime();

    const closeButton = document.querySelector('.scope-window__close');
    dispatchPointer(closeButton, 'pointerdown', { pointerId: 11, clientX: 24, clientY: 24 });
    await flushRuntime();

    expect(document.querySelector('.scope-window__close')).toBe(closeButton);

    dispatchClick(closeButton);
    await flushRuntime();

    expect(document.querySelector('.scope-window')).toBeNull();

    wrapper.unmount();
  });

  it('does not start dragging when scope header action buttons are pressed', async () => {
    const wrapper = await mountWorkbench();

    window.createNode('instrument_scope', 420, 260);
    await flushRuntime();

    const scopeNode = document.querySelector('.blk.b-inst');
    dispatchDoubleClick(scopeNode);
    await flushRuntime();

    const scopeWindow = document.querySelector('.scope-window');
    const beforeLeft = scopeWindow.style.left;
    const beforeTop = scopeWindow.style.top;
    const clearButton = scopeWindow.querySelector('.scope-window__clear');
    const closeButton = scopeWindow.querySelector('.scope-window__close');

    dispatchPointer(clearButton, 'pointerdown', { pointerId: 31, clientX: 480, clientY: 124 });
    dispatchPointer(window, 'pointermove', { pointerId: 31, clientX: 620, clientY: 230 });
    dispatchPointer(window, 'pointerup', { pointerId: 31, clientX: 620, clientY: 230 });
    await flushRuntime();

    expect(scopeWindow.style.left).toBe(beforeLeft);
    expect(scopeWindow.style.top).toBe(beforeTop);

    dispatchPointer(closeButton, 'pointerdown', { pointerId: 32, clientX: 540, clientY: 124 });
    dispatchPointer(window, 'pointermove', { pointerId: 32, clientX: 680, clientY: 230 });
    dispatchPointer(window, 'pointerup', { pointerId: 32, clientX: 680, clientY: 230 });
    await flushRuntime();

    expect(scopeWindow.style.left).toBe(beforeLeft);
    expect(scopeWindow.style.top).toBe(beforeTop);

    dispatchClick(closeButton);
    await flushRuntime();

    expect(document.querySelector('.scope-window')).toBeNull();

    wrapper.unmount();
  });
});
