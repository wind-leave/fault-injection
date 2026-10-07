<script setup>
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue';
import { getElectricalMenuSections, getPaletteGroups, getSimulationMenuSections } from '../../services/componentRegistry.js';
import { useAuthoredComponentCatalog } from '../../services/authoredComponentCatalogService.js';

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
const paletteMenuOpen = reactive({});

const paletteMenuSections = computed(() => {
  // 新建组件已注册到全局组件库；这里只借助目录的响应式变化重新读取组件库，
  // 不能再把 authoredCatalog.components 追加一次，否则会在左栏出现两份。
  void authoredCatalog.components.length;
  const groups = getPaletteGroups();
  const groupComponents = (groupId) => groups.find((group) => group.id === groupId)?.components ?? [];
  return {
    electrical: getElectricalMenuSections(groupComponents('electrical')),
    simulation: getSimulationMenuSections(groupComponents('simulation'))
  };
});

function paletteKey(component) {
  return component.paletteKey || component.templateId || component.type;
}

function isPaletteComponentAvailable(component) {
  const isOneShotTemplate = ['simulation', 'electrical', 'display-control'].includes(component.group);
  return component.palette?.repeatable === true || !isOneShotTemplate || !consumedPaletteKeys.has(paletteKey(component));
}

function paletteMenuSectionsFor(group) {
  return paletteMenuSections.value[group.id] ?? [];
}

function availablePaletteMenuCount(section) {
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
    'citem-scope': component.type === 'instrument_scope'
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

function paletteMenuKey(group, section) {
  return `${group.id}:${section.id}`;
}

function isPaletteMenuOpen(group, section) {
  const key = paletteMenuKey(group, section);
  return paletteMenuOpen[key] ?? section.defaultOpen !== false;
}

function togglePaletteMenu(group, section) {
  const key = paletteMenuKey(group, section);
  paletteMenuOpen[key] = !isPaletteMenuOpen(group, section);
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
          :class="groupHeadClass(group)"
          :data-palette-group="group.id"
          @click="toggleGroup(group.id)"
        >
          <span class="lgroup-icon">{{ group.icon }}</span>
          <span class="lgroup-label">{{ group.label }}</span>
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
          <template v-if="group.id === 'simulation' || group.id === 'electrical'">
            <section
              v-for="section in paletteMenuSectionsFor(group)"
              :key="section.id"
              class="simulation-menu-section"
              :data-simulation-menu-section="group.id === 'simulation' ? section.id : null"
              :data-electrical-menu-section="group.id === 'electrical' ? section.id : null"
            >
              <button
                type="button"
                class="simulation-menu-section__head"
                :aria-expanded="isPaletteMenuOpen(group, section)"
                @click="togglePaletteMenu(group, section)"
              >
                <span class="simulation-menu-section__icon">{{ section.icon }}</span>
                <span>{{ section.label }}</span>
                <span class="simulation-menu-section__count">{{ availablePaletteMenuCount(section) }}</span>
                <span class="simulation-menu-section__arrow" :class="{ open: isPaletteMenuOpen(group, section) }">&#9654;</span>
              </button>
              <div v-show="isPaletteMenuOpen(group, section)" class="simulation-menu-section__body">
                <template v-for="component in section.components" :key="paletteKey(component)">
                  <div
                    v-if="isPaletteComponentAvailable(component)"
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
