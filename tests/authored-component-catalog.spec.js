import { describe, expect, it } from 'vitest';
import {
  createAuthoredComponentRegistryEntry,
  registerAuthoredComponent
} from '../src/services/authoredComponentCatalogService.js';
import { COMPONENT_REGISTRY, getPaletteGroups, getSimulationMenuSections } from '../src/services/componentRegistry.js';

describe('authored component catalog', () => {
  it('creates a repeatable custom palette component with scalar and vector interfaces', () => {
    const component = createAuthoredComponentRegistryEntry({
      type: 'authored-vector-filter',
      name: '向量滤波器',
      categoryId: 'authored-category-signal',
      categoryLabel: '信号处理',
      description: '对三路输入做滤波处理',
      icon: '算',
      rawSource: 'def process(samples):\n    return samples',
      entryFunction: 'process',
      inputs: [{ name: '输入向量', varName: 'samples', type: 'number[]', vectorLength: 3 }],
      outputs: [{ name: '输出向量', varName: 'filtered', type: 'number[]', vectorLength: 3 }],
      parameters: [{ name: '滤波系数', key: 'coefficients', type: 'number[]', vectorLength: 3, defaultValue: [0.2, 0.3, 0.5] }]
    });

    expect(component).toMatchObject({
      type: 'authored-vector-filter',
      group: 'simulation',
      simulationMenu: 'authored-category-signal',
      simulationMenuLabel: '信号处理',
      palette: { icon: '算', repeatable: true },
      pythonBinding: { sourceKind: 'custom', executionMode: 'mock' }
    });
    expect(component.ports.inputs[0]).toMatchObject({ dataType: 'vector', vectorLength: 3, varName: 'samples' });
    expect(component.ports.outputs[0]).toMatchObject({ dataType: 'vector', vectorLength: 3, varName: 'filtered' });
    expect(component.defaults.parameterValues).toEqual({ coefficients: [0.2, 0.3, 0.5] });
  });

  it('registers a new category in the palette and preserves its Python source', () => {
    const type = 'authored-test-navigation-sensor';
    const result = registerAuthoredComponent({
      type,
      name: '导航传感器',
      categoryLabel: '传感器模型',
      icon: '传',
      fileName: 'navigation_sensor.py',
      rawSource: 'def process(altitude):\n    measurement = altitude\n    return measurement',
      inputs: [{ name: '高度', varName: 'altitude', type: 'number', defaultValue: 0 }],
      outputs: [{ name: '测量值', varName: 'measurement', type: 'number' }],
      parameters: []
    });

    expect(result.component).toMatchObject({
      type,
      rawSource: expect.stringContaining('def process')
    });
    expect(COMPONENT_REGISTRY[type].pythonBinding).toMatchObject({
      sourceKind: 'custom',
      rawSource: result.component.rawSource
    });

    const simulationComponents = getPaletteGroups()
      .find((group) => group.id === 'simulation')
      .components;
    const sections = getSimulationMenuSections(simulationComponents);
    expect(sections).toContainEqual(expect.objectContaining({
      id: result.component.categoryId,
      label: '传感器模型',
      components: [expect.objectContaining({ type })]
    }));
  });
});
