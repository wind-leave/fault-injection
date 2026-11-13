import { createApp } from 'vue';
import { loadDisplayConsoleRuntimeConfig } from './services/displayConsoleRuntimeConfig.js';
import { loadPaletteMenuRuntimeConfig } from './services/paletteMenuRuntimeConfig.js';

export async function initializeWorkbench({
  loadConfig = loadDisplayConsoleRuntimeConfig,
  loadMenuConfig = loadPaletteMenuRuntimeConfig,
  importApp = () => import('./App.vue'),
  mountApp = (App, props) => createApp(App, props).mount('#app')
} = {}) {
  // App's imports create component templates and the initial workbench state.
  // They must not run until the runtime presets have been installed.
  const [consoleConfig, menuConfig] = await Promise.all([loadConfig(), loadMenuConfig()]);
  const { default: App } = await importApp();
  return mountApp(App, {
    runtimeConfigError: [consoleConfig.error, menuConfig.error].filter(Boolean).join(' '),
    paletteMenuConfig: menuConfig.sections
  });
}
