<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useDialogsState } from '../../composables/useDialogsState.js';
import { createSimulationBlockPythonBinding } from '../../composables/useWorkbenchState.js';
import { parsePythonBindingSource } from '../../services/pythonParserService.js';

const props = defineProps({
  open: { type: Boolean, default: undefined },
  targetNode: { type: Object, default: undefined },
  parsedInterface: { type: Object, default: undefined }
});

const emit = defineEmits(['close', 'confirm', 'unbind', 'pick-file']);

const {
  dialogsState,
  closePythonBindingDialog,
  openPythonBindingDialog,
  setPythonBindingError,
  setPythonBindingPreview
} = useDialogsState();

const fileInput = ref(null);
const editableInterface = ref(null);

const controlledOpen = computed(() => props.open ?? dialogsState.pythonBinding.open);
const controlledTargetNode = computed(() => props.targetNode ?? dialogsState.pythonBinding.targetNode);
const controlledParsedInterface = computed(() => props.parsedInterface ?? dialogsState.pythonBinding.parsedInterface);
const parseError = computed(() => dialogsState.pythonBinding.parseError);

function cloneInterfaceForEditing(parsedInterface) {
  if (!parsedInterface) {
    editableInterface.value = null;
    return;
  }

  editableInterface.value = {
    ...parsedInterface,
    inputs: (parsedInterface.inputs ?? []).map((item) => ({ ...item, displayName: item.displayName ?? item.comment ?? item.name })),
    outputs: (parsedInterface.outputs ?? []).map((item) => ({ ...item, displayName: item.displayName ?? item.comment ?? item.name })),
    middleVars: (parsedInterface.middleVars ?? []).map((item) => ({ ...item, displayName: item.displayName ?? item.comment ?? item.name }))
  };
}

function handleClose() {
  closePythonBindingDialog();
  emit('close');
}

function handlePickFile() {
  fileInput.value?.click();
  emit('pick-file');
}

async function handleFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const source = await file.text();
    const parsed = parsePythonBindingSource({
      fileName: file.name,
      source
    });
    setPythonBindingPreview(parsed);
    cloneInterfaceForEditing(parsed);
  } catch (error) {
    setPythonBindingError(error?.message ?? '解析 Python 文件失败');
  } finally {
    event.target.value = '';
  }
}

function updateDisplayName(groupKey, index, value) {
  if (!editableInterface.value) {
    return;
  }
  editableInterface.value[groupKey][index].displayName = value;
}

function handleConfirm() {
  if (!editableInterface.value || !controlledTargetNode.value?.id) {
    return;
  }

  const detail = {
    nodeId: controlledTargetNode.value.id,
    binding: createSimulationBlockPythonBinding(editableInterface.value)
  };

  window.dispatchEvent(new CustomEvent('gz:python-binding-confirm', { detail }));
  emit('confirm', detail);
  handleClose();
}

function handleUnbind() {
  if (!controlledTargetNode.value?.id) {
    return;
  }

  const detail = { nodeId: controlledTargetNode.value.id };
  window.dispatchEvent(new CustomEvent('gz:python-binding-unbind', { detail }));
  emit('unbind', detail);
  handleClose();
}

function handleOpenEvent(event) {
  openPythonBindingDialog(event.detail ?? {});
  const preview = event.detail?.parsedInterface ?? event.detail?.boundSnapshot?.parsedInterface ?? null;
  cloneInterfaceForEditing(preview);
}

watch(
  controlledParsedInterface,
  (value) => {
    cloneInterfaceForEditing(value);
  },
  { immediate: true }
);

onMounted(() => {
  window.addEventListener('gz:open-python-binding', handleOpenEvent);
});

onBeforeUnmount(() => {
  window.removeEventListener('gz:open-python-binding', handleOpenEvent);
});
</script>

<template>
  <div v-if="controlledOpen" class="overlay overlay--vue open" data-testid="python-binding-dialog">
    <div class="modal python-binding-modal">
      <div class="mhead">
        <div>
          <div class="mtitle python-binding-modal__title">绑定 Python 文件</div>
          <div class="python-binding-modal__sub">
            {{ controlledTargetNode?.label ?? controlledTargetNode?.props?.name ?? '未选择仿真块' }}
          </div>
        </div>
        <button class="mclose" @click="handleClose">×</button>
      </div>

      <div class="mbody python-binding-modal__body">
        <section class="python-binding-modal__panel python-binding-modal__panel--left">
          <div class="python-binding-modal__toolbar">
            <button class="btn-ok btn-ok-b" type="button" @click="handlePickFile">选择 .py 文件</button>
            <input ref="fileInput" class="python-binding-modal__input" type="file" accept=".py" @change="handleFileChange">
          </div>

          <div v-if="parseError" class="python-binding-modal__error">{{ parseError }}</div>

          <div v-if="editableInterface" class="python-binding-modal__summary">
            <div class="python-binding-modal__file">{{ editableInterface.fileName }}</div>
            <div class="python-binding-modal__meta">
              {{ editableInterface.moduleName }} · {{ editableInterface.entryFunction }}
            </div>
            <div class="python-binding-modal__desc">{{ editableInterface.description || '未提供模块说明。' }}</div>
          </div>

          <div v-if="editableInterface" class="python-binding-modal__groups">
            <div class="python-binding-group">
              <div class="python-binding-group__head">输入变量</div>
              <div
                v-for="(item, index) in editableInterface.inputs"
                :key="`input-${item.name}`"
                class="python-binding-row"
              >
                <input
                  :value="item.displayName"
                  class="python-binding-row__name"
                  @input="updateDisplayName('inputs', index, $event.target.value)"
                >
                <span class="python-binding-row__type">{{ item.type }}</span>
                <span class="python-binding-row__note">{{ item.name }} · {{ item.comment || '无注释' }}</span>
              </div>
            </div>

            <div class="python-binding-group">
              <div class="python-binding-group__head">输出变量</div>
              <div
                v-for="(item, index) in editableInterface.outputs"
                :key="`output-${item.name}`"
                class="python-binding-row"
              >
                <input
                  :value="item.displayName"
                  class="python-binding-row__name"
                  @input="updateDisplayName('outputs', index, $event.target.value)"
                >
                <span class="python-binding-row__type">{{ item.type }}</span>
                <span class="python-binding-row__note">{{ item.name }} · {{ item.comment || '无注释' }}</span>
              </div>
            </div>

            <div class="python-binding-group">
              <div class="python-binding-group__head">中间变量</div>
              <div
                v-for="(item, index) in editableInterface.middleVars"
                :key="`middle-${item.name}`"
                class="python-binding-row"
              >
                <input
                  :value="item.displayName"
                  class="python-binding-row__name"
                  @input="updateDisplayName('middleVars', index, $event.target.value)"
                >
                <span class="python-binding-row__type">{{ item.type }}</span>
                <span class="python-binding-row__note">{{ item.name }} · {{ item.comment || '无注释' }}</span>
              </div>
            </div>
          </div>
        </section>

        <section class="python-binding-modal__panel python-binding-modal__panel--right">
          <div class="python-binding-group__head python-binding-modal__code-head">源码预览</div>
          <pre class="python-binding-modal__code">{{ editableInterface?.rawSource ?? '尚未选择 Python 文件。' }}</pre>
        </section>
      </div>

      <div class="mfoot">
        <button class="btn-cancel" type="button" @click="handleClose">取消</button>
        <button class="btn-ok btn-ok-r" type="button" @click="handleUnbind">解除绑定</button>
        <button class="btn-ok btn-ok-b" type="button" :disabled="!editableInterface" @click="handleConfirm">确认绑定</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay--vue{display:flex;}
.python-binding-modal{width:min(980px,calc(100vw - 40px));height:min(720px,calc(100vh - 40px));}
.python-binding-modal__title{color:var(--blue);}
.python-binding-modal__sub{font-size:11px;color:var(--textm);margin-top:3px;}
.python-binding-modal__body{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(300px,0.8fr);}
.python-binding-modal__panel{display:flex;flex-direction:column;min-width:0;overflow:hidden;}
.python-binding-modal__panel--left{border-right:1px solid var(--border);background:linear-gradient(180deg,#ffffff 0%,#f7fbff 100%);}
.python-binding-modal__panel--right{background:var(--bg-card);}
.python-binding-modal__toolbar{display:flex;align-items:center;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--border);}
.python-binding-modal__input{display:none;}
.python-binding-modal__error{margin:0 18px 12px;padding:10px 12px;border:1px solid #f3b2b2;border-radius:8px;background:#fff4f4;color:#c62828;font-size:12px;line-height:1.6;}
.python-binding-modal__summary{padding:14px 18px;border-bottom:1px solid var(--border);}
.python-binding-modal__file{font-size:14px;font-weight:700;color:var(--text);}
.python-binding-modal__meta{font-size:10px;color:var(--blue);font-family:'Cascadia Mono','Consolas',monospace;margin-top:3px;}
.python-binding-modal__desc{font-size:11px;color:var(--text2);line-height:1.7;margin-top:8px;}
.python-binding-modal__groups{flex:1;overflow:auto;padding:14px 18px 18px;display:flex;flex-direction:column;gap:14px;}
.python-binding-group{border:1px solid rgba(174,194,221,0.72);border-radius:12px;background:rgba(255,255,255,0.94);padding:12px;display:flex;flex-direction:column;gap:10px;}
.python-binding-group__head{font-size:11px;font-weight:700;color:var(--text);}
.python-binding-modal__code-head{padding:16px 18px 0;}
.python-binding-row{display:grid;grid-template-columns:minmax(0,1fr) 86px minmax(0,1.1fr);gap:10px;align-items:center;}
.python-binding-row__name{width:100%;border:1.5px solid var(--border);border-radius:8px;padding:8px 10px;background:var(--bg-card);font-size:12px;color:var(--text);outline:none;}
.python-binding-row__name:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(74,158,255,0.12);}
.python-binding-row__type{font-size:11px;color:var(--blue);font-family:'Cascadia Mono','Consolas',monospace;}
.python-binding-row__note{font-size:10px;color:var(--textm);line-height:1.6;}
.python-binding-modal__code{margin:0;flex:1;overflow:auto;padding:16px 18px;background:transparent;color:#24456d;font-size:12px;line-height:1.7;font-family:'Cascadia Mono','Consolas',monospace;white-space:pre-wrap;word-break:break-word;}

@media (max-width:860px){
  .python-binding-modal{height:min(760px,calc(100vh - 24px));width:min(100vw - 24px,980px);}
  .python-binding-modal__body{grid-template-columns:1fr;}
  .python-binding-modal__panel--left{border-right:none;border-bottom:1px solid var(--border);}
  .python-binding-row{grid-template-columns:1fr;}
}
</style>
