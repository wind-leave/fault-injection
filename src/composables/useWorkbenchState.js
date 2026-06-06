import { reactive, ref } from 'vue';
import { createInitialWorkbenchState } from '../constants/defaults.js';

const shellState = reactive(createInitialWorkbenchState());
const runtimeReady = ref(false);
const selectedNodeBinding = ref(null);

function resolvePortDisplayName(item) {
  return item.displayName ?? item.comment ?? item.name;
}

export function createDefaultPythonBinding() {
  return {
    bound: false,
    moduleId: null,
    fileName: null,
    moduleName: null,
    moduleCategory: null,
    sourcePackageId: null,
    sourcePackageName: null,
    description: '',
    entryFunction: null,
    parsedInterface: null,
    rawSource: '',
    executionMode: 'mock',
    executionConfig: {
      endpoint: 'http://127.0.0.1:8765/api/python-flow/execute',
      timeoutMs: 3000
    },
    portMapping: {
      inputs: [],
      outputs: [],
      middleVars: []
    }
  };
}

export function createSimulationBlockPythonBinding(parsedInterface, options = {}) {
  const moduleId =
    options.moduleId ??
    parsedInterface.moduleName ??
    (typeof parsedInterface.fileName === 'string'
      ? parsedInterface.fileName.replace(/\.py$/i, '')
      : null);

  return {
    ...createDefaultPythonBinding(),
    bound: true,
    moduleId,
    moduleCategory: options.moduleCategory ?? 'uncategorized',
    sourcePackageId: options.sourcePackageId ?? null,
    sourcePackageName: options.sourcePackageName ?? null,
    fileName: parsedInterface.fileName,
    moduleName: parsedInterface.moduleName,
    description: parsedInterface.description,
    entryFunction: parsedInterface.entryFunction,
    parsedInterface,
    rawSource: parsedInterface.rawSource,
    executionMode: options.executionMode ?? 'mock',
    portMapping: {
      inputs: (parsedInterface.inputs ?? []).map((item, index) => ({
        portId: `input-${index}`,
        varName: item.name,
        displayName: resolvePortDisplayName(item),
        type: item.type ?? 'any',
        default: item.default ?? null,
        comment: item.comment ?? '',
        connected: false
      })),
      outputs: (parsedInterface.outputs ?? []).map((item, index) => ({
        portId: `output-${index}`,
        varName: item.name,
        displayName: resolvePortDisplayName(item),
        type: item.type ?? 'any',
        comment: item.comment ?? ''
      })),
      middleVars: (parsedInterface.middleVars ?? []).map((item, index) => ({
        portId: `middle-${index}`,
        varName: item.name,
        displayName: resolvePortDisplayName(item),
        type: item.type ?? 'any',
        comment: item.comment ?? ''
      }))
    }
  };
}

export const createFlowBlockPythonBinding = createSimulationBlockPythonBinding;

export function useWorkbenchState() {
  function markReady() {
    runtimeReady.value = true;
  }

  function setSelectedNodeBinding(payload) {
    selectedNodeBinding.value = payload;
  }

  return {
    shellState,
    runtimeReady,
    selectedNodeBinding,
    markReady,
    setSelectedNodeBinding
  };
}
