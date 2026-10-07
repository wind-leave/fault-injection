<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { diagnoseDMatrixFaultCombinations } from '../services/dMatrixFaultLocalization.js';

const isOpen = ref(false);
const model = ref({ points: [], rows: [], summary: {} });
const pointStates = ref({});
const diagnosis = ref(null);
const selectedFaultId = ref('');

const points = computed(() => Array.isArray(model.value?.points) ? model.value.points : []);
const enabledRows = computed(() => (Array.isArray(model.value?.rows) ? model.value.rows : []).filter((row) => row?.enabled !== false));
const selectedCount = computed(() => points.value.filter((point) => Boolean(pointStates.value[pointId(point)])).length);
const canDiagnose = computed(() => points.value.length > 0 && selectedCount.value === points.value.length);
const candidates = computed(() => diagnosis.value?.candidates || []);
const selectedFault = computed(() => candidates.value.find((row) => row.faultId === selectedFaultId.value) || candidates.value[0] || null);

function pointId(point) {
  return String(point?.pointId || point?.id || '');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatDiagnosisDuration(durationMs) {
  return `${durationMs.toFixed(2)} ms`;
}

function openPage(event) {
  const nextModel = event?.detail?.model || window.buildDetectionMatrixModel?.();
  if (!nextModel) return;
  model.value = clone(nextModel);
  pointStates.value = {};
  diagnosis.value = null;
  selectedFaultId.value = '';
  isOpen.value = true;
  nextTick(() => document.querySelector('[data-fault-localization-close]')?.focus());
}

function closePage() {
  isOpen.value = false;
  diagnosis.value = null;
  selectedFaultId.value = '';
}

function setPointState(id, state) {
  pointStates.value = { ...pointStates.value, [id]: state };
  diagnosis.value = null;
  selectedFaultId.value = '';
}

function resetStates() {
  pointStates.value = {};
  diagnosis.value = null;
  selectedFaultId.value = '';
}

function diagnose() {
  if (!canDiagnose.value) return;
  const startedAt = performance.now();
  const result = diagnoseDMatrixFaultCombinations(model.value, pointStates.value);
  diagnosis.value = {
    ...result,
    durationMs: performance.now() - startedAt
  };
  selectedFaultId.value = result.candidates[0]?.faultId || '';
}

function selectFault(row) {
  selectedFaultId.value = row?.faultId || '';
}

function handleKeydown(event) {
  if (isOpen.value && event.key === 'Escape') closePage();
}

onMounted(() => {
  window.addEventListener('gz:open-fault-localization', openPage);
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('gz:open-fault-localization', openPage);
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fault-location-overlay">
      <section class="fault-location-page" data-testid="fault-localization-page" data-fault-localization-view role="dialog" aria-modal="true" aria-label="故障定位">
        <header class="fault-location-page__header">
          <div>
            <span class="fault-location-page__eyebrow">D 矩阵诊断</span>
            <h1>故障定位</h1>
            <p>设置全部测点状态，查找 D 矩阵中所有匹配的单故障及组合；未启用故障仍是可能原因。</p>
          </div>
          <div class="fault-location-page__header-meta">
            <span><b>{{ points.length }}</b>测点</span>
            <span><b>{{ enabledRows.length }}</b>启用故障</span>
          </div>
          <button type="button" class="fault-location-page__close" data-fault-localization-close @click="closePage">关闭</button>
        </header>

        <div class="fault-location-page__body">
          <section class="fault-location-points" aria-label="测点状态设置">
            <div class="fault-location-section-head">
              <div><span>测点状态</span><h2>选择全部测点状态</h2></div>
              <strong>{{ selectedCount }} / {{ points.length }}</strong>
            </div>
            <div class="fault-location-progress"><i :style="{ width: `${points.length ? selectedCount / points.length * 100 : 0}%` }"></i></div>
            <div v-if="points.length" class="fault-location-point-list">
              <article
                v-for="(point, index) in points"
                :key="pointId(point)"
                class="fault-location-point"
                :class="pointStates[pointId(point)] ? `is-${pointStates[pointId(point)]}` : ''"
                :data-fault-localization-point="pointId(point)"
              >
                <div class="fault-location-point__identity">
                  <b>{{ point.shortName || `M${index + 1}` }}</b>
                  <div>
                    <strong>{{ point.name || pointId(point) }}</strong>
                    <small>{{ point.edgeLabel || point.signalPathZh || point.edgeId || pointId(point) }}</small>
                  </div>
                </div>
                <div class="fault-location-point__states" role="group" :aria-label="`${point.name || pointId(point)}状态`">
                  <button
                    type="button"
                    :class="{ 'is-active': pointStates[pointId(point)] === 'normal' }"
                    :data-fault-localization-state="pointId(point)"
                    value="normal"
                    @click="setPointState(pointId(point), 'normal')"
                  >正常</button>
                  <button
                    type="button"
                    :class="{ 'is-active': pointStates[pointId(point)] === 'abnormal' }"
                    :data-fault-localization-state="pointId(point)"
                    value="abnormal"
                    @click="setPointState(pointId(point), 'abnormal')"
                  >异常</button>
                </div>
              </article>
            </div>
            <p v-else class="fault-location-empty">当前没有已启用测点，请先完成测点配置。</p>
          </section>

          <aside class="fault-location-candidate-panel" aria-label="可能的故障">
            <div class="fault-location-section-head">
              <div><span>诊断结果</span><h2>可能的故障</h2></div>
              <div v-if="diagnosis" class="fault-location-diagnosis-meta">
                <output data-fault-localization-diagnosis-duration>诊断用时：{{ formatDiagnosisDuration(diagnosis.durationMs) }}</output>
                <small>共 {{ candidates.length }} 项</small>
              </div>
            </div>
            <div v-if="!diagnosis" class="fault-location-candidate-placeholder">
              <b>等待诊断</b>
              <p>完成左侧全部测点状态设置后，点击下方“开始诊断”。</p>
            </div>
            <div v-else-if="candidates.length" class="fault-location-candidate-list">
              <button
                v-for="row in candidates"
                :key="row.faultId"
                type="button"
                class="fault-location-candidate"
                :class="{ 'is-selected': selectedFault?.faultId === row.faultId, 'is-combination': row.mode === 'multiple' }"
                :data-fault-localization-candidate="row.faultId"
                :title="row.faultDisplayName || row.faultName || row.faultId"
                @click="selectFault(row)"
              >
                <i></i>
                <span><strong>{{ row.faultDisplayName || row.faultName || row.faultId }}</strong><small>{{ row.faultDisplayDetail || row.faultId }}</small></span>
                <em>{{ row.mode === 'multiple' ? `${row.faultCount}项故障组合` : (row.layer || row.category || '单故障') }}</em>
              </button>
            </div>
            <div v-else class="fault-location-candidate-placeholder" :class="diagnosis.allNormal ? 'is-normal' : 'is-warning'">
              <b>{{ diagnosis.allNormal ? '未发现故障' : '未找到匹配故障' }}</b>
              <p>{{ diagnosis.allNormal ? '全部测点均为正常，当前状态未匹配到 D 矩阵中的故障。' : '当前状态与 D 矩阵中的故障及其组合均不匹配，请核对测点状态或完善矩阵。' }}</p>
            </div>
          </aside>

        </div>

        <footer class="fault-location-page__footer">
          <span v-if="canDiagnose">全部测点状态已设置，可以开始诊断。</span>
          <span v-else>还需设置 {{ points.length - selectedCount }} 个测点状态。</span>
          <div>
            <button type="button" data-reset-fault-localization :disabled="!selectedCount" @click="resetStates">重置状态</button>
            <button type="button" class="is-primary" data-run-fault-localization :disabled="!canDiagnose" @click="diagnose">开始诊断</button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.fault-location-overlay{position:fixed;inset:0;z-index:2350;display:grid;place-items:center;padding:20px;background:rgba(20,41,67,.24)}
.fault-location-page{display:flex;width:min(1440px,calc(100vw - 40px));height:min(880px,calc(100vh - 40px));min-width:760px;min-height:580px;overflow:hidden;flex-direction:column;border:1px solid #c8d9ed;border-radius:16px;background:var(--bg-panel);box-shadow:0 24px 68px rgba(23,52,84,.28);color:var(--text);font-family:var(--font-ui)}
.fault-location-page__header{display:grid;grid-template-columns:minmax(300px,1fr) auto auto;align-items:center;gap:20px;min-height:68px;padding:13px 28px;border-bottom:1px solid #c9dcef;background:linear-gradient(105deg,#f8fbff 0%,#edf6ff 100%)}
.fault-location-page__eyebrow,.fault-location-section-head span{display:block;margin-bottom:2px;color:var(--blue);font-family:var(--font-data);font-size:9px;font-weight:700;letter-spacing:.8px;text-transform:uppercase}.fault-location-page h1{font-size:21px;line-height:1.2}.fault-location-page__header p{margin-top:3px;color:#5d7da2;font-size:11px}.fault-location-page__header-meta{display:flex;gap:8px}.fault-location-page__header-meta span{display:grid;min-width:68px;gap:1px;padding:5px 8px;border:1px solid #d5e3f2;border-radius:6px;background:#fff;color:var(--textm);font-size:9px;text-align:center}.fault-location-page__header-meta b{color:var(--text);font-family:var(--font-data);font-size:14px}.fault-location-page__close,.fault-location-page__footer button{height:34px;padding:0 14px;border:1px solid var(--border-mid);border-radius:6px;background:#fff;color:var(--text2);font:inherit;font-size:11px;font-weight:600;cursor:pointer}.fault-location-page__close:hover,.fault-location-page__footer button:hover:not(:disabled){border-color:var(--blue);color:var(--blue)}
.fault-location-page__body{display:grid;min-height:0;flex:1;grid-template-columns:minmax(430px,1.35fr) minmax(330px,.8fr);gap:14px;padding:18px 22px;overflow:hidden;background:linear-gradient(180deg,#fbfdff 0,#fff 170px)}
.fault-location-points,.fault-location-candidate-panel{min-height:0;overflow:hidden;border:1px solid #d7e5f2;border-radius:10px;background:#fff}.fault-location-points{display:flex;flex-direction:column}.fault-location-section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:55px;padding:11px 16px;border-bottom:1px solid #e4edf6;background:#fbfdff}.fault-location-section-head h2{font-size:15px;line-height:1.3}.fault-location-section-head>strong{color:var(--blue);font-family:var(--font-data);font-size:14px}.fault-location-diagnosis-meta{display:flex;min-width:0;align-items:center;justify-content:flex-end;gap:10px;color:#6280a1;font-size:10px;white-space:nowrap}.fault-location-diagnosis-meta output{padding:6px 10px;border:1px solid #9fc9f5;border-radius:6px;background:#e8f3ff;color:#075fc8;font-family:var(--font-data);font-size:12px;font-weight:700;box-shadow:0 1px 3px rgba(15,98,254,.12)}.fault-location-diagnosis-meta small{padding-left:10px;border-left:1px solid #d7e5f2;font-size:10px}.fault-location-progress{height:3px;background:#e7eef6}.fault-location-progress i{display:block;height:100%;background:var(--blue);transition:width .16s}.fault-location-point-list{min-height:0;overflow:auto;padding:5px 16px 14px}.fault-location-point{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px;min-height:69px;padding:10px 2px;border-bottom:1px solid #e4edf6}.fault-location-point__identity{display:flex;min-width:0;align-items:center;gap:11px}.fault-location-point__identity>b{display:grid;width:38px;height:38px;flex:0 0 auto;place-items:center;border-radius:6px;background:#e8f3ff;color:var(--blue);font-family:var(--font-data);font-size:12px}.fault-location-point__identity div{min-width:0}.fault-location-point__identity strong,.fault-location-point__identity small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fault-location-point__identity strong{font-size:12px}.fault-location-point__identity small{margin-top:4px;color:var(--textm);font-size:9px}.fault-location-point__states{display:flex}.fault-location-point__states button{width:66px;height:34px;border:1px solid #c8d9ec;background:#fff;color:#55708d;font:inherit;font-size:11px;cursor:pointer}.fault-location-point__states button+button{border-left:0}.fault-location-point__states button:first-child{border-radius:5px 0 0 5px}.fault-location-point__states button:last-child{border-radius:0 5px 5px 0}.fault-location-point.is-normal .fault-location-point__states button:first-child,.fault-location-point.is-abnormal .fault-location-point__states button:last-child{color:#fff}.fault-location-point.is-normal .fault-location-point__states button:first-child{border-color:var(--green);background:var(--green)}.fault-location-point.is-abnormal .fault-location-point__states button:last-child{border-color:var(--red);background:var(--red)}
.fault-location-candidate-panel{display:flex;flex-direction:column}.fault-location-candidate-list{display:grid;min-height:0;gap:8px;overflow:auto;padding:12px}.fault-location-candidate{display:grid;grid-template-columns:16px minmax(0,1fr) auto;align-items:center;gap:9px;width:100%;padding:11px;border:1px solid #d8e5f3;border-radius:7px;background:#fff;color:var(--text);font:inherit;text-align:left;cursor:pointer}.fault-location-candidate:hover,.fault-location-candidate.is-selected{border-color:#8ab9ec;background:#f4f9ff}.fault-location-candidate>i{width:14px;height:14px;border:1px solid #8ba0b6;border-radius:50%;background:#fff}.fault-location-candidate.is-selected>i{border:4px solid var(--blue)}.fault-location-candidate span{min-width:0}.fault-location-candidate strong,.fault-location-candidate small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fault-location-candidate strong{font-size:12px}.fault-location-candidate small{margin-top:4px;color:var(--textm);font-size:9px}.fault-location-candidate em{padding:4px 7px;border-radius:999px;background:#edf5ff;color:#356b9f;font-size:9px;font-style:normal;white-space:nowrap}.fault-location-candidate-placeholder{display:flex;min-height:0;flex:1;align-items:center;justify-content:center;flex-direction:column;padding:24px;color:var(--textm);text-align:center}.fault-location-candidate-placeholder b{color:var(--text2);font-size:13px}.fault-location-candidate-placeholder p{max-width:280px;margin-top:7px;font-size:10px;line-height:1.6}.fault-location-candidate-placeholder.is-normal{background:var(--green-bg)}.fault-location-candidate-placeholder.is-warning{background:var(--orange-bg)}
.fault-location-empty{margin:16px;padding:16px;border:1px dashed var(--border-mid);border-radius:6px;color:var(--textm);font-size:11px;text-align:center}
.fault-location-candidate.is-combination strong{overflow:visible;white-space:normal;line-height:1.5}
.fault-location-page__footer{display:flex;min-height:60px;align-items:center;justify-content:space-between;gap:20px;padding:12px 28px;border-top:1px solid #d1deec;background:#fff}.fault-location-page__footer>span{color:var(--textm);font-size:10px}.fault-location-page__footer>div{display:flex;gap:10px}.fault-location-page__footer button{min-width:92px}.fault-location-page__footer button.is-primary{border-color:var(--blue);background:var(--blue);color:#fff}.fault-location-page__footer button:disabled{border-color:#d6dbe1;background:#edf0f3;color:#9aa4af;cursor:not-allowed}
@media(max-width:900px){.fault-location-overlay{padding:10px}.fault-location-page{width:calc(100vw - 20px);height:calc(100vh - 20px);min-width:0;border-radius:10px}.fault-location-page__header{grid-template-columns:1fr auto;padding:12px 16px}.fault-location-page__header-meta{display:none}.fault-location-page__body{grid-template-columns:1fr;grid-template-rows:minmax(300px,1fr) minmax(220px,.7fr);overflow:auto}.fault-location-page__footer{padding:10px 16px}}
</style>
