<script setup>
import markup from '../../fragments/left-panel.html?raw';
import { openComponentAuthoringDialog } from '../../composables/useDialogsState.js';
import { openFaultAuthoringForSelectedTarget } from '../../services/authoringRuntimeService.js';

function handlePaletteClick(event) {
  if (event.target?.closest?.('[data-open-component-authoring]')) {
    event.preventDefault();
    openComponentAuthoringDialog({});
    return;
  }
  if (event.target?.closest?.('[data-open-fault-authoring-for-selected]')) {
    event.preventDefault();
    openFaultAuthoringForSelectedTarget();
  }
}
</script>

<template>
  <div class="gz-shell-fragment" data-testid="left-palette" @click="handlePaletteClick" v-html="markup"></div>
</template>
