export const PALETTE_MENU_CONFIG_URL = `${import.meta.env?.BASE_URL ?? './'}config/palette-menus.json`;

function validatePaletteMenuConfiguration(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('配置必须是包含 simulation 或 electrical 的对象');
  }

  for (const [group, sections] of Object.entries(document)) {
    if (!['simulation', 'electrical'].includes(group) || !Array.isArray(sections)) {
      throw new Error(`${group}：只支持 simulation 和 electrical 菜单数组`);
    }

    const ids = new Set();
    sections.forEach((section, index) => {
      const path = `${group}[${index}]`;
      if (!section || typeof section !== 'object' || Array.isArray(section)
        || Object.keys(section).some((key) => !['id', 'label', 'icon', 'defaultOpen'].includes(key))) {
        throw new Error(`${path}：菜单项只支持 id、label、icon 和 defaultOpen`);
      }
      for (const key of ['id', 'label', 'icon']) {
        if (typeof section[key] !== 'string' || !section[key].trim()) {
          throw new Error(`${path}.${key}：必须是非空字符串`);
        }
      }
      if (typeof section.defaultOpen !== 'boolean') {
        throw new Error(`${path}.defaultOpen：必须是布尔值`);
      }
      if (ids.has(section.id)) {
        throw new Error(`${path}.id：同一分组内菜单 ID 重复`);
      }
      ids.add(section.id);
    });
  }

  return document;
}

export async function loadPaletteMenuRuntimeConfig({
  fetchImpl = globalThis.fetch,
  url = PALETTE_MENU_CONFIG_URL,
  timeoutMs = 5000
} = {}) {
  const controller = new AbortController();
  let timeout;
  try {
    const sections = await Promise.race([
      (async () => {
        const response = await fetchImpl(url, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
        if (response.status === 404) return {};
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return validatePaletteMenuConfiguration(await response.json());
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('读取配置超时'));
        }, timeoutMs);
      })
    ]);
    return { sections, error: '' };
  } catch (error) {
    return { sections: {}, error: `左侧二级菜单配置加载失败，已使用内置菜单。${error.message}。请修正 palette-menus.json 后刷新页面。` };
  } finally {
    clearTimeout(timeout);
  }
}
