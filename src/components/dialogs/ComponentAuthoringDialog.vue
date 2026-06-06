<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue';
import {
  closeComponentAuthoringDialog,
  openComponentAuthoringDialog,
  useDialogsState
} from '../../composables/useDialogsState.js';
import { addAuthoredComponentToRuntime } from '../../services/authoringRuntimeService.js';

const { dialogsState } = useDialogsState();

const parsedInterface = computed(() => dialogsState.componentAuthoring.parsedInterface);
const inputs = computed(() => parsedInterface.value?.inputs ?? []);
const outputs = computed(() => parsedInterface.value?.outputs ?? []);

const form = reactive({
  displayName: '',
  category: '仿真模块',
  geometry: 'rect',
  slotName: '',
  slotKind: 'output_signal'
});

function displayName(item) {
  return item?.displayName || item?.comment || item?.name || '未命名';
}

function firstOutputName(value) {
  const output = value?.outputs?.[0];
  return output?.displayName || output?.comment || output?.name || '输出信号';
}

function resetForm(value) {
  form.displayName = value?.description || value?.moduleName || '自定义仿真组件';
  form.category = '仿真模块';
  form.geometry = 'rect';
  form.slotName = `${firstOutputName(value)}故障位`;
  form.slotKind = 'output_signal';
}

function handleOpenEvent(event) {
  openComponentAuthoringDialog(event.detail ?? {});
}

function saveComponent() {
  const result = addAuthoredComponentToRuntime({
    parsedInterface: parsedInterface.value,
    displayName: form.displayName,
    category: form.category,
    geometry: form.geometry,
    slotName: form.slotName,
    slotKind: form.slotKind
  });
  if (result.ok !== false) {
    closeComponentAuthoringDialog();
  }
}

watch(parsedInterface, resetForm, { immediate: true });

onMounted(() => {
  window.addEventListener('gz:open-component-authoring', handleOpenEvent);
});

onBeforeUnmount(() => {
  window.removeEventListener('gz:open-component-authoring', handleOpenEvent);
});
</script>

<template>
  <div
    v-if="dialogsState.componentAuthoring.open"
    class="overlay overlay--vue open"
    data-testid="component-authoring-dialog"
  >
    <div class="modal authoring-modal" role="dialog" aria-modal="true" aria-labelledby="component-authoring-title">
      <div class="mhead">
        <div>
          <div id="component-authoring-title" class="mtitle">新增仿真组件</div>
          <div class="authoring-modal__sub">
            {{ parsedInterface?.fileName || '尚未选择 Python 接口' }}
          </div>
        </div>
        <button class="mclose" type="button" aria-label="关闭" @click="closeComponentAuthoringDialog">×</button>
      </div>

      <div class="mbody authoring-modal__body">
        <section class="authoring-card authoring-form">
          <div class="authoring-card__eyebrow">基础信息</div>
          <label class="authoring-form__row">
            <span>中文名称</span>
            <input v-model="form.displayName" data-authoring-component-name type="text">
          </label>
          <label class="authoring-form__row">
            <span>组件类别</span>
            <select v-model="form.category" data-authoring-component-category>
              <option value="信号源">信号源</option>
              <option value="仿真模块">仿真模块</option>
              <option value="求和模块">求和模块</option>
              <option value="仪器模块">仪器模块</option>
              <option value="自定义模块">自定义模块</option>
            </select>
          </label>
          <label class="authoring-form__row">
            <span>几何形状</span>
            <select v-model="form.geometry" data-authoring-component-geometry>
              <option value="rect">矩形模块</option>
              <option value="pill">胶囊模块</option>
              <option value="circle">圆形模块</option>
              <option value="instrument">仪表模块</option>
            </select>
          </label>
        </section>

        <section class="authoring-card">
          <div class="authoring-card__eyebrow">Python 接口</div>
          <h3>{{ parsedInterface?.description || '未命名组件' }}</h3>
          <div class="authoring-meta">
            <span>{{ parsedInterface?.moduleName || 'unknown_module' }}</span>
            <span>{{ parsedInterface?.entryFunction || 'process' }}</span>
          </div>
        </section>

        <section class="authoring-card">
          <div class="authoring-card__eyebrow">输入</div>
          <div v-if="inputs.length" class="authoring-list">
            <div v-for="item in inputs" :key="`input-${item.name}`" class="authoring-list__row">
              <strong>{{ displayName(item) }}</strong>
              <span>{{ item.name }}</span>
              <code>{{ item.type || 'any' }}</code>
            </div>
          </div>
          <div v-else class="authoring-empty">暂无输入变量</div>
        </section>

        <section class="authoring-card">
          <div class="authoring-card__eyebrow">输出</div>
          <div v-if="outputs.length" class="authoring-list">
            <div v-for="item in outputs" :key="`output-${item.name}`" class="authoring-list__row">
              <strong>{{ displayName(item) }}</strong>
              <span>{{ item.name }}</span>
              <code>{{ item.type || 'any' }}</code>
            </div>
          </div>
          <div v-else class="authoring-empty">暂无输出变量</div>
        </section>

        <section class="authoring-card authoring-form">
          <div class="authoring-card__eyebrow">默认故障槽位</div>
          <label class="authoring-form__row">
            <span>槽位名称</span>
            <input v-model="form.slotName" data-authoring-slot-name type="text">
          </label>
          <label class="authoring-form__row">
            <span>槽位类型</span>
            <select v-model="form.slotKind" data-authoring-slot-kind>
              <option value="output_signal">输出信号</option>
              <option value="input_signal">输入信号</option>
              <option value="state_variable">内部状态</option>
              <option value="parameter">参数</option>
            </select>
          </label>
        </section>
      </div>

      <div class="mfoot">
        <button class="btn-cancel" type="button" @click="closeComponentAuthoringDialog">取消</button>
        <button class="btn-primary" type="button" data-save-authored-component @click="saveComponent">保存组件</button>
      </div>
    </div>
  </div>
</template>
