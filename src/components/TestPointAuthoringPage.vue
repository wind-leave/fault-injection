<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const isOpen = ref(false);
const context = ref(null);
const points = ref([]);
const selectedPointId = ref('');
const activeScenarioKeys = ref([]);
const notice = ref('');

const selectedPoint = computed(() => points.value.find((point) => point.pointId === selectedPointId.value || point.id === selectedPointId.value) || null);
const conditions = computed(() => context.value?.conditions || []);
const faultGroups = computed(() => context.value?.faultGroups || []);
const faultIds = computed(() => faultGroups.value.flatMap((group) => group.faults.map((fault) => fault.id)));
const scenarios = computed(() => {
  const api = window.__GZ_DIAGNOSTIC_CONDITIONS__;
  return api?.getScenarios?.(selectedPoint.value?.conditionKeys || []) || [];
});
const activeScenarios = computed(() => {
  const selected = new Set(activeScenarioKeys.value);
  return scenarios.value.filter((scenario) => selected.has(scenarioKey(scenario)));
});
const hasActiveScenarios = computed(() => activeScenarios.value.length > 0);
const scenarioSelectionLabel = computed(() => {
  if (!hasActiveScenarios.value) return '基础检测能力（默认）';
  if (activeScenarios.value.length === 1) return scenarioLabel(activeScenarios.value[0]);
  return `已选择 ${activeScenarios.value.length} 个工况`;
});
const pointOptions = computed(() => points.value.map((point, index) => ({
  id: point.pointId || point.id,
  label: `${point.shortName || `M${index + 1}`} · ${point.name || '未命名测点'}`
})));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePointDraft(point = {}, index = 0) {
  const pointId = point.pointId || point.id || `draft-test-point-${index + 1}`;
  return {
    ...point,
    pointId,
    id: point.id || pointId,
    shortName: point.shortName || `M${index + 1}`,
    name: point.name || point.nameZh || point.labelZh || '',
    pointType: point.pointType === 'physical' ? 'physical' : 'virtual',
    detects: Array.isArray(point.detects) ? [...point.detects] : [],
    conditionKeys: Array.isArray(point.conditionKeys) ? [...point.conditionKeys] : [],
    detectabilityRules: Array.isArray(point.detectabilityRules) ? clone(point.detectabilityRules) : []
  };
}

function getFallbackContext(edgeId) {
  const state = window.__GZ_STATE__ || {};
  const edges = [
    ...(Array.isArray(state.modelEdges) ? state.modelEdges : []),
    ...(Array.isArray(state.edges) ? state.edges : []),
    ...Object.values(state.canvases || {}).flatMap((canvas) => Array.isArray(canvas?.edges) ? canvas.edges : [])
  ];
  const edge = edges.find((item) => item?.id === edgeId) || null;
  const nodes = [
    ...(Array.isArray(state.modelNodes) ? state.modelNodes : []),
    ...(Array.isArray(state.nodes) ? state.nodes : []),
    ...Object.values(state.canvases || {}).flatMap((canvas) => Array.isArray(canvas?.nodes) ? canvas.nodes : [])
  ];
  const nodeName = (nodeId) => nodes.find((node) => node?.id === nodeId)?.props?.name || nodeId || '';
  const pointSources = [state.manualDiagnosticTestPoints, state.diagnosticTestPoints, state.testPoints]
    .filter(Array.isArray)
    .flat();
  const points = edge ? pointSources.filter((point) => (
    (point?.edgeId || point?.edgeID || point?.targetEdgeId) === edge.id
  )) : [];
  const faults = (state.availableFaultModels || state.importedFaultModels || [])
    .map((fault) => ({ id: fault?.id || fault?.faultTypeId || fault?.modelId, label: fault?.displayName || fault?.name || fault?.id }))
    .filter((fault) => fault.id);
  return {
    edge: {
      id: edge?.id || edgeId || '',
      label: edge?.label || edge?.signalName || edge?.signalId || '当前连线',
      sourceName: nodeName(edge?.sourceNodeId),
      targetName: nodeName(edge?.targetNodeId)
    },
    points,
    faultGroups: faults.length ? [{ componentId: 'fallback-faults', componentName: '可用故障', faults }] : [],
    conditions: (window.__GZ_DIAGNOSTIC_CONDITIONS__?.getConditions?.() || []).map((condition) => ({
      key: condition.key,
      label: condition.label || condition.key,
      options: Array.isArray(condition.options) ? condition.options : []
    }))
  };
}

function scenarioKey(scenario) {
  return JSON.stringify(scenario?.when || {});
}

function matchingRule(point, faultId, scenario) {
  const key = scenarioKey(scenario);
  return (point?.detectabilityRules || []).find((rule) => (
    (rule.faultId || rule.faultTypeId) === faultId
    && JSON.stringify(rule.when || {}) === key
  )) || null;
}

function ruleDetectable(point, faultId, scenario) {
  const rule = matchingRule(point, faultId, scenario);
  return rule ? Boolean(rule.detectable) : (point?.detects || []).includes(faultId);
}

function setRuleDetectability(point, faultId, scenario, detectable) {
  if (!point) return;
  const key = scenarioKey(scenario);
  const index = (point.detectabilityRules || []).findIndex((rule) => (
    (rule.faultId || rule.faultTypeId) === faultId
    && JSON.stringify(rule.when || {}) === key
  ));
  const next = { faultId, when: clone(scenario.when || {}), detectable: Boolean(detectable) };
  if (index === -1) point.detectabilityRules = [...(point.detectabilityRules || []), next];
  else point.detectabilityRules.splice(index, 1, next);
}

function setBaseDetectability(point, faultId, detectable) {
  if (!point) return;
  const selected = new Set(point.detects || []);
  if (detectable) selected.add(faultId);
  else selected.delete(faultId);
  point.detects = [...selected];
}

function scenarioLabel(scenario) {
  return scenario.label || Object.entries(scenario.when || {}).map(([key, value]) => `${key}=${value}`).join('，') || '默认工况';
}

function switchPoint() {
  activeScenarioKeys.value = [];
  notice.value = '';
}

function changeConditions() {
  const point = selectedPoint.value;
  if (!point) return;
  const allowed = new Set(scenarios.value.map(scenarioKey));
  point.detectabilityRules = (point.detectabilityRules || []).filter((rule) => allowed.has(JSON.stringify(rule.when || {})));
  activeScenarioKeys.value = activeScenarioKeys.value.filter((key) => allowed.has(key));
}

function scenarioFaultDetectable(point, faultId) {
  return activeScenarios.value.every((scenario) => ruleDetectable(point, faultId, scenario));
}

function setScenarioFaultDetectability(point, faultId, detectable) {
  if (!point) return;
  activeScenarios.value.forEach((scenario) => {
    setRuleDetectability(point, faultId, scenario, detectable);
  });
}

function openPage(event) {
  const edgeId = event?.detail?.edgeId || window.__GZ_STATE__?.selEdge || '';
  const nextContext = window.__GZ_TEST_POINT_AUTHORING__?.getContext?.(edgeId) || getFallbackContext(edgeId);
  context.value = nextContext;
  points.value = (nextContext.points || []).map(normalizePointDraft);
  if (points.value.length) {
    selectedPointId.value = event?.detail?.pointId && points.value.some((point) => (point.pointId || point.id) === event.detail.pointId)
      ? event.detail.pointId
      : (points.value[0].pointId || points.value[0].id);
    switchPoint();
  } else {
    selectedPointId.value = '';
    activeScenarioKeys.value = [];
    notice.value = '当前连线尚未配置测点；点击“新增测点”后创建草稿。';
  }
  isOpen.value = true;
  nextTick(() => document.querySelector('[data-testpoint-authoring-close]')?.focus());
}

function closePage() {
  isOpen.value = false;
  context.value = null;
  points.value = [];
  notice.value = '';
}

function addPoint() {
  const edgeId = context.value?.edge?.id;
  if (!edgeId) return;
  const draft = window.__GZ_TEST_POINT_AUTHORING__?.createDraft?.(edgeId, points.value.map((point) => point.pointId || point.id));
  if (!draft) return;
  const normalizedDraft = normalizePointDraft(draft, points.value.length);
  points.value.push(normalizedDraft);
  selectedPointId.value = normalizedDraft.pointId || normalizedDraft.id;
  activeScenarioKeys.value = [];
  notice.value = '已新增草稿测点，点击“保存测点”后才会生效。';
}

function savePoint() {
  const point = selectedPoint.value;
  if (!point || !context.value?.edge?.id) return;
  const result = window.__GZ_TEST_POINT_AUTHORING__?.save?.(context.value.edge.id, clone(point));
  if (!result?.ok) {
    notice.value = result?.message || '保存失败，请稍后重试。';
    return;
  }
  const nextContext = window.__GZ_TEST_POINT_AUTHORING__?.getContext?.(context.value.edge.id);
  context.value = nextContext || context.value;
  points.value = (nextContext?.points || points.value).map(normalizePointDraft);
  selectedPointId.value = result.pointId;
  switchPoint();
  notice.value = '测点已保存，右侧测点设置和检测矩阵已同步更新。';
}

function deletePoint() {
  const point = selectedPoint.value;
  if (!point || !context.value?.edge?.id) return;
  const pointId = point.pointId || point.id;
  const saved = (context.value.points || []).some((item) => (item.pointId || item.id) === pointId);
  if (!saved) {
    points.value = points.value.filter((item) => (item.pointId || item.id) !== pointId);
    selectedPointId.value = points.value[0]?.pointId || points.value[0]?.id || '';
    switchPoint();
    notice.value = '已移除未保存的测点草稿。';
    return;
  }
  if (!window.confirm(`确定删除测点“${point.name || point.shortName || pointId}”吗？`)) return;
  const result = window.__GZ_TEST_POINT_AUTHORING__?.delete?.(context.value.edge.id, pointId);
  if (!result?.ok) {
    notice.value = result?.message || '该测点不能删除。';
    return;
  }
  const nextContext = window.__GZ_TEST_POINT_AUTHORING__?.getContext?.(context.value.edge.id);
  context.value = nextContext || context.value;
  points.value = (nextContext?.points || []).map(normalizePointDraft);
  selectedPointId.value = points.value[0]?.pointId || points.value[0]?.id || '';
  switchPoint();
  notice.value = '测点已删除。';
}

function handleKeydown(event) {
  if (isOpen.value && event.key === 'Escape') closePage();
}

onMounted(() => {
  window.addEventListener('gz:open-testpoint-authoring', openPage);
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('gz:open-testpoint-authoring', openPage);
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="testpoint-authoring-overlay">
    <section class="testpoint-authoring-page" data-testid="testpoint-authoring-page" role="dialog" aria-modal="true" aria-label="测点配置页面">
      <header class="testpoint-authoring-page__header">
        <div>
          <span class="testpoint-authoring-page__eyebrow">连线测点配置</span>
          <h1>测点设置</h1>
          <p>{{ context?.edge?.sourceName }} → {{ context?.edge?.targetName }} · {{ context?.edge?.label }}</p>
        </div>
        <button type="button" class="testpoint-authoring-page__close" data-testpoint-authoring-close @click="closePage">关闭</button>
      </header>

      <div class="testpoint-authoring-page__body">
      <main v-if="selectedPoint" class="testpoint-authoring-page__content">
        <section class="testpoint-authoring-page__top card">
          <label>
            <span>当前测点</span>
            <select v-model="selectedPointId" data-testpoint-authoring-select @change="switchPoint">
              <option v-for="option in pointOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
            </select>
          </label>
          <label>
            <span>测点名称</span>
            <input v-model.trim="selectedPoint.name" data-testpoint-authoring-name placeholder="请输入测点名称">
          </label>
          <label>
            <span>测点类型</span>
            <select v-model="selectedPoint.pointType" data-testpoint-authoring-type :disabled="selectedPoint.displayConsoleInput">
              <option value="physical">物理测点</option>
              <option value="virtual">虚拟测点</option>
            </select>
          </label>
        </section>

        <section class="card testpoint-authoring-page__section" data-testpoint-authoring-conditions>
          <div class="testpoint-authoring-page__section-head">
            <div><span class="testpoint-authoring-page__eyebrow">检测能力约束</span><h2>影响检测能力的参数</h2></div>
            <small>选择会影响当前测点检测能力的枚举参数。</small>
          </div>
          <div v-if="conditions.length" class="testpoint-authoring-page__condition-grid">
            <label v-for="condition in conditions" :key="condition.key" class="testpoint-authoring-page__choice">
              <input v-model="selectedPoint.conditionKeys" type="checkbox" :value="condition.key" @change="changeConditions">
              <span>{{ condition.label }}</span>
              <small>{{ condition.options.join(' / ') }}</small>
            </label>
          </div>
          <p v-else class="testpoint-authoring-page__empty">当前模型没有可选的诊断工况参数。</p>
        </section>

        <section class="card testpoint-authoring-page__section" data-testpoint-authoring-faults>
          <div class="testpoint-authoring-page__section-head">
            <div><span class="testpoint-authoring-page__eyebrow">{{ hasActiveScenarios ? '工况检测能力' : '基础检测能力' }}</span><h2>当前测点可检测的故障</h2></div>
            <small>按故障传播链路预选，可手动调整。</small>
          </div>
          <div v-if="selectedPoint.conditionKeys.length && scenarios.length" class="testpoint-authoring-page__fault-context">
            <details class="testpoint-authoring-page__scenario-picker" data-testpoint-authoring-scenario-select>
              <summary><span>检测工况</span><strong>{{ scenarioSelectionLabel }}</strong></summary>
              <div class="testpoint-authoring-page__scenario-options">
                <label v-for="scenario in scenarios" :key="scenarioKey(scenario)" class="testpoint-authoring-page__choice">
                  <input v-model="activeScenarioKeys" type="checkbox" :value="scenarioKey(scenario)" data-testpoint-authoring-scenario-option>
                  <span>{{ scenarioLabel(scenario) }}</span>
                </label>
              </div>
            </details>
            <p>{{ hasActiveScenarios ? `正在同时设置 ${activeScenarios.length} 个工况下可检测的故障。` : '未选择工况时，编辑基础检测能力；可展开左侧下拉菜单一次选择多个工况。' }}</p>
          </div>
          <div v-if="faultGroups.length" class="testpoint-authoring-page__fault-groups">
            <details v-for="(group, groupIndex) in faultGroups" :key="group.componentId" :open="groupIndex === 0">
              <summary>{{ group.componentName }} <span>{{ group.faults.length }} 项故障</span></summary>
              <div class="testpoint-authoring-page__fault-list">
                <label v-for="fault in group.faults" :key="fault.id" class="testpoint-authoring-page__choice">
                  <input :checked="hasActiveScenarios ? scenarioFaultDetectable(selectedPoint, fault.id) : (selectedPoint.detects || []).includes(fault.id)" type="checkbox" @change="hasActiveScenarios ? setScenarioFaultDetectability(selectedPoint, fault.id, $event.target.checked) : setBaseDetectability(selectedPoint, fault.id, $event.target.checked)">
                  <span>{{ fault.label }}</span>
                </label>
              </div>
            </details>
          </div>
          <p v-else class="testpoint-authoring-page__empty">当前连线尚未关联可配置的故障。</p>
        </section>

      </main>
      <main v-else class="testpoint-authoring-page__content testpoint-authoring-page__content--empty">
        <p class="testpoint-authoring-page__empty">当前连线尚未生成测点。请点击右下方“新增测点”创建草稿。</p>
      </main>
      </div>

      <footer class="testpoint-authoring-page__footer">
        <p v-if="notice" aria-live="polite">{{ notice }}</p>
        <span v-else>页面内的修改为草稿；点击“保存测点”后才同步到右侧测点设置。</span>
        <div>
          <button type="button" class="testpoint-authoring-page__save" data-testpoint-authoring-save @click="savePoint">保存测点</button>
          <button type="button" class="testpoint-authoring-page__delete" data-testpoint-authoring-delete @click="deletePoint">删除测点</button>
          <button type="button" class="testpoint-authoring-page__add" data-testpoint-authoring-add @click="addPoint">新增测点</button>
        </div>
      </footer>
    </section>
    </div>
  </Teleport>
</template>

<style scoped>
.testpoint-authoring-page{position:fixed;inset:0;z-index:2300;display:flex;min-width:720px;flex-direction:column;background:var(--bg-base);color:var(--text);font-family:var(--font-ui)}
.testpoint-authoring-page__header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:13px 28px;border-bottom:1px solid var(--border);background:var(--bg-panel);box-shadow:var(--shadow-sm)}
.testpoint-authoring-page__eyebrow{display:block;margin-bottom:4px;color:var(--blue);font-family:var(--font-data);font-size:10px;font-weight:700;letter-spacing:.75px;text-transform:uppercase}.testpoint-authoring-page h1{font-size:20px;line-height:1.25}.testpoint-authoring-page__header p{margin-top:4px;color:var(--textm);font-size:11px}.testpoint-authoring-page__close,.testpoint-authoring-page__footer button{height:34px;padding:0 14px;border:1px solid var(--border-mid);border-radius:5px;background:var(--bg-panel);color:var(--text2);font:inherit;font-size:11px;font-weight:600;cursor:pointer}.testpoint-authoring-page__close:hover{border-color:var(--blue);color:var(--blue)}
.testpoint-authoring-page__content{width:min(1080px,calc(100% - 48px));flex:1;overflow:auto;margin:0 auto;padding:24px 0 108px}.card{border:1px solid var(--border);border-radius:8px;background:var(--bg-panel);box-shadow:var(--shadow-sm)}.testpoint-authoring-page__top{display:grid;grid-template-columns:minmax(210px,1fr) minmax(260px,1.25fr) 170px;gap:16px;padding:18px}.testpoint-authoring-page label{min-width:0}.testpoint-authoring-page__top label,.testpoint-authoring-page__scenario-select{display:grid;gap:6px;color:var(--textm);font-size:10px;font-weight:600}.testpoint-authoring-page input:not([type="checkbox"]),.testpoint-authoring-page select{box-sizing:border-box;width:100%;min-height:34px;border:1px solid var(--border-mid);border-radius:5px;background:var(--bg-panel);color:var(--text);font:inherit;font-size:12px;outline:0}.testpoint-authoring-page input:not([type="checkbox"]){padding:0 10px}.testpoint-authoring-page select{padding:0 9px}.testpoint-authoring-page select:focus,.testpoint-authoring-page input:focus{border-color:var(--blue);box-shadow:var(--ring-blue)}
.testpoint-authoring-page__section{margin-top:16px;padding:20px}.testpoint-authoring-page__section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:16px}.testpoint-authoring-page h2{font-size:15px;line-height:1.35}.testpoint-authoring-page__section-head small{max-width:340px;color:var(--textm);font-size:10px;line-height:1.6;text-align:right}.testpoint-authoring-page__condition-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.testpoint-authoring-page__choice{display:flex;align-items:center;gap:8px;min-height:36px;padding:8px 10px;border:1px solid var(--border);border-radius:5px;background:var(--bg-card);color:var(--text2);font-size:11px;cursor:pointer}.testpoint-authoring-page__choice input{accent-color:var(--blue)}.testpoint-authoring-page__choice small{margin-left:auto;color:var(--textm);font-size:9px}.testpoint-authoring-page__empty{padding:16px;border:1px dashed var(--border-mid);border-radius:5px;background:var(--bg-card);color:var(--textm);font-size:11px;line-height:1.6}
.testpoint-authoring-page__fault-groups{display:grid;gap:9px}.testpoint-authoring-page__fault-groups details{border:1px solid var(--border);border-radius:6px;background:var(--bg-card)}.testpoint-authoring-page__fault-groups summary{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;color:var(--text);font-size:12px;font-weight:650;cursor:pointer}.testpoint-authoring-page__fault-groups summary span{color:var(--textm);font-size:10px;font-weight:400}.testpoint-authoring-page__fault-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;padding:0 11px 11px}.testpoint-authoring-page__scenario-select{max-width:590px}.testpoint-authoring-page__scenario-select select{height:auto;padding:5px 9px;line-height:1.7}.testpoint-authoring-page__scenario-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:16px}.testpoint-authoring-page__scenario-card{padding:14px;border:1px solid #bfd5ef;border-radius:6px;background:#f8fbff}.testpoint-authoring-page__scenario-card h3{margin-bottom:10px;color:var(--blue);font-size:12px}.testpoint-authoring-page__scenario-faults{display:grid;gap:7px}
.testpoint-authoring-page__footer{position:absolute;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 28px;border-top:1px solid var(--border);background:var(--bg-panel);box-shadow:0 -8px 20px rgba(30,58,95,.06)}.testpoint-authoring-page__footer>span,.testpoint-authoring-page__footer>p{margin:0;color:var(--textm);font-size:11px}.testpoint-authoring-page__footer>p{color:var(--blue)}.testpoint-authoring-page__footer>div{display:flex;gap:8px}.testpoint-authoring-page__save{border-color:var(--blue)!important;background:var(--blue)!important;color:#fff!important}.testpoint-authoring-page__delete{border-color:var(--red-border)!important;color:var(--red)!important}.testpoint-authoring-page__add{border-color:var(--blue)!important;color:var(--blue)!important}
@media (max-width:850px){.testpoint-authoring-page{min-width:0}.testpoint-authoring-page__content{width:calc(100% - 28px);padding-top:14px}.testpoint-authoring-page__header,.testpoint-authoring-page__footer{padding:12px 14px}.testpoint-authoring-page__top{grid-template-columns:1fr}.testpoint-authoring-page__section-head,.testpoint-authoring-page__footer{align-items:flex-start;flex-direction:column}.testpoint-authoring-page__section-head small{text-align:left}.testpoint-authoring-page__footer>div{width:100%}.testpoint-authoring-page__footer button{flex:1;padding:0 8px}}

/* Window layout: mirrors the component-binding editor so that test-point
   configuration remains a focused task without taking over the workbench. */
.testpoint-authoring-overlay{position:fixed;inset:0;z-index:2300;display:grid;place-items:center;padding:20px;background:rgba(20,41,67,.26);backdrop-filter:blur(2px)}
.testpoint-authoring-page{position:relative;inset:auto;display:flex;width:min(1440px,calc(100vw - 40px));min-width:720px;height:min(860px,calc(100vh - 40px));min-height:560px;overflow:hidden;border:1px solid #c8d9ed;border-radius:16px;box-shadow:0 24px 68px rgba(23,52,84,.28);background:#fff}
.testpoint-authoring-page__header{min-height:66px;padding:14px 28px;background:#f2f8ff;border-bottom-color:#c9dcef;box-shadow:none}.testpoint-authoring-page__header h1{font-size:22px}.testpoint-authoring-page__header p{color:#5d7da2}.testpoint-authoring-page__close{width:30px;height:30px;padding:0;border-color:#c5d1df;border-radius:0;font-size:17px;line-height:1}
.testpoint-authoring-page__body{display:block;min-height:0;flex:1;background:#fff}.testpoint-authoring-page__content{width:auto;min-width:0;height:100%;overflow:auto;margin:0;padding:20px 28px 24px;background:#fff}.testpoint-authoring-page__content--empty{display:flex;align-items:center;justify-content:center}.testpoint-authoring-page__content--empty .testpoint-authoring-page__empty{width:min(440px,100%)}
.testpoint-authoring-page__top{grid-template-columns:minmax(190px,1fr) minmax(220px,1.2fr) 150px;padding:15px;border-color:#d4e2f1;border-radius:12px;background:#f8fbff;box-shadow:none}.card{border-color:#d7e3f0;border-radius:12px;box-shadow:none}.testpoint-authoring-page__section{margin-top:14px;padding:18px}.testpoint-authoring-page__condition-grid{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}.testpoint-authoring-page__choice{border-color:#d8e5f3;background:#fbfdff}.testpoint-authoring-page__fault-groups details{border-color:#d8e5f3}.testpoint-authoring-page__scenario-card{border-color:#cfe1f5;background:#f6fbff}
.testpoint-authoring-page__footer{position:relative;flex:0 0 60px;padding:12px 28px;border-top-color:#d1deec;box-shadow:none}.testpoint-authoring-page__footer button{height:36px;border-radius:8px}
.testpoint-authoring-page__content{display:block!important;grid-template-columns:none!important}.testpoint-authoring-page__top{display:grid!important;grid-template-columns:minmax(220px,1.1fr) minmax(260px,1.45fr) minmax(170px,.75fr)!important;align-items:end!important;min-height:0!important;height:auto!important}.testpoint-authoring-page__top label{display:grid!important;align-content:start!important;align-self:start!important;min-height:0!important;height:auto!important}.testpoint-authoring-page__top input:not([type="checkbox"]),.testpoint-authoring-page__top select{height:38px!important;min-height:38px!important}.testpoint-authoring-page__section{width:100%;box-sizing:border-box}.testpoint-authoring-page__section-head{align-items:center}.testpoint-authoring-page__condition-grid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.testpoint-authoring-page__header{min-height:62px;padding:13px 28px 12px;background:linear-gradient(105deg,#f8fbff 0%,#edf6ff 100%)}.testpoint-authoring-page__eyebrow{margin-bottom:2px;color:#1769d5;font-size:9px;letter-spacing:.85px}.testpoint-authoring-page__header h1{font-size:21px;letter-spacing:.1px}.testpoint-authoring-page__header p{margin-top:2px}.testpoint-authoring-page__close{display:inline-flex;align-items:center;justify-content:center;width:68px;height:32px;min-width:68px;white-space:nowrap;border-radius:6px;background:#fff;color:#46627f;font-size:12px;font-weight:700}.testpoint-authoring-page__close::before{margin-right:5px;color:#6d8196;content:'×';font-size:15px;font-weight:400}.testpoint-authoring-page__content{padding:18px 28px 22px;background:linear-gradient(180deg,#fbfdff 0,#fff 170px)}.testpoint-authoring-page__top{gap:14px;padding:15px 16px;border:1px solid #d5e5f6;border-radius:10px;background:#f8fbff}.testpoint-authoring-page__top label{gap:7px;color:#61738a;font-size:10px}.testpoint-authoring-page__top input:not([type="checkbox"]),.testpoint-authoring-page__top select{border-color:#c8d9ec;background:#fff;box-shadow:inset 0 1px 1px rgba(33,71,112,.025)}.testpoint-authoring-page__section{margin-top:14px;padding:0;overflow:hidden;border-color:#d7e5f2;border-radius:10px;background:#fff}.testpoint-authoring-page__section-head{min-height:55px;margin:0;padding:12px 16px;border-bottom:1px solid #e4edf6;background:#fbfdff}.testpoint-authoring-page__section-head h2{font-size:15px}.testpoint-authoring-page__section-head small{padding:5px 8px;border-radius:999px;background:#eef6ff;color:#6280a1;line-height:1.35}.testpoint-authoring-page__condition-grid{padding:14px 16px}.testpoint-authoring-page__empty{display:flex;align-items:center;min-height:42px;margin:14px 16px;padding:9px 13px;border-color:#cddcea;background:#f9fbfd;color:#71849a}.testpoint-authoring-page__fault-groups{gap:0;padding:10px 16px 14px}.testpoint-authoring-page__fault-groups details{margin-top:8px;border-color:#dce8f4;border-radius:7px;background:#fbfdff;transition:border-color .15s,box-shadow .15s}.testpoint-authoring-page__fault-groups details[open]{border-color:#bcd8f5;box-shadow:0 3px 10px rgba(35,103,177,.06)}.testpoint-authoring-page__fault-groups summary{min-height:38px;padding:0 12px;color:#1e3550}.testpoint-authoring-page__fault-groups summary:hover{background:#f2f8ff}.testpoint-authoring-page__fault-list{padding:2px 10px 10px}.testpoint-authoring-page__choice{min-height:32px;border-color:#dce8f4;background:#fff;color:#40566e}.testpoint-authoring-page__choice:hover{border-color:#9bc5ee;background:#f6fbff}.testpoint-authoring-page__scenario-select{margin:14px 16px 0}.testpoint-authoring-page__scenario-cards{padding:0 16px 16px}.testpoint-authoring-page__footer{min-height:60px;padding:12px 28px;background:#fff}.testpoint-authoring-page__footer>span,.testpoint-authoring-page__footer>p{font-size:10px}.testpoint-authoring-page__footer>div{gap:10px}.testpoint-authoring-page__footer button{min-width:88px;font-size:12px;transition:transform .12s,box-shadow .12s}.testpoint-authoring-page__footer button:hover{transform:translateY(-1px);box-shadow:0 4px 10px rgba(31,96,169,.16)}.testpoint-authoring-page__save{box-shadow:0 4px 10px rgba(29,111,191,.2)}
@media (max-width:900px){.testpoint-authoring-overlay{padding:10px}.testpoint-authoring-page{width:calc(100vw - 20px);height:calc(100vh - 20px);min-width:0;border-radius:10px}.testpoint-authoring-page__content{padding:15px}.testpoint-authoring-page__header,.testpoint-authoring-page__footer{padding-right:16px;padding-left:16px}}

/* Keep scrolling on one lightweight compositor layer. */
.testpoint-authoring-overlay{background:rgba(20,41,67,.24);backdrop-filter:none}.testpoint-authoring-page__body{overflow:hidden}.testpoint-authoring-page__content{overscroll-behavior:contain;scrollbar-gutter:stable;-webkit-overflow-scrolling:touch}.testpoint-authoring-page__section{contain:layout paint style}.testpoint-authoring-page__fault-groups details{transition:none}.testpoint-authoring-page__fault-groups details[open]{box-shadow:none}
.testpoint-authoring-page__fault-context{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 16px;border-bottom:1px solid #e4edf6;background:#f7fbff}.testpoint-authoring-page__scenario-picker{position:relative;min-width:min(420px,48vw)}.testpoint-authoring-page__scenario-picker summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:34px;padding:0 10px;border:1px solid #c8d9ec;border-radius:6px;background:#fff;color:#58718b;cursor:pointer;list-style:none}.testpoint-authoring-page__scenario-picker summary::-webkit-details-marker{display:none}.testpoint-authoring-page__scenario-picker summary::after{content:'⌄';color:#47729f;font-size:14px}.testpoint-authoring-page__scenario-picker summary span{font-size:11px;font-weight:700}.testpoint-authoring-page__scenario-picker summary strong{margin-left:auto;color:#294f78;font-size:11px;font-weight:600}.testpoint-authoring-page__scenario-options{position:absolute;z-index:3;top:calc(100% + 5px);left:0;display:grid;width:100%;max-height:230px;overflow:auto;padding:8px;border:1px solid #c8d9ec;border-radius:7px;background:#fff;box-shadow:0 10px 24px rgba(31,68,108,.16)}.testpoint-authoring-page__scenario-options .testpoint-authoring-page__choice{min-height:30px}.testpoint-authoring-page__fault-context p{margin:0;color:#6a819a;font-size:10px;line-height:1.5;text-align:right}@media (max-width:760px){.testpoint-authoring-page__fault-context{align-items:flex-start;flex-direction:column}.testpoint-authoring-page__scenario-picker{width:min(420px,100%)}.testpoint-authoring-page__fault-context p{text-align:left}}
</style>
