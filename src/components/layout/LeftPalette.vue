<script setup>
import { reactive } from 'vue';
import { openComponentAuthoringDialog } from '../../composables/useDialogsState.js';
import { getPaletteGroups } from '../../services/componentRegistry.js';

const paletteGroups = getPaletteGroups();
const groupOpen = reactive(Object.fromEntries(
  paletteGroups.map((group) => [group.id, group.defaultOpen !== false])
));

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

function lineToolClasses(component) {
  return {
    citem: true,
    'citem-line-tool': true,
    'citem-can': component.lineType === 'can',
    active: component.lineType === 'normal'
  };
}

function lineSwatchStyle(component) {
  if (component.lineType === 'can') {
    return {
      width: '18px',
      height: '3px',
      background: 'var(--purple)',
      borderRadius: '1px',
      flexShrink: 0,
      border: '1px solid var(--purple)'
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

function handleLineToolClick(component) {
  if (typeof window.setConnectionTool === 'function') {
    window.setConnectionTool(component.lineType);
  }
}

function openComponentAuthoring() {
  openComponentAuthoringDialog({});
}
</script>

<template>
  <aside class="lpanel" data-testid="left-palette">
    <div class="lscroll">
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
          <template v-for="component in group.components" :key="component.type">
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
              v-else
              :class="componentClasses(component)"
              draggable="true"
              :data-component="component.type"
              :title="component.title"
            >
              <span :class="badgeClass(component)">{{ badgeIcon(component) }}</span>
              <span class="citem-label">{{ component.label }}</span>
            </div>
          </template>
          <button
            v-if="group.id === 'simulation'"
            type="button"
            class="citem citem-authoring-action"
            data-open-component-authoring
            @click.stop="openComponentAuthoring"
          >
            <span class="citem-icon-badge citem-icon-badge--simulation">新</span>
            <span class="citem-label">新增组件</span>
          </button>
        </div>
      </template>
    </div>
  </aside>
</template>
