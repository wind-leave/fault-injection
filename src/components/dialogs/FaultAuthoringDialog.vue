<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue';
import {
  closeFaultAuthoringDialog,
  openFaultAuthoringDialog,
  useDialogsState
} from '../../composables/useDialogsState.js';
import { addAuthoredFaultToRuntime } from '../../services/authoringRuntimeService.js';

const { dialogsState } = useDialogsState();

const target = computed(() => dialogsState.faultAuthoring.target);

const runtimeBehaviors = [
  { value: 'bias', label: 'Bias 固定偏置' },
  { value: 'drift', label: 'Drift 缓慢漂移' },
  { value: 'intermittent', label: 'Intermittent 间歇故障' },
  { value: 'noise', label: 'Noise 噪声扰动' },
  { value: 'lock', label: 'Lock 锁定输出' },
  { value: 'tamper', label: 'Tamper 篡改信号' }
];

const layerOptions = [
  { value: 'electrical', label: '电气层' },
  { value: 'physical', label: '物理层' },
  { value: 'protocol', label: '协议层' },
  { value: 'local_state', label: '本地状态故障' }
];

const form = reactive({
  faultId: '',
  displayName: '',
  layer: 'electrical',
  faultClass: '偏差故障',
  runtimeBehavior: 'bias',
  parameters: {
    bias: 0.1,
    start: 0,
    duration: ''
  }
});

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resetForm(value) {
  const targetName = value?.targetName || value?.targetId || '目标对象';
  form.displayName = `${targetName}自定义偏置`;
  form.faultId = slug(`${value?.targetId || 'target'}_${value?.slotId || 'slot'}_bias`) || 'custom_fault_bias';
  form.layer = 'electrical';
  form.faultClass = '偏差故障';
  form.runtimeBehavior = 'bias';
  form.parameters.bias = 0.1;
  form.parameters.start = 0;
  form.parameters.duration = '';
}

function handleOpenEvent(event) {
  openFaultAuthoringDialog(event.detail ?? {});
}

function saveFault() {
  const result = addAuthoredFaultToRuntime({
    target: target.value,
    faultId: form.faultId,
    displayName: form.displayName,
    layer: form.layer,
    faultClass: form.faultClass,
    runtimeBehavior: form.runtimeBehavior,
    parameters: form.parameters
  });
  if (result.ok !== false) {
    closeFaultAuthoringDialog();
  }
}

watch(target, resetForm, { immediate: true });

onMounted(() => {
  window.addEventListener('gz:open-fault-authoring', handleOpenEvent);
});

onBeforeUnmount(() => {
  window.removeEventListener('gz:open-fault-authoring', handleOpenEvent);
});
</script>

<template>
  <div
    v-if="dialogsState.faultAuthoring.open"
    class="overlay overlay--vue open"
    data-testid="fault-authoring-dialog"
  >
    <div class="modal authoring-modal" role="dialog" aria-modal="true" aria-labelledby="fault-authoring-title">
      <div class="mhead">
        <div>
          <div id="fault-authoring-title" class="mtitle">新增故障模型</div>
          <div class="authoring-modal__sub">
            {{ target?.targetKind || 'target' }} · {{ target?.targetId || '未选择目标' }}
          </div>
        </div>
        <button class="mclose" type="button" aria-label="关闭" @click="closeFaultAuthoringDialog">×</button>
      </div>

      <div class="mbody authoring-modal__body">
        <section class="authoring-card">
          <div class="authoring-card__eyebrow">目标槽位</div>
          <h3>{{ target?.targetName || '未命名目标' }}</h3>
          <div class="authoring-meta">
            <span>{{ target?.slotName || '未选择槽位' }}</span>
            <span>{{ target?.slotId || 'slot' }}</span>
          </div>
        </section>

        <section class="authoring-card authoring-form">
          <div class="authoring-card__eyebrow">故障信息</div>
          <label class="authoring-form__row">
            <span>故障 ID</span>
            <input v-model="form.faultId" data-authoring-fault-id type="text">
          </label>
          <label class="authoring-form__row">
            <span>故障名称</span>
            <input v-model="form.displayName" data-authoring-fault-name type="text" placeholder="例如：陀螺仪固定偏置">
          </label>
          <label class="authoring-form__row">
            <span>故障层级</span>
            <select v-model="form.layer" data-authoring-fault-layer>
              <option v-for="option in layerOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label class="authoring-form__row">
            <span>故障类别</span>
            <input v-model="form.faultClass" data-authoring-fault-class type="text">
          </label>
          <label class="authoring-form__row">
            <span>运行行为</span>
            <select v-model="form.runtimeBehavior" data-authoring-fault-behavior>
              <option v-for="behavior in runtimeBehaviors" :key="behavior.value" :value="behavior.value">
                {{ behavior.label }}
              </option>
            </select>
          </label>
        </section>

        <section class="authoring-card authoring-form">
          <div class="authoring-card__eyebrow">默认参数</div>
          <label class="authoring-form__row">
            <span>bias</span>
            <input v-model="form.parameters.bias" data-authoring-param-name="bias" type="number" step="0.01">
          </label>
          <label class="authoring-form__row">
            <span>start</span>
            <input v-model="form.parameters.start" data-authoring-param-name="start" type="number" step="1">
          </label>
          <label class="authoring-form__row">
            <span>duration</span>
            <input v-model="form.parameters.duration" data-authoring-param-name="duration" type="number" step="1">
          </label>
        </section>
      </div>

      <div class="mfoot">
        <button class="btn-cancel" type="button" @click="closeFaultAuthoringDialog">取消</button>
        <button class="btn-primary" type="button" data-save-authored-fault @click="saveFault">保存故障</button>
      </div>
    </div>
  </div>
</template>
