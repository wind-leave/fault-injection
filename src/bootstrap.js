import { createApp } from 'vue';
import { loadDisplayConsoleRuntimeConfig } from './services/displayConsoleRuntimeConfig.js';

export async function initializeWorkbench({
  loadConfig = loadDisplayConsoleRuntimeConfig,
  importApp = () => import('./App.vue'),
  mountApp = (App, props) => createApp(App, props).mount('#app')
} = {}) {
  // App's imports create component templates and the initial workbench state.
  // They must not run until the runtime presets have been installed.
  const config = await loadConfig();
  const { default: App } = await importApp();
  return mountApp(App, { runtimeConfigError: config.error });
}
