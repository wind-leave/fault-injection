<script setup>
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue';
import { getPaletteGroups, getSimulationMenuSections } from '../../services/componentRegistry.js';
import { removeAuthoredComponent, useAuthoredComponentCatalog } from '../../services/authoredComponentCatalogService.js';
import { unregisterBackendSimulationComponents } from '../../services/backendComponentRegistrationClient.js';

defineProps({
  collapsed: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['toggle-collapse']);

const paletteGroups = getPaletteGroups();
const authoredCatalog = useAuthoredComponentCatalog();
const groupOpen = reactive(Object.fromEntries(
  paletteGroups.map((group) => [group.id, group.defaultOpen !== false])
));
const consumedPaletteKeys = reactive(new Set());
const simulationMenuOpen = reactive({});
const simulationActions = reactive({ open: false, mode: 'idle', busy: false, message: '' });
const selectedSimulationComponentTypes = reactive(new Set());

const isSimulationEditing = computed(() => simulationActions.mode === 'editing');
const isSimulationDeleting = computed(() => simulationActions.mode === 'deleting');
const isSimulationSelecting = computed(() => simulationActions.mode !== 'idle');

const simulationMenuSections = computed(() => {
  // 新建组件已注册到全局组件库；这里只借助目录的响应式变化重新读取组件库，
  // 不能再把 authoredCatalog.components 追加一次，否则会在左栏出现两份。
  void authoredCatalog.components.length;
  const simulationGroup = getPaletteGroups().find((group) => group.id === 'simulation');
  return getSimulationMenuSections(simulationGroup?.components ?? []);
});

function paletteKey(component) {
  return component.paletteKey || component.templateId || component.type;
}

function isPaletteComponentAvailable(component) {
  const isOneShotTemplate = ['simulation', 'electrical', 'display-control'].includes(component.group);
  return component.palette?.repeatable === true || !isOneShotTemplate || !consumedPaletteKeys.has(paletteKey(component));
}

function availableSimulationMenuCount(section) {
  return section.components.filter(isPaletteComponentAvailable).length;
}

function handlePaletteComponentCreated(event) {
  const key = event.detail?.paletteKey;
  if (key) {
    consumedPaletteKeys.add(key);
  }
}

function handlePaletteComponentDeleted(event) {
  const key = event.detail?.paletteKey;
  if (key) {
    consumedPaletteKeys.delete(key);
  }
}

function handlePaletteComponentsReset() {
  consumedPaletteKeys.clear();
}

onMounted(() => {
  window.addEventListener('gz:palette-component-created', handlePaletteComponentCreated);
  window.addEventListener('gz:palette-component-deleted', handlePaletteComponentDeleted);
  window.addEventListener('gz:palette-components-reset', handlePaletteComponentsReset);
});

onBeforeUnmount(() => {
  window.removeEventListener('gz:palette-component-created', handlePaletteComponentCreated);
  window.removeEventListener('gz:palette-component-deleted', handlePaletteComponentDeleted);
  window.removeEventListener('gz:palette-components-reset', handlePaletteComponentsReset);
});

function groupDomId(groupId) {
  return `g-${groupId}`;
}

function groupHeadClass(group) {
  const tone = ['fault', 'instrument', 'link'].includes(group.tone) ? group.tone : 'system';
  return `lgroup-head--${tone}`;
}

function componentClasses(component) {
  return {
    citem: true,
    'citem-draggable': true,
    'citem-fault': component.group === 'faults',
    'citem-scope': component.type === 'instrument_scope',
    'citem-edit-target': isSimulationEditing.value && isAuthoredSimulationComponent(component),
    'citem-delete-target': isSimulationDeleting.value && isAuthoredSimulationComponent(component),
    'citem-delete-selected': isSimulationDeleting.value && selectedSimulationComponentTypes.has(component.type)
  };
}

function badgeClass(component) {
  return [
    'citem-icon-badge',
    `citem-icon-badge--${component.palette?.iconClass || 'source'}`
  ];
}

function badgeIcon(component) {
  return component.palette?.icon || component.badge?.slice(0, 1) || component.label?.slice(0, 1) || '?';
}

function hasUploadedBadgeIcon(component) {
  return Boolean(component.palette?.iconImage);
}

function badgeStyle(component) {
  return component.palette?.iconColor
    ? { backgroundColor: component.palette.iconColor, color: '#fff', boxShadow: 'none' }
    : undefined;
}

function handlePaletteDragStart(event, component) {
  const componentPaletteKey = paletteKey(component);
  event.currentTarget?.classList.add('citem-dragging');
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', component.type);
  event.dataTransfer.setData('application/x-gz-palette-key', componentPaletteKey);
}

function handlePaletteDragEnd(event) {
  event.currentTarget?.classList.remove('citem-dragging');
}

function lineToolClasses(component) {
  return {
    citem: true,
    'citem-line-tool': true,
    'citem-power': false,
    active: component.lineType === 'normal'
  };
}

function lineSwatchStyle(component) {
  if (component.lineType === 'can') {
    return {
      width: '18px',
      height: '3px',
      background: '#8c7cf6',
      borderRadius: '1px',
      flexShrink: 0,
      border: '1px solid #8c7cf6'
    };
  }

  return {
    width: '18px',
    height: '2px',
    background: 'var(--border-dark)',
    borderRadius: '1px',
    flexShrink: 0
  };
}

function toggleGroup(groupId) {
  groupOpen[groupId] = !groupOpen[groupId];
}

function openComponentAuthoring() {
  simulationActions.open = false;
  simulationActions.mode = 'idle';
  simulationActions.message = '';
  selectedSimulationComponentTypes.clear();
  window.dispatchEvent(new CustomEvent('gz:open-component-authoring'));
}

function toggleSimulationActions() {
  simulationActions.open = !simulationActions.open;
  if (!simulationActions.open) {
    simulationActions.mode = 'idle';
    selectedSimulationComponentTypes.clear();
    simulationActions.message = '';
  }
}

function enterSimulationEditMode() {
  simulationActions.open = true;
  simulationActions.mode = 'editing';
  selectedSimulationComponentTypes.clear();
  simulationActions.message = '修改模式：点击左栏中由前端创建的仿真组件。';
}

function exitSimulationEditMode() {
  simulationActions.mode = 'idle';
  simulationActions.message = '';
}

function enterSimulationDeleteMode() {
  simulationActions.open = true;
  simulationActions.mode = 'deleting';
  selectedSimulationComponentTypes.clear();
  simulationActions.message = '删除模式：点击左栏选择要删除的自定义仿真组件。';
}

function exitSimulationDeleteMode() {
  simulationActions.mode = 'idle';
  selectedSimulationComponentTypes.clear();
  simulationActions.message = '';
}

function isAuthoredSimulationComponent(component) {
  return component?.group === 'simulation'
    && authoredCatalog.components.some((item) => item.type === component.type);
}

function isSimulationComponentUsedOnCanvas(component) {
  const state = window.__GZ_STATE__ ?? {};
  const nodes = Array.isArray(state.modelNodes) ? state.modelNodes : (Array.isArray(state.nodes) ? state.nodes : []);
  return nodes.some((node) => node.templateId === component.type
    || node.type === component.type
    || node.pythonBinding?.moduleId === component.pythonBinding?.moduleId);
}

async function handleSimulationComponentClick(event, component) {
  if (!isSimulationSelecting.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (!isAuthoredSimulationComponent(component) || simulationActions.busy) {
    simulationActions.message = isSimulationEditing.value
      ? '内置仿真组件不能在此处修改。'
      : '内置仿真组件不能在此处删除。';
    return;
  }
  if (isSimulationEditing.value) {
    const authoredComponent = authoredCatalog.components.find((item) => item.type === component.type);
    simulationActions.open = false;
    simulationActions.mode = 'idle';
    simulationActions.message = '';
    window.dispatchEvent(new CustomEvent('gz:open-component-authoring', { detail: { component: authoredComponent } }));
    return;
  }
  if (isSimulationComponentUsedOnCanvas(component)) {
    simulationActions.message = '该组件仍在当前画布中使用；请先删除画布节点后再删除组件模板。';
    return;
  }
  if (selectedSimulationComponentTypes.has(component.type)) selectedSimulationComponentTypes.delete(component.type);
  else selectedSimulationComponentTypes.add(component.type);
  simulationActions.message = selectedSimulationComponentTypes.size
    ? `已选择 ${selectedSimulationComponentTypes.size} 个组件；再次点击删除按钮确认批量删除。`
    : '删除模式：点击左栏选择要删除的自定义仿真组件。';
}

async function deleteSelectedSimulationComponents() {
  const targets = authoredCatalog.components.filter((component) => selectedSimulationComponentTypes.has(component.type));
  const labels = targets.map((component) => `“${component.name}”`).join('、');
  if (!window.confirm(`确认删除 ${targets.length} 个仿真组件：${labels}？此操作会同时注销其后端模块。`)) {
    simulationActions.message = '已取消删除；已选组件仍保留，可继续调整选择。';
    return;
  }
  try {
    simulationActions.busy = true;
    const moduleIds = targets
      .filter((component) => component.executionMode === 'backend' && component.moduleId)
      .map((component) => component.moduleId);
    if (moduleIds.length) await unregisterBackendSimulationComponents(moduleIds);
    targets.forEach((component) => {
      removeAuthoredComponent(component.type);
      consumedPaletteKeys.delete(paletteKey(component));
    });
    selectedSimulationComponentTypes.clear();
    simulationActions.message = `已删除 ${targets.length} 个仿真组件；可继续选择其他组件。`;
  } catch (error) {
    simulationActions.message = error?.message ?? '删除组件失败，请稍后重试。';
  } finally {
    simulationActions.busy = false;
  }
}

function isSimulationMenuOpen(section) {
  return simulationMenuOpen[section.id] ?? section.defaultOpen !== false;
}

function toggleSimulationMenu(section) {
  simulationMenuOpen[section.id] = !isSimulationMenuOpen(section);
}

function handleLineToolClick(component) {
  if (typeof window.setConnectionTool === 'function') {
    window.setConnectionTool(component.lineType);
  }
}

</script>

<template>
  <aside class="lpanel" :class="{ 'is-collapsed': collapsed }" data-testid="left-palette">
    <div class="left-panel-control">
      <button
        type="button"
        class="left-panel-toggle"
        data-testid="left-palette-toggle"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? '展开组件库' : '收起组件库'"
        :title="collapsed ? '展开组件库' : '收起组件库'"
        @click="emit('toggle-collapse')"
      >
        <span class="left-panel-toggle__icon" aria-hidden="true">{{ collapsed ? '›' : '‹' }}</span>
      </button>
    </div>
    <div v-show="!collapsed" class="lscroll">
      <template v-for="group in paletteGroups" :key="group.id">
        <div
          class="lgroup-head"
          :class="[groupHeadClass(group), { 'simulation-group-head': group.id === 'simulation' }]"
          :data-palette-group="group.id"
          @click="toggleGroup(group.id)"
        >
          <span class="lgroup-icon">{{ group.icon }}</span>
          <span class="lgroup-label">{{ group.label }}</span>
          <button
            v-if="group.id === 'simulation'"
            type="button"
            class="lgroup-add lgroup-action-menu"
            data-simulation-actions-menu
            :class="{ active: simulationActions.open || isSimulationSelecting }"
            aria-label="仿真组件菜单"
            title="仿真组件菜单"
            :aria-expanded="simulationActions.open"
            @click.stop="toggleSimulationActions"
          >⋮</button>
          <div v-if="group.id === 'simulation' && simulationActions.open" class="simulation-floating-actions" @click.stop>
            <button
              type="button"
              class="simulation-floating-actions__add"
              data-open-component-authoring
              aria-label="新增仿真组件"
              title="新增仿真组件"
              @click="openComponentAuthoring"
            >＋</button>
            <button
              type="button"
              class="simulation-floating-actions__edit"
              :class="{ 'simulation-floating-actions__exit-edit': isSimulationEditing }"
              data-enter-simulation-edit
              :aria-label="isSimulationEditing ? '退出修改模式' : '修改仿真组件'"
              :title="isSimulationEditing ? '退出修改模式' : '修改仿真组件'"
              @click="isSimulationEditing ? exitSimulationEditMode() : enterSimulationEditMode()"
            ><span aria-hidden="true">{{ isSimulationEditing ? '×' : '✎' }}</span></button>
            <button
              type="button"
              class="simulation-floating-actions__delete"
              :class="{ 'simulation-floating-actions__confirm-delete': isSimulationDeleting }"
              data-enter-simulation-delete
              :aria-label="isSimulationDeleting ? (selectedSimulationComponentTypes.size ? '删除已选仿真组件' : '退出删除模式') : '删除仿真组件'"
              :title="isSimulationDeleting ? (selectedSimulationComponentTypes.size ? '删除已选仿真组件' : '退出删除模式') : '删除仿真组件'"
              @click="isSimulationDeleting ? (selectedSimulationComponentTypes.size ? deleteSelectedSimulationComponents() : exitSimulationDeleteMode()) : enterSimulationDeleteMode()"
            ><span aria-hidden="true">{{ isSimulationDeleting && !selectedSimulationComponentTypes.size ? '×' : '⌫' }}</span></button>
          </div>
          <span
            class="lgroup-arrow"
            :class="{ open: groupOpen[group.id] }"
            :id="`arr-${groupDomId(group.id)}`"
          >&#9654;</span>
        </div>
        <div
          v-show="groupOpen[group.id]"
          class="lgroup-body"
          :id="groupDomId(group.id)"
          :data-palette-body="group.id"
        >
          <template v-if="group.id === 'simulation'">
            <div v-if="isSimulationSelecting || simulationActions.message" class="simulation-delete-status" :class="{ error: simulationActions.message.includes('不能') || simulationActions.message.includes('失败') }">
              {{ simulationActions.busy ? '正在删除组件…' : simulationActions.message }}
            </div>
            <section
              v-for="section in simulationMenuSections"
              :key="section.id"
              class="simulation-menu-section"
              :data-simulation-menu-section="section.id"
            >
              <button
                type="button"
                class="simulation-menu-section__head"
                :aria-expanded="isSimulationMenuOpen(section)"
                @click="toggleSimulationMenu(section)"
              >
                <span class="simulation-menu-section__icon">{{ section.icon }}</span>
                <span>{{ section.label }}</span>
                <span class="simulation-menu-section__count">{{ availableSimulationMenuCount(section) }}</span>
                <span class="simulation-menu-section__arrow" :class="{ open: isSimulationMenuOpen(section) }">&#9654;</span>
              </button>
              <div v-show="isSimulationMenuOpen(section)" class="simulation-menu-section__body">
                <template v-for="component in section.components" :key="paletteKey(component)">
                  <div
                    v-if="isPaletteComponentAvailable(component)"
                    :class="componentClasses(component)"
                    :draggable="!isSimulationSelecting"
                    :data-component="component.type"
                    :data-palette-key="paletteKey(component)"
                    :title="isSimulationEditing ? (isAuthoredSimulationComponent(component) ? '点击修改此自定义仿真组件' : '内置仿真组件不可修改') : (isSimulationDeleting ? (isAuthoredSimulationComponent(component) ? '点击删除此自定义仿真组件' : '内置仿真组件不可删除') : component.title)"
                    @click="handleSimulationComponentClick($event, component)"
                    @dragstart="handlePaletteDragStart($event, component)"
                    @dragend="handlePaletteDragEnd"
                  >
                    <span :class="badgeClass(component)" :style="badgeStyle(component)"><img v-if="hasUploadedBadgeIcon(component)" class="citem-icon-badge__image" :src="component.palette.iconImage" alt=""><template v-else>{{ badgeIcon(component) }}</template></span>
                    <span class="citem-label">{{ component.label }}</span>
                  </div>
                </template>
              </div>
            </section>
          </template>
          <template v-else v-for="component in group.components" :key="paletteKey(component)">
            <div
              v-if="component.paletteKind === 'line-tool'"
              :class="lineToolClasses(component)"
              :data-line-type="component.lineType"
              @click="handleLineToolClick(component)"
            >
              <div :style="lineSwatchStyle(component)"></div>
              {{ component.label }}
            </div>
            <div
              v-else-if="isPaletteComponentAvailable(component)"
              :class="componentClasses(component)"
              draggable="true"
              :data-component="component.type"
              :data-palette-key="paletteKey(component)"
              :title="component.title"
              @dragstart="handlePaletteDragStart($event, component)"
              @dragend="handlePaletteDragEnd"
            >
              <span :class="badgeClass(component)" :style="badgeStyle(component)"><img v-if="hasUploadedBadgeIcon(component)" class="citem-icon-badge__image" :src="component.palette.iconImage" alt=""><template v-else>{{ badgeIcon(component) }}</template></span>
              <span class="citem-label">{{ component.label }}</span>
            </div>
          </template>
        </div>
      </template>
    </div>
  </aside>
</template>
