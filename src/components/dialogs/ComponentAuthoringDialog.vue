<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { closeComponentAuthoringDialog, openComponentAuthoringDialog, useDialogsState } from '../../composables/useDialogsState.js';
import { registerAuthoredComponent } from '../../services/authoredComponentCatalogService.js';
import { registerBackendSimulationComponent, updateBackendSimulationComponent } from '../../services/backendComponentRegistrationClient.js';
import { executePythonBindingSync } from '../../services/pythonExecutionAdapter.js';
import { parsePythonBindingSource } from '../../services/pythonParserService.js';

const { dialogsState } = useDialogsState();
const fileInput = ref(null);
const iconFileInput = ref(null);
const sourcePreviewOpen = ref(true);
const editingComponent = ref(null);
const iconChoices = ['仿', '信', '传', '控', '算', '波'];
const existingCategories = ['信号处理', '射频信号'];
const form = reactive({ displayName: '', category: '', customCategory: '', description: '', iconMode: 'preset', icon: '', iconImage: '', iconFileName: '', iconColor: '#1877d3', fileName: '', rawSource: '', entryFunction: 'process', inputs: [], outputs: [], parameters: [] });
const trialState = reactive({ passed: false, creating: false, draftSignature: '', message: '', error: '', outputs: null });
const selectedCategory = computed(() => form.category === '__custom__' ? form.customCategory.trim() : form.category.trim());
const draftSignature = computed(() => JSON.stringify(form));
const isEditing = computed(() => Boolean(editingComponent.value));
const hasPythonBinding = computed(() => Boolean(form.rawSource.trim()));
const canSave = computed(() => !trialState.creating && trialState.passed && trialState.draftSignature === draftSignature.value);

function emptyPort(kind, index) { return { name: `${kind}${index + 1}`, varName: '', type: 'number', defaultValue: '0', vectorLength: '', unit: '' }; }
function emptyParameter(index) { return { name: `参数${index + 1}`, key: '', type: 'number', defaultValue: '0', vectorLength: '', unit: '' }; }
function resetTrial() { Object.assign(trialState, { passed: false, creating: false, draftSignature: '', message: '', error: '', outputs: null }); }
function resetForm() { Object.assign(form, { displayName: '', category: '', customCategory: '', description: '', iconMode: 'preset', icon: '', iconImage: '', iconFileName: '', iconColor: '#1877d3', fileName: '', rawSource: '', entryFunction: 'process', inputs: [], outputs: [], parameters: [] }); resetTrial(); }
function looksLikeVector(type) { return /list|array|vector|tuple|sequence|\[\]/i.test(String(type ?? '')); }

function sourceValue(value, type) {
  if (type === 'number[]') {
    try {
      const parsed = JSON.parse(String(value ?? '').trim());
      if (!Array.isArray(parsed) || parsed.some((item) => !Number.isFinite(Number(item)))) throw new Error('数组必须由数值组成');
      return parsed.map(Number);
    } catch (error) { throw new Error(`数组试运行值无效：${error.message}`); }
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('数值试运行值必须是有限数字');
  return numeric;
}

function fillFromParsedInterface(parsed) {
  form.fileName = parsed.fileName;
  form.rawSource = parsed.rawSource;
  form.entryFunction = parsed.entryFunction || 'process';
  if (!form.displayName.trim()) form.displayName = parsed.description || parsed.moduleName || '';
  const parsedInputs = parsed.inputs ?? [];
  const asDraft = (item) => ({ name: item.displayName || item.name, varName: item.name, type: looksLikeVector(item.type) ? 'number[]' : 'number', defaultValue: item.default ?? (looksLikeVector(item.type) ? '[]' : '0'), vectorLength: item.vectorLength || '', unit: '' });
  form.inputs = parsedInputs.filter((item) => item.parameter !== true).map(asDraft);
  form.parameters = parsedInputs.filter((item) => item.parameter === true).map((item) => ({ ...asDraft(item), key: item.name }));
  form.outputs = (parsed.outputs ?? []).map((item, index) => ({ name: item.displayName || item.name || `输出${index + 1}`, varName: item.name, type: looksLikeVector(item.type) ? 'number[]' : 'number', defaultValue: '', vectorLength: item.vectorLength || '', unit: '' }));
  sourcePreviewOpen.value = true;
}

function editableDefault(item, fallback = '0') {
  const value = item?.defaultValue ?? item?.parsedValue ?? item?.default;
  if (Array.isArray(value)) return JSON.stringify(value);
  return value == null || value === '' ? fallback : String(value);
}

function fillFromAuthoredComponent(component) {
  editingComponent.value = JSON.parse(JSON.stringify(component));
  const categoryLabel = String(component.categoryLabel ?? '').trim();
  const category = !categoryLabel || categoryLabel === '我的组件'
    ? ''
    : (existingCategories.includes(categoryLabel) ? categoryLabel : '__custom__');
  Object.assign(form, {
    displayName: component.name ?? '',
    category,
    customCategory: category === '__custom__' ? categoryLabel : '',
    description: component.description ?? '',
    iconMode: component.iconImage ? 'upload' : (component.iconColor ? 'custom' : 'preset'),
    icon: component.icon ?? '',
    iconImage: component.iconImage ?? '',
    iconFileName: component.iconImage ? '当前已上传图标' : '',
    iconColor: component.iconColor || '#1877d3',
    fileName: component.fileName ?? '',
    rawSource: component.rawSource ?? '',
    entryFunction: component.entryFunction || 'process',
    inputs: (component.inputs ?? []).map((item) => ({ ...item, defaultValue: editableDefault(item, item.type === 'number[]' ? '[]' : '0'), vectorLength: item.vectorLength ?? '' })),
    outputs: (component.outputs ?? []).map((item) => ({ ...item, defaultValue: '', vectorLength: item.vectorLength ?? '' })),
    parameters: (component.parameters ?? []).map((item) => ({ ...item, defaultValue: editableDefault(item, item.type === 'number[]' ? '[]' : '0'), vectorLength: item.vectorLength ?? '' }))
  });
  sourcePreviewOpen.value = true;
  resetTrial();
}

async function handleFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try { fillFromParsedInterface(parsePythonBindingSource({ fileName: file.name, source: await file.text() })); resetTrial(); }
  catch (error) { trialState.error = error?.message ?? '解析 Python 文件失败'; }
  finally { event.target.value = ''; }
}
function selectPresetIcon(icon) {
  form.iconMode = 'preset';
  form.icon = icon;
  form.iconImage = '';
  form.iconFileName = '';
}
function handleIconModeChange() {
  form.icon = '';
  form.iconImage = '';
  form.iconFileName = '';
}
async function handleIconFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type)) throw new Error('图标仅支持 PNG、JPG 或 SVG 格式');
    if (file.size > 300 * 1024) throw new Error('图标文件不能超过 300 KB');
    form.iconImage = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取图标文件失败'));
      reader.readAsDataURL(file);
    });
    form.iconFileName = file.name;
    form.iconMode = 'upload';
    form.icon = '';
  } catch (error) { trialState.error = error?.message ?? '上传图标失败'; }
  finally { event.target.value = ''; }
}
function addInput() { form.inputs.push(emptyPort('输入', form.inputs.length)); }
function addOutput() { form.outputs.push(emptyPort('输出', form.outputs.length)); }
function addParameter() { form.parameters.push(emptyParameter(form.parameters.length)); }
function removeRow(rows, index) { rows.splice(index, 1); }

function isPythonIdentifier(value) {
  return /^[A-Za-z_]\w*$/.test(value);
}

function validateRows(rows, role, keyName) {
  const names = new Set();
  return rows.map((item, index) => {
    const name = String(item.name ?? '').trim();
    const key = String(item[keyName] ?? '').trim() || name;
    if (!name || !key) throw new Error(`${role} ${index + 1} 的名称不能为空`);
    if (!isPythonIdentifier(key)) throw new Error(`${role} ${name} 的 Python 变量名只能使用字母、数字和下划线，且不能以数字开头`);
    if (names.has(key)) throw new Error(`${role}名称不能重复：${key}`);
    names.add(key);
    const type = item.type === 'number[]' ? 'number[]' : 'number';
    const vectorLength = item.vectorLength === '' || item.vectorLength == null ? undefined : Number(item.vectorLength);
    if (type === 'number[]' && vectorLength !== undefined && (!Number.isInteger(vectorLength) || vectorLength < 1)) throw new Error(`${role} ${name} 的数组长度必须为正整数`);
    const value = role === '输出' ? undefined : sourceValue(item.defaultValue, type);
    if (type === 'number[]' && vectorLength && value && value.length !== vectorLength) throw new Error(`${role} ${name} 的数组长度应为 ${vectorLength}`);
    return { ...item, name, [keyName]: key, type, ...(vectorLength ? { vectorLength } : {}), ...(role === '输出' ? {} : { parsedValue: value }) };
  });
}

function validateDraft() {
  if (!form.displayName.trim()) throw new Error('请填写仿真组件名称');
  if (form.iconMode === 'upload' ? !form.iconImage : !form.icon.trim()) throw new Error('请选择、设计或上传组件图标');
  if (Boolean(form.fileName) !== Boolean(form.rawSource.trim())) throw new Error('Python 组件文件信息不完整，请重新选择文件');
  if (form.category === '__custom__' && !form.customCategory.trim()) throw new Error('请填写二级菜单名称');
  const parsed = hasPythonBinding.value
    ? parsePythonBindingSource({ fileName: form.fileName, source: form.rawSource })
    : null;
  const inputs = validateRows(form.inputs, '输入', 'varName');
  const outputs = validateRows(form.outputs, '输出', 'varName');
  const parameters = validateRows(form.parameters, '参数', 'key');
  const inputNames = new Set(inputs.map((item) => item.varName));
  const duplicateParameter = parameters.find((item) => inputNames.has(item.key));
  if (duplicateParameter) throw new Error(`参数 ${duplicateParameter.name} 与输入变量重名：${duplicateParameter.key}`);
  return { parsed, inputs, outputs, parameters };
}

function runTrial() {
  resetTrial();
  try {
    const { parsed, inputs, outputs, parameters } = validateDraft();
    let result = null;
    if (parsed) {
      const inputsForTrial = Object.fromEntries(inputs.map((item) => [item.varName, item.parsedValue]));
      const parametersForTrial = Object.fromEntries(parameters.map((item) => [item.key, item.parsedValue]));
      result = executePythonBindingSync({ adapterMode: 'mock', payload: { moduleName: parsed.moduleName, entryFunction: parsed.entryFunction, source: form.rawSource, inputs: { ...inputsForTrial, ...parametersForTrial }, outputNames: outputs.map((item) => item.varName), middleVarNames: [] } });
    }
    trialState.passed = true;
    trialState.draftSignature = draftSignature.value;
    trialState.outputs = result?.outputs ?? null;
    trialState.message = parsed
      ? `已完成 ${inputs.length} 个输入、${outputs.length} 个输出和 ${parameters.length} 个参数的本地试运行。`
      : `已校验 ${inputs.length} 个输入、${outputs.length} 个输出和 ${parameters.length} 个参数；组件暂不绑定 Python。`;
  } catch (error) { trialState.error = error?.message ?? '组件校验失败'; }
}

async function saveComponent() {
  if (!canSave.value) return;
  try {
    trialState.creating = true;
    trialState.error = '';
    const { inputs, outputs, parameters } = validateDraft();
    const original = editingComponent.value;
    const updatesRegisteredBackend = original?.executionMode === 'backend' && Boolean(original.moduleId);
    const componentType = original?.type || `custom_component_${Date.now().toString(36)}`;
    const moduleId = original?.moduleId || componentType;
    const backendPayload = {
      moduleId,
      source: form.rawSource,
      entryFunction: form.entryFunction,
      inputs: inputs.map(({ varName, type, vectorLength }) => ({ varName, type, ...(vectorLength ? { vectorLength } : {}) })),
      outputs: outputs.map(({ varName, type, vectorLength }) => ({ varName, type, ...(vectorLength ? { vectorLength } : {}) })),
      parameters: parameters.map(({ key, type, vectorLength, parsedValue }) => ({ key, type, default: parsedValue, ...(vectorLength ? { vectorLength } : {}) }))
    };
    const backendComponent = hasPythonBinding.value
      ? (updatesRegisteredBackend
          ? await updateBackendSimulationComponent(moduleId, backendPayload)
          : await registerBackendSimulationComponent(backendPayload))
      : { moduleId };
    registerAuthoredComponent({ id: original?.id, type: componentType, moduleId: backendComponent.moduleId, executionMode: hasPythonBinding.value ? 'backend' : 'mock', name: form.displayName, categoryLabel: selectedCategory.value, description: form.description, icon: form.icon, iconImage: form.iconImage, iconColor: form.iconMode === 'custom' ? form.iconColor : '', fileName: hasPythonBinding.value ? (form.fileName || `${backendComponent.moduleId}.py`) : '', rawSource: form.rawSource, entryFunction: form.entryFunction, inputs, outputs, parameters });
    closeComponentAuthoringDialog();
  } catch (error) {
    trialState.error = error?.message ?? (isEditing.value ? '修改仿真组件失败' : '创建仿真组件失败');
  } finally {
    trialState.creating = false;
  }
}
function handleOpenEvent(event) {
  resetForm();
  editingComponent.value = null;
  const component = event.detail?.component;
  const parsed = event.detail?.parsedInterface;
  if (component) fillFromAuthoredComponent(component);
  else if (parsed) fillFromParsedInterface(parsed);
  openComponentAuthoringDialog({ parsedInterface: parsed ?? null, editingComponent: component ?? null });
}
watch(draftSignature, (next, previous) => { if (next !== previous && trialState.passed) resetTrial(); });
onMounted(() => window.addEventListener('gz:open-component-authoring', handleOpenEvent));
onBeforeUnmount(() => window.removeEventListener('gz:open-component-authoring', handleOpenEvent));
</script>

<template>
  <div v-if="dialogsState.componentAuthoring.open" class="overlay overlay--vue open" data-testid="component-authoring-dialog">
    <div class="modal authoring-modal component-authoring-modal" role="dialog" aria-modal="true" aria-labelledby="component-authoring-title">
      <div class="mhead"><div><div id="component-authoring-title" class="mtitle">{{ isEditing ? '修改仿真组件' : '新增仿真组件' }}</div><div class="authoring-modal__sub">Python 文件为可选项；未绑定时校验组件定义后即可保存。</div></div><button class="mclose" type="button" aria-label="关闭" @click="closeComponentAuthoringDialog">×</button></div>
      <div class="mbody authoring-modal__body component-authoring-modal__body">
        <section class="authoring-card authoring-form"><div class="authoring-card__eyebrow">基础信息</div><label class="authoring-form__row"><span>组件名称 <b>*</b></span><input v-model="form.displayName" data-authoring-component-name type="text" placeholder="例如：温度传感器"></label><label class="authoring-form__row"><span>所属二级菜单</span><select v-model="form.category"><option value="">不分类（我的组件）</option><option v-for="category in existingCategories" :key="category" :value="category">{{ category }}</option><option value="__custom__">新建二级菜单…</option></select></label><label v-if="form.category === '__custom__'" class="authoring-form__row"><span>菜单名称</span><input v-model="form.customCategory" type="text" placeholder="例如：传感器模型"></label><label class="authoring-form__row"><span>组件说明</span><textarea v-model="form.description" rows="2" placeholder="选填"></textarea></label><div class="authoring-form__row component-icon-row"><span>组件图标 <b>*</b></span><div class="component-icon-editor"><div class="component-icon-mode"><label><input v-model="form.iconMode" type="radio" value="preset" @change="handleIconModeChange"> 预设图标</label><label><input v-model="form.iconMode" type="radio" value="custom" @change="handleIconModeChange"> 自定义文字</label><label><input v-model="form.iconMode" type="radio" value="upload" @change="handleIconModeChange"> 上传图片</label></div><div v-if="form.iconMode === 'preset'" class="component-icon-picker"><button v-for="icon in iconChoices" :key="icon" type="button" :class="{ active: form.icon === icon }" @click="selectPresetIcon(icon)">{{ icon }}</button></div><div v-else-if="form.iconMode === 'custom'" class="component-custom-icon-fields"><input v-model="form.icon" maxlength="2" type="text" placeholder="输入 1–2 个文字"><label title="图标背景色"><input v-model="form.iconColor" type="color"></label><span class="component-custom-icon-preview" :style="{ backgroundColor: form.iconColor }">{{ form.icon || '图' }}</span></div><div v-else class="component-upload-icon"><button class="btn-ok btn-ok-b" type="button" @click="iconFileInput?.click()">上传图标</button><span>{{ form.iconFileName || '支持 PNG、JPG、SVG，不超过 300 KB' }}</span><img v-if="form.iconImage" :src="form.iconImage" alt="上传图标预览"><input ref="iconFileInput" class="component-file-input" type="file" accept="image/png,image/jpeg,image/svg+xml" @change="handleIconFileChange"></div></div></div></section>
        <section class="authoring-card component-source-card"><div class="authoring-card__eyebrow">Python 组件文件 <span class="component-definition-muted">选填</span></div><div class="component-file-row"><button class="btn-ok btn-ok-b" type="button" @click="fileInput?.click()">选择 .py 文件</button><span>{{ form.fileName || '暂不绑定 Python' }}</span></div><input ref="fileInput" class="component-file-input" type="file" accept=".py" @change="handleFileChange"><div v-if="form.rawSource" class="component-source-preview"><button type="button" class="component-source-preview__toggle" @click="sourcePreviewOpen = !sourcePreviewOpen"><span>已上传文件内容（{{ form.fileName }}）</span><span>{{ sourcePreviewOpen ? '收起' : '展开' }}</span></button><pre v-if="sourcePreviewOpen"><code>{{ form.rawSource }}</code></pre></div><p v-else class="component-source-card__hint">可以直接创建未绑定组件；选择 Python 文件后会自动识别函数接口并在创建前试运行。</p></section>
        <section class="authoring-card"><div class="authoring-card__head"><div><div class="authoring-card__eyebrow">输入</div><p class="component-definition-help">画布左侧的连接口。填写传入 Python 函数的变量；“试运行值”只用于本地校验。</p></div><button type="button" class="authoring-add" @click="addInput">+ 新增输入</button></div><div v-if="form.inputs.length" class="component-definition-list component-definition-list--six"><div class="component-definition-labels"><span>画布显示名</span><span>Python 变量名</span><span>数据类型</span><span>数组固定长度</span><span>试运行值</span><span></span></div><div v-for="(item, index) in form.inputs" :key="`input-${index}`" class="component-definition-row"><input v-model="item.name" placeholder="例如：温度"><input v-model="item.varName" placeholder="例如：temperature"><select v-model="item.type"><option value="number">数值</option><option value="number[]">数值数组</option></select><input v-if="item.type === 'number[]'" v-model="item.vectorLength" type="number" min="1" placeholder="选填"><span v-else class="component-definition-muted">仅数组填写</span><input v-model="item.defaultValue" :placeholder="item.type === 'number[]' ? '例如：[1,2,3]' : '例如：25'"><button type="button" class="authoring-remove" @click="removeRow(form.inputs, index)">删除</button></div></div><div v-else class="authoring-empty">可不填写；无输入组件可作为信号源使用。</div></section>
        <section class="authoring-card"><div class="authoring-card__head"><div><div class="authoring-card__eyebrow">输出</div><p class="component-definition-help">画布右侧的连接口。填写 Python 函数返回结果中，要输出到画布的变量。</p></div><button type="button" class="authoring-add" @click="addOutput">+ 新增输出</button></div><div v-if="form.outputs.length" class="component-definition-list component-definition-list--five"><div class="component-definition-labels"><span>画布显示名</span><span>Python 返回变量名</span><span>数据类型</span><span>数组固定长度</span><span></span></div><div v-for="(item, index) in form.outputs" :key="`output-${index}`" class="component-definition-row"><input v-model="item.name" placeholder="例如：处理后温度"><input v-model="item.varName" placeholder="例如：filtered_temperature"><select v-model="item.type"><option value="number">数值</option><option value="number[]">数值数组</option></select><input v-if="item.type === 'number[]'" v-model="item.vectorLength" type="number" min="1" placeholder="选填"><span v-else class="component-definition-muted">仅数组填写</span><button type="button" class="authoring-remove" @click="removeRow(form.outputs, index)">删除</button></div></div><div v-else class="authoring-empty">可不填写；无输出组件可作为监测或终端组件使用。</div></section>
        <section class="authoring-card"><div class="authoring-card__head"><div><div class="authoring-card__eyebrow">模型参数</div><p class="component-definition-help">组件自身的可配置值，不从连线传入。创建后可在组件属性中修改默认值。</p></div><button type="button" class="authoring-add" @click="addParameter">+ 新增参数</button></div><div v-if="form.parameters.length" class="component-definition-list component-definition-list--six"><div class="component-definition-labels"><span>属性显示名</span><span>Python 参数名</span><span>数据类型</span><span>数组固定长度</span><span>默认值</span><span></span></div><div v-for="(item, index) in form.parameters" :key="`parameter-${index}`" class="component-definition-row"><input v-model="item.name" placeholder="例如：增益"><input v-model="item.key" placeholder="例如：gain"><select v-model="item.type"><option value="number">数值</option><option value="number[]">数值数组</option></select><input v-if="item.type === 'number[]'" v-model="item.vectorLength" type="number" min="1" placeholder="选填"><span v-else class="component-definition-muted">仅数组填写</span><input v-model="item.defaultValue" :placeholder="item.type === 'number[]' ? '例如：[1,2,3]' : '例如：1.0'"><button type="button" class="authoring-remove" @click="removeRow(form.parameters, index)">删除</button></div></div><div v-else class="authoring-empty">暂无模型参数。</div></section>
        <div v-if="trialState.error" class="component-trial component-trial--error">{{ trialState.error }}</div><div v-else-if="trialState.passed" class="component-trial component-trial--success"><strong>{{ hasPythonBinding ? '校验并试运行通过' : '组件定义校验通过' }}</strong><span>{{ trialState.message }}</span><code v-if="trialState.outputs">{{ JSON.stringify(trialState.outputs) }}</code></div>
      </div>
      <div class="mfoot component-authoring-modal__foot"><button class="btn-cancel" type="button" @click="closeComponentAuthoringDialog">取消</button><button class="btn-ok btn-ok-b" type="button" data-test-authored-component @click="runTrial">{{ hasPythonBinding ? '校验并试运行' : '校验组件定义' }}</button><button class="component-create-button" :class="{ 'is-ready': canSave }" type="button" data-save-authored-component :disabled="!canSave" @click="saveComponent"><span class="component-create-button__icon">{{ canSave ? '✓' : (isEditing ? '✎' : '＋') }}</span><span>{{ canSave ? (isEditing ? '保存修改' : '创建仿真组件') : (isEditing ? (hasPythonBinding ? '试运行后保存' : '校验后保存') : (hasPythonBinding ? '试运行后创建' : '校验后创建')) }}</span></button></div>
    </div>
  </div>
</template>

<style scoped>
.component-authoring-modal{width:min(1040px,calc(100vw - 32px));}
.component-authoring-modal__body{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:12px;padding:16px;}
.component-authoring-modal__body>.authoring-card{margin:0}
.component-authoring-modal__body>.authoring-card:nth-child(n+3){grid-column:1/-1}
.authoring-card__head,.component-file-row,.component-icon-picker,.component-trial{display:flex;align-items:center;gap:10px}
.authoring-card__head{justify-content:space-between;align-items:flex-start}
.authoring-add,.authoring-remove{border:0;border-radius:6px;cursor:pointer;font-size:11px}
.authoring-add{flex:none;padding:5px 8px;background:#e9f5ff;color:#1770c4}
.authoring-remove{padding:5px 7px;background:#fff1f1;color:#c83b3b}
.component-file-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--textm);font-size:12px}
.component-file-input{display:none}
.component-source-card{min-height:0}
.component-source-card__hint,.component-definition-help{margin:5px 0 0;color:var(--textm);font-size:11px;line-height:1.55}
.component-source-preview{margin-top:10px;border:1px solid #d9e6f3;border-radius:7px;overflow:hidden;background:#f7faff}
.component-source-preview__toggle{display:flex;width:100%;justify-content:space-between;border:0;padding:8px 10px;background:#edf5fc;color:#24577f;cursor:pointer;font-size:11px;text-align:left}
.component-source-preview pre{max-height:200px;overflow:auto;margin:0;padding:10px;background:#172432;color:#e7f2ff;font:11px/1.5 Consolas,"Courier New",monospace;white-space:pre}
.component-icon-row{align-items:flex-start}
.component-icon-editor{display:flex;min-width:0;flex:1;flex-direction:column;gap:7px}
.component-icon-mode{display:flex;flex-wrap:wrap;gap:10px;color:var(--text2);font-size:11px}
.component-icon-mode label{display:flex;align-items:center;gap:3px;cursor:pointer}
.component-icon-picker{flex-wrap:wrap}
.component-icon-picker button{width:30px;height:30px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--text2);cursor:pointer}
.component-icon-picker button.active{border-color:var(--blue);background:#e9f5ff;color:var(--blue);box-shadow:0 0 0 2px rgba(54,143,234,.12)}
.component-custom-icon-fields,.component-upload-icon{display:flex;align-items:center;gap:8px;min-width:0}
.component-custom-icon-fields>input{width:128px;height:30px;padding:4px 7px;border:1px solid var(--border);border-radius:6px;font-size:11px}
.component-custom-icon-fields input[type="color"]{width:32px;height:30px;padding:2px;border:1px solid var(--border);border-radius:6px;cursor:pointer}
.component-custom-icon-preview{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:7px;color:#fff;font-size:11px;font-weight:700}
.component-upload-icon span{min-width:0;overflow:hidden;color:var(--textm);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.component-upload-icon img{width:30px;height:30px;flex:none;border:1px solid var(--border);border-radius:7px;object-fit:contain;background:#fff}
.component-definition-list{display:flex;flex-direction:column;gap:7px;margin-top:9px}
.component-definition-labels,.component-definition-row{display:grid;gap:7px;align-items:center}
.component-definition-list--six .component-definition-labels,.component-definition-list--six .component-definition-row{grid-template-columns:1.05fr 1fr 88px 88px minmax(120px,.85fr) 54px}
.component-definition-list--five .component-definition-labels,.component-definition-list--five .component-definition-row{grid-template-columns:1.05fr 1fr 120px minmax(100px,.85fr) 54px}
.component-definition-labels span{padding:0 2px;color:var(--textm);font-size:10px;line-height:1.3}
.component-definition-row input,.component-definition-row select{min-width:0;height:30px;padding:4px 7px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text);font-size:11px}
.component-definition-muted{padding:0 6px;color:#9aa8b6;font-size:10px;white-space:nowrap}
.component-trial{grid-column:1/-1;align-items:flex-start;flex-direction:column;padding:10px 12px;border:1px solid;border-radius:8px;font-size:12px}
.component-trial--success{border-color:#9ed8b0;background:#f0fbf3;color:#176b32}
.component-trial--error{border-color:#f0b3b3;background:#fff4f4;color:#b42318}
.component-trial code{display:block;max-width:100%;overflow:auto;color:inherit;white-space:pre-wrap}
.component-authoring-modal__foot{gap:10px;padding:12px 16px;background:linear-gradient(180deg,#fbfdff,#f2f7fc)}
.component-create-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:148px;height:36px;padding:0 15px;border:1px solid #c6d3e0;border-radius:8px;background:#e8edf3;color:#8b98a6;box-shadow:none;font-size:12px;font-weight:700;letter-spacing:.1px;cursor:not-allowed;transition:transform .16s ease,box-shadow .16s ease,background .16s ease,border-color .16s ease}
.component-create-button__icon{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:rgba(255,255,255,.6);font-size:13px;line-height:1}
.component-create-button.is-ready{border-color:#1268cf;background:linear-gradient(135deg,#1677e8 0%,#075cbd 100%);color:#fff;box-shadow:0 5px 12px rgba(19,103,203,.26);cursor:pointer}
.component-create-button.is-ready:hover{transform:translateY(-1px);background:linear-gradient(135deg,#2587f5 0%,#0753ad 100%);box-shadow:0 8px 17px rgba(19,103,203,.32)}
.component-create-button.is-ready:active{transform:translateY(0);box-shadow:0 3px 8px rgba(19,103,203,.24)}
.component-create-button:focus-visible{outline:3px solid rgba(45,139,239,.26);outline-offset:2px}
@media (max-width:720px){.component-authoring-modal__body{grid-template-columns:1fr}.component-definition-labels{display:none}.component-definition-row,.component-definition-list--six .component-definition-row,.component-definition-list--five .component-definition-row{grid-template-columns:1fr 1fr}.component-authoring-modal__body>.authoring-card:nth-child(n+3){grid-column:auto}}
</style>
