import { executePythonBinding, executePythonBindingSync } from './pythonExecutionAdapter.js';
import {
  executeFlowBlockPythonBindingSync,
  executeSimulationBlockPythonBindingSync,
  getPythonBindingDefaultValue
} from './pythonFlowBindingRuntime.js';
import {
  applyScalarFault,
  applyScalarFaultBindings,
  appendFaultBinding,
  buildFaultPythonModuleSpec,
  createFaultBinding,
  createInjectedFaultPayload,
  findCompatibleFaultTarget,
  getFaultBindings,
  getFaultRuntimeBehavior,
  hasActiveFaultBinding,
  inferFaultPropagationMode,
  isFaultActive,
  resolveFaultParameters
} from './faultInjectionService.js';
import {
  describeModelFaultCompatibility,
  filterCompatibleFaultTypes,
  getModelFaultLibraryIds,
  getModelSystemFamily,
  isFaultCompatibleWithModel,
  isFaultLibraryCompatibleWithModel
} from './modelFaultCompatibilityService.js';

export function createSimulationRuntimeFacade() {
  return {
    initialize() {
      window.simInit?.();
    },
    run() {
      window.simRun?.();
    },
    pause() {
      window.simPause?.();
    },
    step() {
      window.simStep?.();
    },
    stop() {
      window.simStop?.();
    },
    executePythonBinding,
    executePythonBindingSync,
    executeFlowBlockPythonBindingSync,
    executeSimulationBlockPythonBindingSync,
    getPythonBindingDefaultValue,
    faultInjection: {
      applyScalarFault,
      applyScalarFaultBindings,
      appendFaultBinding,
      buildFaultPythonModuleSpec,
      createFaultBinding,
      createInjectedFaultPayload,
      findCompatibleFaultTarget,
      getFaultBindings,
      getFaultRuntimeBehavior,
      hasActiveFaultBinding,
      inferFaultPropagationMode,
      isFaultActive,
      resolveFaultParameters,
      compatibility: {
        describeModelFaultCompatibility,
        filterCompatibleFaultTypes,
        getModelFaultLibraryIds,
        getModelSystemFamily,
        isFaultCompatibleWithModel,
        isFaultLibraryCompatibleWithModel
      }
    }
  };
}

if (typeof window !== 'undefined') {
  window.__GZ_PYTHON_RUNTIME__ = {
    executePythonBinding,
    executePythonBindingSync,
    executeFlowBlockPythonBindingSync,
    executeSimulationBlockPythonBindingSync,
    getPythonBindingDefaultValue
  };
  window.__GZ_FAULT_INJECTION_RUNTIME__ = {
    applyScalarFault,
    applyScalarFaultBindings,
    appendFaultBinding,
    buildFaultPythonModuleSpec,
    createFaultBinding,
    createInjectedFaultPayload,
    findCompatibleFaultTarget,
    getFaultBindings,
    getFaultRuntimeBehavior,
    hasActiveFaultBinding,
    inferFaultPropagationMode,
    isFaultActive,
    resolveFaultParameters,
    compatibility: {
      describeModelFaultCompatibility,
      filterCompatibleFaultTypes,
      getModelFaultLibraryIds,
      getModelSystemFamily,
      isFaultCompatibleWithModel,
      isFaultLibraryCompatibleWithModel
    }
  };
}
