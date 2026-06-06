export const FLIGHT_MODEL_SCHEMA_VERSION = 1;
const SUPPORTED_FLIGHT_MODEL_SCHEMA_VERSIONS = new Set([FLIGHT_MODEL_SCHEMA_VERSION, '2.0']);
export const FLIGHT_MODEL_PACKAGE_TYPE = 'flight-control-model';

import { createSimulationBlockPythonBinding } from '../composables/useWorkbenchState.js';
import {
  createWorkbenchSnapshot,
  restoreWorkbenchSnapshot
} from './workbenchSnapshotService.js';
import {
  normalizeModelStoreSnapshot
} from './modelStore.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeModule(module) {
  const safeModule = clone(module ?? {});

  return {
    moduleId: safeModule.moduleId ?? null,
    fileName: safeModule.fileName ?? null,
    entryFunction: safeModule.entryFunction ?? null,
    category: safeModule.category ?? 'uncategorized',
    sourcePackageId: safeModule.sourcePackageId ?? null,
    sourcePackageName: safeModule.sourcePackageName ?? null,
    source: safeModule.source ?? '',
    parsedInterface: safeModule.parsedInterface ?? null
  };
}

function createModuleRegistry(pythonModules) {
  const registry = new Map();

  pythonModules.forEach((module) => {
    const normalized = normalizeModule(module);

    if (hasUsableText(normalized.moduleId) && !registry.has(normalized.moduleId)) {
      registry.set(normalized.moduleId, normalized);
    }

    if (hasUsableText(normalized.fileName) && !registry.has(normalized.fileName)) {
      registry.set(normalized.fileName, normalized);
    }
  });

  return registry;
}

function collectSnapshotNodes(snapshot) {
  const nodes = [];
  const seenNodeIds = new Set();
  const appendNodes = (items) => {
    if (!Array.isArray(items)) {
      return;
    }

    items.forEach((node) => {
      if (!isPlainObject(node)) {
        nodes.push(node);
        return;
      }

      const nodeId = hasUsableText(node.id) ? node.id : null;
      if (nodeId && seenNodeIds.has(nodeId)) {
        return;
      }

      if (nodeId) {
        seenNodeIds.add(nodeId);
      }
      nodes.push(node);
    });
  };

  appendNodes(snapshot?.modelNodes);

  if (isPlainObject(snapshot?.canvases)) {
    Object.values(snapshot.canvases).forEach((canvas) => {
      appendNodes(canvas?.nodes);
    });
  }

  return nodes;
}

function mapSnapshotNodes(snapshot, transformNode) {
  const safeSnapshot = clone(snapshot ?? {});

  safeSnapshot.modelNodes = Array.isArray(safeSnapshot.modelNodes)
    ? safeSnapshot.modelNodes.map(transformNode)
    : [];

  if (isPlainObject(safeSnapshot.canvases)) {
    Object.entries(safeSnapshot.canvases).forEach(([canvasId, canvas]) => {
      if (!isPlainObject(canvas)) {
        return;
      }

      safeSnapshot.canvases[canvasId] = {
        ...canvas,
        nodes: Array.isArray(canvas.nodes) ? canvas.nodes.map(transformNode) : []
      };
    });
  }

  return safeSnapshot;
}

function isHydratedBinding(binding) {
  return Boolean(
    binding?.bound
      && hasUsableText(binding.entryFunction)
      && hasUsableText(binding.rawSource ?? binding.source)
      && isPlainObject(binding.parsedInterface)
  );
}

function hydrateSimulationBinding(binding, moduleEntry) {
  if (!binding?.bound || !moduleEntry || !isPlainObject(moduleEntry.parsedInterface)) {
    return binding;
  }

  if (isHydratedBinding(binding)) {
    return binding;
  }

  const hydrated = createSimulationBlockPythonBinding({
    ...moduleEntry.parsedInterface,
    rawSource: moduleEntry.source
  }, {
    moduleId: moduleEntry.moduleId,
    moduleCategory: moduleEntry.category,
    sourcePackageId: moduleEntry.sourcePackageId,
    sourcePackageName: moduleEntry.sourcePackageName,
    executionMode: binding.executionMode
  });

  return {
    ...hydrated,
    ...clone(binding),
    bound: true,
    moduleId: binding.moduleId ?? moduleEntry.moduleId,
    fileName: binding.fileName ?? moduleEntry.fileName,
    moduleName: binding.moduleName ?? hydrated.moduleName,
    moduleCategory: binding.moduleCategory ?? moduleEntry.category,
    sourcePackageId: binding.sourcePackageId ?? moduleEntry.sourcePackageId,
    sourcePackageName: binding.sourcePackageName ?? moduleEntry.sourcePackageName,
    description: binding.description || hydrated.description,
    entryFunction: binding.entryFunction ?? moduleEntry.entryFunction,
    parsedInterface: binding.parsedInterface ?? clone(moduleEntry.parsedInterface),
    rawSource: binding.rawSource || moduleEntry.source,
    portMapping: hydrated.portMapping,
    executionConfig: isPlainObject(binding.executionConfig) ? binding.executionConfig : hydrated.executionConfig
  };
}

function hydrateSnapshotBindings(snapshot, pythonModules) {
  const registry = createModuleRegistry(pythonModules);
  const errors = [];
  const hydrateNode = (node) => {
    if (!isPlainObject(node) || node.type !== 'simulation_block' || !node?.pythonBinding?.bound) {
      return node;
    }

    const binding = node.pythonBinding;
    const moduleEntry = registry.get(binding.moduleId) ?? registry.get(binding.fileName);

    if (!moduleEntry) {
      if (!isHydratedBinding(binding)) {
        const moduleRef = binding.moduleId ?? binding.fileName ?? 'unknown-module';
        errors.push(`Simulation block "${node.id ?? 'unknown-node'}" references missing python module "${moduleRef}".`);
      }
      return node;
    }

    const hydratedBinding = hydrateSimulationBinding(binding, moduleEntry);
    if (!isHydratedBinding(hydratedBinding)) {
      const moduleRef = binding.moduleId ?? binding.fileName ?? moduleEntry.moduleId ?? moduleEntry.fileName ?? 'unknown-module';
      errors.push(`Simulation block "${node.id ?? 'unknown-node'}" has an unusable python binding for module "${moduleRef}".`);
      return node;
    }

    return {
      ...node,
      pythonBinding: hydratedBinding
    };
  };

  return {
    snapshot: mapSnapshotNodes(snapshot, hydrateNode),
    errors
  };
}

function exportSimulationNode(node) {
  if (!isPlainObject(node)) {
    return node;
  }

  if (node?.type !== 'simulation_block') {
    return clone(node);
  }

  const binding = node.pythonBinding ?? null;
  if (!binding || !binding.bound) {
    return {
      ...clone(node),
      pythonBinding: binding ? clone(binding) : null
    };
  }

  const moduleId = binding.moduleId;
  const fileName = binding.fileName;
  const entryFunction = binding.entryFunction;
  const source = binding.rawSource ?? binding.source ?? '';
  const exportable = hasUsableText(moduleId)
    && hasUsableText(fileName)
    && hasUsableText(entryFunction)
    && hasUsableText(source);

  return {
    ...clone(node),
    pythonBinding: exportable ? clone(binding) : null
  };
}

function collectPythonModulesFromSnapshot(snapshot) {
  return collectSnapshotNodes(snapshot).reduce((modules, node) => {
    if (!isPlainObject(node) || node.type !== 'simulation_block' || !node?.pythonBinding?.bound) {
      return modules;
    }

    const binding = node.pythonBinding;
    const moduleId = binding.moduleId;
    const fileName = binding.fileName;
    const entryFunction = binding.entryFunction;
    const source = binding.rawSource ?? binding.source ?? '';

    if (!hasUsableText(moduleId) || !hasUsableText(fileName) || !hasUsableText(entryFunction) || !hasUsableText(source)) {
      return modules;
    }

    if (!modules.has(moduleId)) {
      modules.set(moduleId, normalizeModule({
        moduleId,
        fileName,
        entryFunction,
        category: binding.moduleCategory ?? 'uncategorized',
        sourcePackageId: binding.sourcePackageId ?? null,
        sourcePackageName: binding.sourcePackageName ?? null,
        source,
        parsedInterface: binding.parsedInterface ?? null
      }));
    }

    return modules;
  }, new Map());
}

function hasUsableText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validatePlainObjectArray(errors, value, path) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return;
  }

  value.forEach((item, index) => {
    if (!isPlainObject(item)) {
      errors.push(`${path}[${index}] must be an object.`);
    }
  });
}

export function validateFlightModelPackage(pkg) {
  const errors = [];
  const seenModuleIds = new Set();
  const seenFileNames = new Set();

  if (!isPlainObject(pkg)) {
    return { ok: false, errors: ['Package must be an object.'] };
  }

  if (!SUPPORTED_FLIGHT_MODEL_SCHEMA_VERSIONS.has(pkg.schemaVersion)) {
    errors.push(`schemaVersion must be ${FLIGHT_MODEL_SCHEMA_VERSION} or 2.0.`);
  }

  if (pkg.packageType !== FLIGHT_MODEL_PACKAGE_TYPE) {
    errors.push(`packageType must be ${FLIGHT_MODEL_PACKAGE_TYPE}.`);
  }

  if (!Array.isArray(pkg.pythonModules)) {
    errors.push('pythonModules must be an array.');
  } else {
    pkg.pythonModules.forEach((module, index) => {
      if (!isPlainObject(module)) {
        errors.push(`pythonModules[${index}] must be an object.`);
        return;
      }

      if (!hasUsableText(module.moduleId)) {
        errors.push(`pythonModules[${index}].moduleId is required.`);
      }

      if (!hasUsableText(module.fileName)) {
        errors.push(`pythonModules[${index}].fileName is required.`);
      }

      if (!hasUsableText(module.entryFunction)) {
        errors.push(`pythonModules[${index}].entryFunction is required.`);
      }

      if (!hasUsableText(module.source)) {
        errors.push(`pythonModules[${index}].source is required.`);
      }

      if (hasUsableText(module.moduleId)) {
        if (seenModuleIds.has(module.moduleId)) {
          errors.push(`Duplicate moduleId "${module.moduleId}" is not allowed.`);
        } else {
          seenModuleIds.add(module.moduleId);
        }
      }

      if (hasUsableText(module.fileName)) {
        if (seenFileNames.has(module.fileName)) {
          errors.push(`Duplicate fileName "${module.fileName}" is not allowed.`);
        } else {
          seenFileNames.add(module.fileName);
        }
      }
    });
  }

  if (!isPlainObject(pkg.workbenchSnapshot)) {
    errors.push('workbenchSnapshot must be an object.');
  } else {
    const hasCanvasRegistry = isPlainObject(pkg.workbenchSnapshot.canvases);

    if (Array.isArray(pkg.workbenchSnapshot.modelNodes)) {
      validatePlainObjectArray(errors, pkg.workbenchSnapshot.modelNodes, 'workbenchSnapshot.modelNodes');
    } else if (!hasCanvasRegistry) {
      errors.push('workbenchSnapshot.modelNodes must be an array.');
    }

    if (Array.isArray(pkg.workbenchSnapshot.modelEdges)) {
      validatePlainObjectArray(errors, pkg.workbenchSnapshot.modelEdges, 'workbenchSnapshot.modelEdges');
    } else if (!hasCanvasRegistry) {
      errors.push('workbenchSnapshot.modelEdges must be an array.');
    }
  }

  const availableFaultIds = new Set();
  const registerFaultIds = (collection) => {
    if (!Array.isArray(collection)) {
      return;
    }

    collection.forEach((faultModel) => {
      if (isPlainObject(faultModel) && hasUsableText(faultModel.id)) {
        availableFaultIds.add(faultModel.id);
      }
    });
  };

  registerFaultIds(pkg.faultLibrary);
  registerFaultIds(pkg.diagnosticModel?.faultCases);
  registerFaultIds(pkg.workbenchSnapshot?.importedFaultModels);

  if (pkg.diagnosticModel !== undefined) {
    if (!isPlainObject(pkg.diagnosticModel)) {
      errors.push('diagnosticModel must be an object.');
    } else {
      if (pkg.diagnosticModel.testPoints !== undefined) {
        validatePlainObjectArray(errors, pkg.diagnosticModel.testPoints, 'diagnosticModel.testPoints');
      }
      if (pkg.diagnosticModel.faultCases !== undefined) {
        validatePlainObjectArray(errors, pkg.diagnosticModel.faultCases, 'diagnosticModel.faultCases');
      }
    }
  }

  collectSnapshotNodes(pkg.workbenchSnapshot).forEach((node, index) => {
    if (!isPlainObject(node) || !isPlainObject(node.injectedFault)) {
      return;
    }

    const nodeLabel = hasUsableText(node.id) ? node.id : `index-${index}`;
    const faultModelId = node.injectedFault.modelId;

    if (!hasUsableText(faultModelId)) {
      errors.push(`workbenchSnapshot.modelNodes node "${nodeLabel}" has injectedFault without a modelId.`);
      return;
    }

    if (!availableFaultIds.has(faultModelId)) {
      errors.push(`workbenchSnapshot.modelNodes node "${nodeLabel}" references unknown fault modelId "${faultModelId}".`);
    }
  });

  return {
    ok: errors.length === 0,
    errors
  };
}

export function createFlightModelPackageDescriptor(pkg = {}) {
  return {
    modelId: pkg.modelId ?? null,
    modelName: pkg.modelName ?? null,
    description: pkg.description ?? '',
    schemaVersion: pkg.schemaVersion ?? null,
    packageType: pkg.packageType ?? null,
    systemFamily: pkg.systemFamily ?? null,
    supportedFaultLibraries: Array.isArray(pkg.supportedFaultLibraries)
      ? clone(pkg.supportedFaultLibraries)
      : [],
    capabilities: isPlainObject(pkg.capabilities) ? clone(pkg.capabilities) : {},
    moduleCount: Array.isArray(pkg.pythonModules) ? pkg.pythonModules.length : 0,
    faultCount: Array.isArray(pkg.faultLibrary) ? pkg.faultLibrary.length : 0
  };
}

export function applyFlightModelPackage(pkg) {
  const validation = validateFlightModelPackage(pkg);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors
    };
  }

  const pythonModules = clone(Array.isArray(pkg.pythonModules) ? pkg.pythonModules : []);
  const packageFaultInstances = Array.isArray(pkg.faultInstances)
    ? pkg.faultInstances
    : pkg.workbenchSnapshot?.faultInstances;
  const restoredSnapshot = restoreWorkbenchSnapshot({
    ...pkg.workbenchSnapshot,
    faultInstances: packageFaultInstances
  });
  const hydratedSnapshot = hydrateSnapshotBindings(restoredSnapshot, pythonModules);

  if (hydratedSnapshot.errors.length > 0) {
    return {
      ok: false,
      errors: hydratedSnapshot.errors
    };
  }

  const normalizedSnapshot = normalizeModelStoreSnapshot(hydratedSnapshot.snapshot, {
    faultCapabilityMap: pkg.faultCapabilityMap
  });

  return {
    ok: true,
    snapshot: normalizedSnapshot,
    descriptor: createFlightModelPackageDescriptor(pkg),
    faultLibrary: clone(Array.isArray(pkg.faultLibrary) ? pkg.faultLibrary : []),
    diagnosticModel: isPlainObject(pkg.diagnosticModel) ? clone(pkg.diagnosticModel) : null,
    pythonModules
  };
}

export function buildFlightModelPackage({ meta = {}, snapshot = {}, faultLibrary = [] } = {}) {
  const normalizedSnapshot = normalizeModelStoreSnapshot(createWorkbenchSnapshot(snapshot), {
    faultCapabilityMap: meta.faultCapabilityMap
  });
  const exportedSnapshot = mapSnapshotNodes(normalizedSnapshot, exportSimulationNode);
  const pythonModulesById = collectPythonModulesFromSnapshot(normalizedSnapshot);

  return {
    schemaVersion: FLIGHT_MODEL_SCHEMA_VERSION,
    packageType: FLIGHT_MODEL_PACKAGE_TYPE,
    modelId: meta.modelId ?? null,
    modelName: meta.modelName ?? null,
    description: meta.description ?? '',
    systemFamily: meta.systemFamily ?? null,
    supportedFaultLibraries: Array.isArray(meta.supportedFaultLibraries)
      ? clone(meta.supportedFaultLibraries)
      : [],
    capabilities: isPlainObject(meta.capabilities) ? clone(meta.capabilities) : {},
    source: clone(meta.source ?? {}),
    pythonModules: Array.from(pythonModulesById.values()),
    faultLibrary: clone(faultLibrary ?? []),
    faultInstances: clone(Array.isArray(normalizedSnapshot.faultInstances) ? normalizedSnapshot.faultInstances : []),
    workbenchSnapshot: exportedSnapshot
  };
}

export function exportFlightModelPackage({ meta = {}, state = {}, faultLibrary = [] } = {}) {
  return buildFlightModelPackage({
    meta,
    snapshot: state,
    faultLibrary
  });
}
