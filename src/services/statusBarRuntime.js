const LEVEL_SEQUENCE = ['all', 'info', 'ok', 'warn', 'error'];
const LEVEL_LABELS = {
  all: '全部级别',
  info: '信息',
  ok: '成功',
  warn: '警告',
  error: '错误'
};
const LEVEL_BADGE_CLASS = {
  info: 'sbar-badge--info',
  ok: 'sbar-badge--ok',
  warn: 'sbar-badge--warn',
  error: 'sbar-badge--error'
};
const EMPTY_LABELS = {
  log: '暂无匹配记录',
  alerts: '暂无告警记录',
  results: '暂无仿真结果',
  performance: '暂无性能趋势'
};

let boundRoot = null;
let boundHandler = null;
let boundMetricObserver = null;
let metricSyncScheduled = false;

function getRoot() {
  return document.querySelector('.sbar');
}

function getRows(root = getRoot()) {
  return Array.from(root?.querySelectorAll('[data-log-entry]') || []);
}

function getTable(root = getRoot()) {
  return root?.querySelector('.sbar-log-table') || null;
}

function getEmpty(root = getRoot()) {
  return root?.querySelector('[data-status-empty]') || null;
}

function toMetricNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseMetricNumbers(text = '') {
  return Array.from(String(text).matchAll(/\d+/g)).map((match) => Number(match[0]));
}

function appendMetricNumber(target, value) {
  const number = document.createElement('span');
  number.className = 'sbar-metric-number';
  number.textContent = String(toMetricNumber(value));
  target.append(number);
}

function appendMetricUnit(target, text) {
  const unit = document.createElement('span');
  unit.className = 'sbar-metric-unit';
  unit.textContent = text;
  target.append(unit);
}

function appendMetricSeparator(target) {
  const separator = document.createElement('span');
  separator.className = 'sbar-metric-sep';
  separator.textContent = '·';
  target.append(separator);
}

function renderComponentMetric(target, components, links) {
  if (!target) {
    return;
  }
  target.classList.add('sbar-metric-line');
  target.replaceChildren();
  appendMetricNumber(target, components);
  appendMetricUnit(target, '组件');
  appendMetricSeparator(target);
  appendMetricNumber(target, links);
  appendMetricUnit(target, '连线');
}

function renderFaultMetric(target, faults) {
  if (!target) {
    return;
  }
  target.classList.add('sbar-metric-line');
  target.replaceChildren();
  appendMetricNumber(target, faults);
  appendMetricUnit(target, '故障');
}

function updateStatePill(state) {
  const statePill = document.querySelector('.sbar-state');
  const dot = document.getElementById('sdot');
  if (!statePill || typeof state !== 'string') {
    return;
  }
  statePill.replaceChildren();
  if (dot) {
    statePill.append(dot);
  }
  statePill.append(document.createTextNode(state));
}

function readMetricsFromText() {
  const componentNumbers = parseMetricNumbers(document.getElementById('sblk')?.textContent || '');
  const faultNumbers = parseMetricNumbers(document.getElementById('sflt')?.textContent || '');
  return {
    components: componentNumbers[0] ?? 0,
    links: componentNumbers[1] ?? 0,
    faults: faultNumbers[0] ?? 0
  };
}

function metricsNeedFormatting() {
  const components = document.getElementById('sblk');
  const faults = document.getElementById('sflt');
  return Boolean(
    components &&
      faults &&
      (!components.querySelector('.sbar-metric-number') || !faults.querySelector('.sbar-metric-number'))
  );
}

export function formatStatusMetrics(metrics = {}) {
  const root = getRoot();
  if (!root) {
    return { ok: false, reason: 'missing-statusbar' };
  }
  const current = readMetricsFromText();
  const next = {
    components: toMetricNumber(metrics.components, current.components),
    links: toMetricNumber(metrics.links, current.links),
    faults: toMetricNumber(metrics.faults, current.faults),
    state: metrics.state,
    time: metrics.time
  };

  renderComponentMetric(document.getElementById('sblk'), next.components, next.links);
  renderFaultMetric(document.getElementById('sflt'), next.faults);
  updateStatePill(next.state);

  const timeEl = root.querySelector('.sbar-time');
  if (timeEl && typeof next.time === 'string') {
    timeEl.textContent = next.time;
  }

  return { ok: true, metrics: next };
}

function scheduleMetricFormatting() {
  if (metricSyncScheduled) {
    return;
  }
  metricSyncScheduled = true;
  const enqueue = window.queueMicrotask || ((callback) => Promise.resolve().then(callback));
  enqueue(() => {
    metricSyncScheduled = false;
    if (metricsNeedFormatting()) {
      formatStatusMetrics(readMetricsFromText());
    }
  });
}

function bindMetricFormattingObserver(root) {
  boundMetricObserver?.disconnect();
  boundMetricObserver = null;
  formatStatusMetrics(readMetricsFromText());
  if (typeof MutationObserver === 'undefined') {
    return;
  }
  const targets = [document.getElementById('sblk'), document.getElementById('sflt')].filter(Boolean);
  if (targets.length === 0) {
    return;
  }
  boundMetricObserver = new MutationObserver(scheduleMetricFormatting);
  for (const target of targets) {
    boundMetricObserver.observe(target, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
}

function setEmptyState(root, visible, text) {
  const empty = getEmpty(root);
  if (!empty) {
    return;
  }
  empty.textContent = text;
  empty.classList.toggle('is-hidden', !visible);
}

function syncLevelButton(root, level) {
  const button = root?.querySelector('[data-status-action="level"]');
  if (!button) {
    return;
  }
  button.dataset.level = level;
  button.textContent = LEVEL_LABELS[level] || LEVEL_LABELS.all;
  button.setAttribute('aria-label', `日志级别过滤：${button.textContent}`);
}

function refreshRows(root = getRoot()) {
  if (!root) {
    return { visibleCount: 0 };
  }
  const view = root.dataset.activeView || 'log';
  const level = root.dataset.filterLevel || 'all';
  const cleared = root.dataset.logCleared === 'true';
  let visibleCount = 0;

  for (const row of getRows(root)) {
    const rowView = row.dataset.view || 'log';
    const rowLevel = row.dataset.level || 'info';
    const matchesView = rowView === view;
    const matchesLevel = level === 'all' || rowLevel === level;
    const visible = !cleared && matchesView && matchesLevel;
    row.classList.toggle('is-hidden', !visible);
    if (visible) {
      visibleCount += 1;
    }
  }

  const emptyText = cleared ? '日志已清空 · 新事件会继续显示' : EMPTY_LABELS[view] || EMPTY_LABELS.log;
  setEmptyState(root, visibleCount === 0, emptyText);
  syncLevelButton(root, level);
  return { visibleCount, view, level, cleared };
}

export function applyLevelFilter(level = 'all') {
  const root = getRoot();
  if (!root) {
    return { ok: false, reason: 'missing-statusbar' };
  }
  const nextLevel = LEVEL_SEQUENCE.includes(level) ? level : 'all';
  root.dataset.filterLevel = nextLevel;
  return { ok: true, ...refreshRows(root) };
}

export function cycleLevelFilter() {
  const root = getRoot();
  if (!root) {
    return { ok: false, reason: 'missing-statusbar' };
  }
  const current = root.dataset.filterLevel || 'all';
  const currentIndex = LEVEL_SEQUENCE.indexOf(current);
  const nextLevel = LEVEL_SEQUENCE[(currentIndex + 1) % LEVEL_SEQUENCE.length] || 'all';
  return applyLevelFilter(nextLevel);
}

export function selectStatusView(view = 'log') {
  const root = getRoot();
  if (!root) {
    return { ok: false, reason: 'missing-statusbar' };
  }
  root.dataset.activeView = view;
  root.dataset.logCleared = 'false';
  for (const tab of root.querySelectorAll('[data-status-tab]')) {
    const active = tab.dataset.statusTab === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  return { ok: true, ...refreshRows(root) };
}

export function clearStatusLog() {
  const root = getRoot();
  if (!root) {
    return { ok: false, reason: 'missing-statusbar' };
  }
  root.dataset.logCleared = 'true';
  const statusText = document.getElementById('stxt');
  if (statusText) {
    statusText.textContent = '日志已清空 · 新事件会继续显示';
  }
  return { ok: true, ...refreshRows(root) };
}

export function exportStatusLog(options = {}) {
  const root = getRoot();
  if (!root) {
    return { ok: false, reason: 'missing-statusbar', content: '' };
  }
  const lines = ['时间,级别,来源,消息'];
  for (const row of getRows(root)) {
    const cells = Array.from(row.children).map((cell) => `"${cell.textContent.trim().replaceAll('"', '""')}"`);
    lines.push(cells.join(','));
  }
  const content = lines.join('\n');

  const userAgent = window.navigator?.userAgent || '';
  const shouldDownload = options.download !== false && !/jsdom/i.test(userAgent);
  if (shouldDownload && typeof Blob !== 'undefined' && window.URL?.createObjectURL) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const href = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'gz-status-log.csv';
    link.click();
    window.setTimeout(() => window.URL.revokeObjectURL(href), 0);
  }

  return { ok: true, content };
}

function formatStatusTime(date = new Date()) {
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function pushStatusEntry(entry = {}) {
  const root = getRoot();
  const table = getTable(root);
  if (!root || !table) {
    return { ok: false, reason: 'missing-statusbar' };
  }
  const level = LEVEL_LABELS[entry.level] && entry.level !== 'all' ? entry.level : 'info';
  const view = entry.view || (level === 'warn' || level === 'error' ? 'alerts' : 'log');
  const row = document.createElement('div');
  row.className = 'sbar-row';
  row.dataset.logEntry = '';
  row.dataset.level = level;
  row.dataset.view = view;

  const time = document.createElement('span');
  time.textContent = entry.time || formatStatusTime();
  const badgeCell = document.createElement('span');
  badgeCell.className = `sbar-badge ${LEVEL_BADGE_CLASS[level] || LEVEL_BADGE_CLASS.info}`;
  badgeCell.textContent = LEVEL_LABELS[level] || LEVEL_LABELS.info;
  const source = document.createElement('span');
  source.textContent = entry.source || '系统';
  const message = document.createElement('span');
  message.textContent = entry.message || '状态更新';

  row.append(time, badgeCell, source, message);
  const empty = getEmpty(root);
  table.insertBefore(row, empty || null);

  const rows = getRows(root);
  for (const staleRow of rows.slice(60)) {
    staleRow.remove();
  }

  root.dataset.logCleared = 'false';
  refreshRows(root);
  return { ok: true, row };
}

function formatSimulationNumber(value, fractionDigits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0';
  }
  return Number(number.toFixed(fractionDigits)).toString();
}

function normalizeSimulationSummary(summary = {}) {
  const duration = formatSimulationNumber(summary.duration, 2);
  const elapsedSeconds = formatSimulationNumber(summary.elapsedSeconds ?? summary.time ?? 0, 2);
  const stepSize = formatSimulationNumber(summary.stepSize, 4);
  return {
    datasetName: String(summary.datasetName || summary.name || 'test'),
    duration,
    elapsedSeconds,
    faults: toMetricNumber(summary.faults, 0),
    sampleRate: String(summary.sampleRate || '-'),
    status: String(summary.status || 'updated'),
    stepIndex: toMetricNumber(summary.stepIndex, 0),
    stepSize
  };
}

export function publishSimulationSummary(summary = {}) {
  const normalized = normalizeSimulationSummary(summary);
  const result = pushStatusEntry({
    level: normalized.status === 'completed' ? 'ok' : 'info',
    source: '仿真结果',
    view: 'results',
    message: `${normalized.datasetName} · ${normalized.status} · ${normalized.stepIndex} steps · ${normalized.duration}s · faults ${normalized.faults}`
  });
  const performance = pushStatusEntry({
    level: 'info',
    source: '性能趋势',
    view: 'performance',
    message: `${normalized.datasetName} · ${normalized.sampleRate} · elapsed ${normalized.elapsedSeconds}s · step ${normalized.stepSize}s · ${normalized.stepIndex} samples`
  });
  return {
    ok: result.ok && performance.ok,
    performance,
    result,
    summary: normalized
  };
}

function handleStatusBarClick(event) {
  const tab = event.target.closest?.('[data-status-tab]');
  if (tab) {
    selectStatusView(tab.dataset.statusTab || 'log');
    return;
  }
  const action = event.target.closest?.('[data-status-action]');
  if (!action) {
    return;
  }
  if (action.dataset.statusAction === 'clear') {
    clearStatusLog();
  } else if (action.dataset.statusAction === 'level') {
    cycleLevelFilter();
  } else if (action.dataset.statusAction === 'export') {
    exportStatusLog();
  }
}

export function bindStatusBarInteractions() {
  const root = getRoot();
  if (!root || root === boundRoot) {
    return;
  }
  unbindStatusBarInteractions();
  boundRoot = root;
  boundHandler = handleStatusBarClick;
  boundRoot.addEventListener('click', boundHandler);
  root.dataset.activeView = root.dataset.activeView || 'log';
  root.dataset.filterLevel = root.dataset.filterLevel || 'all';
  root.dataset.logCleared = root.dataset.logCleared || 'false';
  bindMetricFormattingObserver(root);
  refreshRows(root);
  window.__GZ_STATUS_BAR__ = {
    applyLevelFilter,
    bind: bindStatusBarInteractions,
    clear: clearStatusLog,
    cycleLevelFilter,
    exportLog: exportStatusLog,
    formatMetrics: formatStatusMetrics,
    pushEntry: pushStatusEntry,
    publishSimulationSummary,
    refresh: refreshRows,
    selectView: selectStatusView,
    unbind: unbindStatusBarInteractions
  };
}

export function unbindStatusBarInteractions() {
  if (boundRoot && boundHandler) {
    boundRoot.removeEventListener('click', boundHandler);
  }
  boundMetricObserver?.disconnect();
  boundMetricObserver = null;
  boundRoot = null;
  boundHandler = null;
}
