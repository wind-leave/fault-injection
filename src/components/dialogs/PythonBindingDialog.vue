<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useDialogsState } from '../../composables/useDialogsState.js';
import { createSimulationBlockPythonBinding } from '../../composables/useWorkbenchState.js';
import { registerBackendSimulationComponent } from '../../services/backendComponentRegistrationClient.js';
import { parsePythonBindingSource } from '../../services/pythonParserService.js';

const props = defineProps({ open: { type: Boolean, default: undefined }, targetNode: { type: Object, default: undefined }, parsedInterface: { type: Object, default: undefined } });
const emit = defineEmits(['close', 'confirm', 'unbind', 'pick-file']);
const { dialogsState, closePythonBindingDialog, openPythonBindingDialog, setPythonBindingError } = useDialogsState();
const fileInput = ref(null);
const saving = ref(false);
const editable = reactive({ fileName: '', moduleName: '', description: '', entryFunction: 'process', rawSource: '', inputs: [], outputs: [], parameters: [], middleVars: [] });
const controlledOpen = computed(() => props.open ?? dialogsState.pythonBinding.open);
const controlledTargetNode = computed(() => props.targetNode ?? dialogsState.pythonBinding.targetNode);
const boundSnapshot = computed(() => dialogsState.pythonBinding.boundSnapshot ?? {});
const parseError = computed(() => dialogsState.pythonBinding.parseError);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function isVector(item) { return /vector|array|list|tuple|\[\]/i.test(String(item?.dataType ?? item?.type ?? '')); }
function editorType(item) { return isVector(item) ? 'number[]' : 'number'; }
function validIdentifier(value) { return /^[A-Za-z_]\w*$/.test(String(value ?? '').trim()); }
function portDraft(item, index, kind) { return { name: item?.displayName ?? item?.name ?? `${kind}${index + 1}`, varName: item?.varName ?? item?.name ?? '', type: editorType(item), vectorLength: item?.vectorLength ?? '', vectorElementNames: Array.isArray(item?.vectorElementNames) ? [...item.vectorElementNames] : [], defaultValue: item?.default ?? '0', comment: item?.comment ?? '' }; }
function parameterDraft(item, index) { return { name: item?.displayName ?? item?.name ?? `参数${index + 1}`, key: item?.key ?? item?.varName ?? item?.name ?? '', type: editorType(item), vectorLength: item?.vectorLength ?? '', defaultValue: item?.default ?? '0', comment: item?.comment ?? '' }; }
function replaceEditor(next = {}) { Object.assign(editable, { fileName: next.fileName ?? '', moduleName: next.moduleName ?? '', description: next.description ?? '', entryFunction: next.entryFunction ?? 'process', rawSource: next.rawSource ?? '', inputs: clone(next.inputs ?? []), outputs: clone(next.outputs ?? []), parameters: clone(next.parameters ?? []), middleVars: clone(next.middleVars ?? []) }); }
function populateFromBinding(parsedInterface, snapshot = {}, target = {}) {
  const parsed = parsedInterface ?? {};
  const parsedInputs = Array.isArray(parsed.inputs) ? parsed.inputs : [];
  const mappedInputs = snapshot?.portMapping?.inputs;
  const mappedOutputs = snapshot?.portMapping?.outputs;
  const mappedParameters = target?.props?.parameters?.length ? target.props.parameters : (snapshot?.parameters?.length ? snapshot.parameters : parsedInputs.filter((item) => item?.parameter === true));
  replaceEditor({
    fileName: parsed.fileName ?? snapshot?.fileName ?? '', moduleName: parsed.moduleName ?? snapshot?.moduleName ?? '', description: parsed.description ?? snapshot?.description ?? '', entryFunction: parsed.entryFunction ?? snapshot?.entryFunction ?? 'process', rawSource: parsed.rawSource ?? snapshot?.rawSource ?? '',
    inputs: (Array.isArray(mappedInputs) && mappedInputs.length ? mappedInputs : parsedInputs.filter((item) => item?.parameter !== true)).map((item, index) => portDraft(item, index, '输入')),
    outputs: (Array.isArray(mappedOutputs) && mappedOutputs.length ? mappedOutputs : (parsed.outputs ?? [])).map((item, index) => portDraft(item, index, '输出')),
    parameters: mappedParameters.map(parameterDraft), middleVars: (snapshot?.portMapping?.middleVars ?? parsed.middleVars ?? []).map((item, index) => portDraft(item, index, '中间变量'))
  });
}
function populateFromParsedFile(parsed) { replaceEditor({ fileName: parsed.fileName, moduleName: parsed.moduleName, description: parsed.description, entryFunction: parsed.entryFunction, rawSource: parsed.rawSource, inputs: (parsed.inputs ?? []).filter((item) => item?.parameter !== true).map((item, index) => portDraft(item, index, '输入')), outputs: (parsed.outputs ?? []).map((item, index) => portDraft(item, index, '输出')), parameters: (parsed.inputs ?? []).filter((item) => item?.parameter === true).map(parameterDraft), middleVars: (parsed.middleVars ?? []).map((item, index) => portDraft(item, index, '中间变量')) }); }
function handleClose() { closePythonBindingDialog(); emit('close'); }
function handlePickFile() { fileInput.value?.click(); emit('pick-file'); }
async function handleFileChange(event) { const file = event.target.files?.[0]; if (!file) return; try { populateFromParsedFile(parsePythonBindingSource({ fileName: file.name, source: await file.text() })); setPythonBindingError(''); } catch (error) { setPythonBindingError(error?.message ?? '解析 Python 文件失败'); } finally { event.target.value = ''; } }
function addPort(kind) { editable[kind].push(portDraft({}, editable[kind].length, kind === 'inputs' ? '输入' : kind === 'outputs' ? '输出' : '中间变量')); }
function addParameter() { editable.parameters.push(parameterDraft({}, editable.parameters.length)); }
function removeRow(kind, index) { editable[kind].splice(index, 1); }
function vectorElementCount(item) { const length = Number(item?.vectorLength); return item?.type === 'number[]' && Number.isInteger(length) && length > 0 ? length : 0; }
function parseDefault(value, type, label) { if (type === 'number[]') { try { const result = JSON.parse(String(value ?? '[]')); if (!Array.isArray(result) || result.some((item) => !Number.isFinite(Number(item)))) throw new Error(); return result.map(Number); } catch { throw new Error(`${label} 的默认值必须是数值数组。`); } } const numeric = Number(value); if (!Number.isFinite(numeric)) throw new Error(`${label} 的默认值必须是有效数值。`); return numeric; }
function normalizeRows(rows, kind, keyField, { defaults = false, namedElements = false } = {}) { const names = new Set(); return rows.map((item, index) => { const name = String(item.name ?? '').trim(); const key = String(item[keyField] ?? '').trim(); if (!name || !key || !validIdentifier(key)) throw new Error(`${kind} ${index + 1} 的变量名必须是合法的 Python 标识符。`); if (names.has(key)) throw new Error(`${kind}变量名不能重复：${key}`); names.add(key); const type = item.type === 'number[]' ? 'number[]' : 'number'; const vectorLength = type === 'number[]' && item.vectorLength !== '' ? Number(item.vectorLength) : undefined; if (vectorLength !== undefined && (!Number.isInteger(vectorLength) || vectorLength < 1)) throw new Error(`${kind} ${name} 的数组长度必须是正整数。`); if (namedElements && type === 'number[]' && vectorLength === undefined) throw new Error(`${kind} ${name} 需要设置数组长度，以便命名每个元素。`); const vectorElementNames = namedElements && type === 'number[]' ? Array.from({ length: vectorLength }, (_, vectorIndex) => String(item.vectorElementNames?.[vectorIndex] ?? '').trim()) : []; if (namedElements && type === 'number[]' && vectorElementNames.some((elementName) => !elementName)) throw new Error(`${kind} ${name} 的每个向量元素都需要命名。`); const normalized = { name, [keyField]: key, type, ...(type === 'number[]' && vectorLength ? { vectorLength, ...(namedElements ? { vectorElementNames } : {}) } : {}), comment: String(item.comment ?? '').trim() }; if (defaults) normalized.defaultValue = parseDefault(item.defaultValue, type, `${kind} ${name}`); return normalized; }); }
function toParsedPort(item, { parameter = false } = {}) { return { name: item.varName ?? item.key, displayName: item.name, type: item.type === 'number[]' ? 'vector' : 'float', ...(item.type === 'number[]' ? { dataType: 'vector' } : {}), ...(item.vectorLength ? { vectorLength: item.vectorLength, ...(Array.isArray(item.vectorElementNames) && item.vectorElementNames.length ? { vectorElementNames: [...item.vectorElementNames] } : {}) } : {}), ...(item.comment ? { comment: item.comment } : {}), ...(parameter ? { parameter: true, default: item.defaultValue } : { default: item.defaultValue ?? null }) }; }
function toNodePort(item, direction, index) { return { portId: `${direction}-${index}`, name: item.name, displayName: item.name, varName: item.varName, type: item.type === 'number[]' ? 'vector' : 'float', ...(item.type === 'number[]' ? { dataType: 'vector' } : {}), ...(item.vectorLength ? { vectorLength: item.vectorLength, ...(Array.isArray(item.vectorElementNames) && item.vectorElementNames.length ? { vectorElementNames: [...item.vectorElementNames] } : {}) } : {}), ...(item.comment ? { comment: item.comment } : {}) }; }
function toNodeParameter(item) { return { key: item.key, name: item.name, type: item.type === 'number[]' ? 'vector' : 'float', ...(item.type === 'number[]' ? { dataType: 'vector' } : {}), ...(item.vectorLength ? { vectorLength: item.vectorLength } : {}), default: item.defaultValue, ...(item.comment ? { comment: item.comment } : {}) }; }
function createInstanceModuleId(nodeId) { const nodePart = String(nodeId ?? 'node').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'node'; return `custom_instance_${nodePart.slice(0, 28)}_${Date.now().toString(36)}`; }

async function handleConfirm() {
  if (!controlledTargetNode.value?.id || saving.value) return;
  try {
    saving.value = true; setPythonBindingError('');
    const inputs = normalizeRows(editable.inputs, '输入', 'varName', { defaults: true, namedElements: true });
    const outputs = normalizeRows(editable.outputs, '输出', 'varName', { namedElements: true });
    const parameters = normalizeRows(editable.parameters, '参数', 'key', { defaults: true });
    const collisions = parameters.find((item) => inputs.some((input) => input.varName === item.key));
    if (collisions) throw new Error(`参数 ${collisions.key} 不能与输入变量同名。`);
    if (!editable.rawSource.trim()) throw new Error('请先选择当前节点要绑定的 Python 文件。');
    const parsedInterface = { fileName: editable.fileName || 'instance.py', moduleName: editable.moduleName || 'instance', description: editable.description, entryFunction: editable.entryFunction || 'process', rawSource: editable.rawSource, inputs: [...inputs.map((item) => toParsedPort(item)), ...parameters.map((item) => toParsedPort({ ...item, varName: item.key }, { parameter: true }))], outputs: outputs.map((item) => toParsedPort(item)), middleVars: editable.middleVars.map((item) => toParsedPort(item)) };
    const existing = boundSnapshot.value;
    const needsBackendInstance = existing.executionMode === 'backend';
    let moduleId = existing.moduleId ?? parsedInterface.moduleName;
    let fileName = parsedInterface.fileName;
    if (needsBackendInstance) {
      const registered = await registerBackendSimulationComponent({ moduleId: createInstanceModuleId(controlledTargetNode.value.id), source: parsedInterface.rawSource, entryFunction: parsedInterface.entryFunction, inputs: inputs.map(({ varName, type, vectorLength }) => ({ varName, type, ...(vectorLength ? { vectorLength } : {}) })), outputs: outputs.map(({ varName, type, vectorLength }) => ({ varName, type, ...(vectorLength ? { vectorLength } : {}) })), parameters: parameters.map(({ key, type, vectorLength, defaultValue }) => ({ key, type, default: defaultValue, ...(vectorLength ? { vectorLength } : {}) })) });
      moduleId = registered.moduleId; fileName = `${moduleId}.py`;
    }
    const binding = { ...createSimulationBlockPythonBinding(parsedInterface, { moduleId, moduleCategory: existing.moduleCategory, sourcePackageId: existing.sourcePackageId, sourcePackageName: existing.sourcePackageName, executionMode: needsBackendInstance ? 'backend' : (existing.executionMode ?? 'mock'), parameters: parameters.map(toNodeParameter) }), moduleId, fileName, moduleName: moduleId, sourceKind: needsBackendInstance ? 'instance' : (existing.sourceKind ?? 'instance'), instanceOverride: true };
    const interfaceDefinition = { inputs: inputs.map((item, index) => toNodePort(item, 'input', index)), outputs: outputs.map((item, index) => toNodePort(item, 'output', index)), middleVars: editable.middleVars.map((item, index) => toNodePort(item, 'middle', index)), parameters: parameters.map(toNodeParameter) };
    const detail = { nodeId: controlledTargetNode.value.id, binding, interfaceDefinition };
    window.dispatchEvent(new CustomEvent('gz:python-binding-confirm', { detail })); emit('confirm', detail); handleClose();
  } catch (error) { setPythonBindingError(error?.message ?? '保存当前组件的 Python 绑定失败'); }
  finally { saving.value = false; }
}
function handleUnbind() { if (!controlledTargetNode.value?.id) return; const detail = { nodeId: controlledTargetNode.value.id }; window.dispatchEvent(new CustomEvent('gz:python-binding-unbind', { detail })); emit('unbind', detail); handleClose(); }
function handleOpenEvent(event) { openPythonBindingDialog(event.detail ?? {}); populateFromBinding(event.detail?.parsedInterface ?? event.detail?.boundSnapshot?.parsedInterface, event.detail?.boundSnapshot, event.detail?.targetNode); }
watch(() => props.parsedInterface, (value) => { if (value) populateFromBinding(value, boundSnapshot.value, controlledTargetNode.value); }, { immediate: true });
onMounted(() => window.addEventListener('gz:open-python-binding', handleOpenEvent));
onBeforeUnmount(() => window.removeEventListener('gz:open-python-binding', handleOpenEvent));
</script>

<template>
  <div v-if="controlledOpen" class="overlay overlay--vue open" data-testid="python-binding-dialog">
    <div class="modal python-binding-modal" role="dialog" aria-modal="true" aria-labelledby="python-binding-title">
      <div class="mhead"><div><div id="python-binding-title" class="mtitle python-binding-modal__title">编辑组件 Python 绑定</div><div class="python-binding-modal__sub">{{ controlledTargetNode?.label ?? controlledTargetNode?.props?.name ?? '未选中仿真组件' }} · 修改只作用于当前画布组件</div></div><button class="mclose" type="button" @click="handleClose">×</button></div>
      <div class="mbody python-binding-modal__body">
        <section class="python-binding-modal__panel python-binding-modal__panel--left">
          <div class="python-binding-modal__toolbar"><button class="btn-ok btn-ok-b" type="button" @click="handlePickFile">更换 .py 文件</button><input ref="fileInput" class="python-binding-modal__input" type="file" accept=".py" @change="handleFileChange"><span>{{ editable.fileName || '尚未选择文件' }}</span></div>
          <div v-if="parseError" class="python-binding-modal__error">{{ parseError }}</div>
          <div class="python-binding-modal__summary"><strong>{{ editable.fileName || '当前节点绑定' }}</strong><span>{{ editable.moduleName || 'instance' }} · {{ editable.entryFunction }}</span><p>保存后会创建该节点专用的后端模块，组件库及后续拖入的同类组件不会改变。</p></div>
          <div class="python-binding-modal__groups">
            <section class="python-binding-group">
              <div class="python-binding-group__head"><span>输入变量</span><button type="button" @click="addPort('inputs')">+ 新增输入</button></div>
              <div class="python-binding-labels"><span>显示名</span><span>Python 变量名</span><span>类型</span><span>试运行默认值</span><span></span></div>
              <div v-for="(item, index) in editable.inputs" :key="`input-${index}`" class="python-binding-row"><input v-model="item.name"><input v-model="item.varName"><select v-model="item.type"><option value="number">数值</option><option value="number[]">数组</option></select><input v-model="item.defaultValue"><button type="button" class="python-binding-remove" @click="removeRow('inputs', index)">删除</button></div>
              <div v-for="(item, index) in editable.inputs" :key="`input-elements-${index}`" v-show="item.type === 'number[]'" class="python-binding-vector-elements"><label>数组长度<input v-model="item.vectorLength" type="number" min="1" placeholder="必填"></label><div v-if="vectorElementCount(item)" class="python-binding-vector-elements__names"><label v-for="elementIndex in vectorElementCount(item)" :key="elementIndex">元素 {{ elementIndex }}<input v-model="item.vectorElementNames[elementIndex - 1]" :data-python-binding-vector-element="`input-${index}-${elementIndex - 1}`" :placeholder="`例如：通道 ${elementIndex}`"></label></div></div>
            </section>
            <section class="python-binding-group">
              <div class="python-binding-group__head"><span>输出变量</span><button type="button" @click="addPort('outputs')">+ 新增输出</button></div>
              <div class="python-binding-labels"><span>显示名</span><span>Python 返回变量名</span><span>类型</span><span>数组长度</span><span></span></div>
              <div v-for="(item, index) in editable.outputs" :key="`output-${index}`" class="python-binding-row"><input v-model="item.name"><input v-model="item.varName"><select v-model="item.type"><option value="number">数值</option><option value="number[]">数组</option></select><input v-model="item.vectorLength" :disabled="item.type !== 'number[]'"><button type="button" class="python-binding-remove" @click="removeRow('outputs', index)">删除</button></div>
              <div v-for="(item, index) in editable.outputs" :key="`output-elements-${index}`" v-show="vectorElementCount(item)" class="python-binding-vector-elements"><strong>{{ item.name || `输出 ${index + 1}` }} 的元素名称</strong><div class="python-binding-vector-elements__names"><label v-for="elementIndex in vectorElementCount(item)" :key="elementIndex">元素 {{ elementIndex }}<input v-model="item.vectorElementNames[elementIndex - 1]" :data-python-binding-vector-element="`output-${index}-${elementIndex - 1}`" :placeholder="`例如：通道 ${elementIndex}`"></label></div></div>
            </section>
            <section class="python-binding-group">
              <div class="python-binding-group__head"><span>模型参数</span><button type="button" @click="addParameter">+ 新增参数</button></div>
              <div class="python-binding-labels"><span>显示名</span><span>Python 参数名</span><span>类型</span><span>默认值</span><span></span></div>
              <div v-for="(item, index) in editable.parameters" :key="`parameter-${index}`" class="python-binding-row"><input v-model="item.name"><input v-model="item.key"><select v-model="item.type"><option value="number">数值</option><option value="number[]">数组</option></select><input v-model="item.defaultValue"><button type="button" class="python-binding-remove" @click="removeRow('parameters', index)">删除</button></div>
            </section>
          </div>
        </section>
        <section class="python-binding-modal__panel python-binding-modal__panel--right"><div class="python-binding-group__head python-binding-modal__code-head">源码预览</div><pre class="python-binding-modal__code">{{ editable.rawSource || '请选择 .py 文件后显示源码。' }}</pre></section>
      </div>
      <div class="mfoot"><button class="btn-cancel" type="button" :disabled="saving" @click="handleClose">取消</button><button class="btn-ok btn-ok-r" type="button" :disabled="saving" @click="handleUnbind">解除绑定</button><button class="btn-ok btn-ok-b" type="button" :disabled="saving || !editable.rawSource" @click="handleConfirm">{{ saving ? '正在保存…' : '保存当前组件' }}</button></div>
    </div>
  </div>
</template>

<style scoped>
.overlay--vue{display:flex;align-items:center;justify-content:center;background:rgba(15,30,49,.42)}
.python-binding-modal{width:min(1180px,calc(100vw - 40px));height:min(780px,calc(100vh - 40px));overflow:hidden;border:1px solid rgba(196,215,238,.9);border-radius:16px;background:#fff;box-shadow:0 18px 48px rgba(10,35,66,.24)}
.python-binding-modal :deep(.mhead){min-height:76px;padding:16px 24px;border-bottom:1px solid #dce8f5;background:linear-gradient(110deg,#f9fcff 0%,#edf6ff 56%,#fff 100%)}
.python-binding-modal :deep(.mfoot){min-height:70px;padding:14px 24px;border-top:1px solid #dce8f5;background:#fbfdff}
.python-binding-modal__title{color:#153f71;font-size:20px;letter-spacing:.2px}.python-binding-modal__sub{margin-top:5px;color:#68809b;font-size:12px}.python-binding-modal__body{display:grid;grid-template-columns:minmax(0,1.56fr) minmax(330px,.82fr);min-height:0}.python-binding-modal__panel{min-width:0;overflow:hidden}.python-binding-modal__panel--left{display:flex;flex-direction:column;background:linear-gradient(180deg,#f7fbff 0%,#fff 31%)}.python-binding-modal__panel--right{display:flex;flex-direction:column;border-left:1px solid #dbe7f4;background:#102235}
.python-binding-modal__toolbar{display:flex;align-items:center;gap:12px;padding:15px 22px;border-bottom:1px solid #e2ecf6;background:#fff}.python-binding-modal__toolbar :deep(.btn-ok){height:34px;padding:0 13px;border-radius:8px;font-weight:700}.python-binding-modal__toolbar span{min-width:0;overflow:hidden;color:#5d7895;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.python-binding-modal__input{display:none}.python-binding-modal__error{margin:14px 22px 0;padding:10px 12px;border:1px solid #f1b7b7;border-radius:9px;background:#fff5f5;color:#b42318;font-size:12px;line-height:1.5}.python-binding-modal__summary{position:relative;margin:15px 22px 0;padding:13px 16px 13px 18px;border:1px solid #cfe1f6;border-radius:10px;background:linear-gradient(105deg,#edf7ff,#fff)}.python-binding-modal__summary:before{position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:4px;background:#287ee0;content:''}.python-binding-modal__summary strong,.python-binding-modal__summary span{display:block}.python-binding-modal__summary strong{color:#163d6e;font-size:14px}.python-binding-modal__summary span{margin-top:4px;color:#1872d2;font:10px Consolas,monospace}.python-binding-modal__summary p{margin:8px 0 0;color:#667f99;font-size:11px;line-height:1.6}.python-binding-modal__groups{flex:1;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:15px 22px 22px;display:flex;flex-direction:column;gap:13px;contain:layout paint;transform:translateZ(0)}.python-binding-group{padding:13px;border:1px solid #d6e4f3;border-radius:12px;background:#fff;content-visibility:auto;contain-intrinsic-size:160px}.python-binding-group__head{display:flex;align-items:center;justify-content:space-between;color:#193f6f;font-size:13px;font-weight:750}.python-binding-group__head span{display:flex;align-items:center;gap:7px}.python-binding-group__head span:before{width:7px;height:7px;border-radius:50%;background:#3188e7;box-shadow:0 0 0 4px #e6f2ff;content:''}.python-binding-group__head button{border:1px solid #cbe1f7;border-radius:7px;background:#edf7ff;color:#126dc7;padding:5px 9px;cursor:pointer;font-size:11px;font-weight:650}.python-binding-group__head button:hover{border-color:#68a9eb;background:#dcefff}.python-binding-labels,.python-binding-row{display:grid;grid-template-columns:1.15fr 1.15fr 82px minmax(96px,.82fr) 48px;gap:8px;align-items:center}.python-binding-labels{margin-top:13px;padding:0 5px}.python-binding-labels span{color:#8498ad;font-size:10px;font-weight:650}.python-binding-row{margin-top:7px;padding:5px;border-radius:8px;background:#f8fbfe}.python-binding-row:hover{background:#f1f8ff}.python-binding-row input,.python-binding-row select{min-width:0;height:32px;border:1px solid #d7e2ee;border-radius:6px;padding:5px 8px;background:#fff;color:#203b59;font-size:11px;outline:none}.python-binding-row input:focus,.python-binding-row select:focus{border-color:#4d9ceb;box-shadow:0 0 0 3px rgba(50,139,232,.12)}.python-binding-row input:disabled{background:#edf2f7;color:#9aa8b6}.python-binding-remove{height:30px;border:1px solid #f1cccc;border-radius:6px;background:#fff;color:#d34b4b;padding:4px;cursor:pointer;font-size:10px}.python-binding-remove:hover{border-color:#e67d7d;background:#fff2f2}.python-binding-modal__code-head{margin:18px 18px 0;padding:0 0 12px;border-bottom:1px solid rgba(159,193,228,.25);color:#ddecff;font-size:12px}.python-binding-modal__code-head:before{background:#6bb3ff!important;box-shadow:0 0 0 4px rgba(107,179,255,.14)!important}.python-binding-modal__code{flex:1;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;contain:layout paint;transform:translateZ(0);margin:0;padding:17px 19px;color:#d6e9ff;font:12px/1.75 "Cascadia Mono",Consolas,monospace;white-space:pre-wrap;word-break:break-word}.python-binding-modal__code::selection{background:#2f6fab;color:#fff}.python-binding-modal :deep(.btn-cancel),.python-binding-modal :deep(.btn-ok){height:36px;border-radius:8px;padding:0 15px;font-weight:650}
@media(max-width:860px){.python-binding-modal{width:calc(100vw - 20px);height:min(900px,calc(100vh - 20px));border-radius:12px}.python-binding-modal :deep(.mhead){padding:13px 16px}.python-binding-modal__body{grid-template-columns:1fr}.python-binding-modal__panel--left{border-bottom:1px solid #dbe7f4}.python-binding-modal__panel--right{min-height:230px;border-left:0}.python-binding-modal__toolbar,.python-binding-modal__groups{padding-left:14px;padding-right:14px}.python-binding-modal__summary{margin-left:14px;margin-right:14px}.python-binding-labels{display:none}.python-binding-row{grid-template-columns:1fr 1fr}.python-binding-row select,.python-binding-row button{grid-column:auto}.python-binding-modal :deep(.mfoot){padding:11px 14px}}
.python-binding-vector-elements{display:flex;flex-direction:column;gap:8px;margin:8px 5px 0;padding:9px 10px;border:1px dashed #bdd8f0;border-radius:8px;background:#f7fbff;color:#496985;font-size:11px}.python-binding-vector-elements>label{display:flex;align-items:center;gap:8px;font-weight:650}.python-binding-vector-elements>label input{width:96px;height:28px;border:1px solid #d7e2ee;border-radius:6px;padding:4px 7px;background:#fff;color:#203b59}.python-binding-vector-elements__names{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:7px}.python-binding-vector-elements__names label{display:flex;align-items:center;gap:6px;min-width:0}.python-binding-vector-elements__names input{min-width:0;flex:1;height:28px;border:1px solid #d7e2ee;border-radius:6px;padding:4px 7px;background:#fff;color:#203b59;font-size:11px}
</style>
