import { executePythonBindingSync } from './pythonExecutionAdapter.js';
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
import { buildBackendExecutablePackage } from './backendExecutablePackageService.js';
import {
  createBackendSimulationSession,
  deleteBackendSimulationSession,
  runBackendSimulation,
  stepBackendSimulationSession
} from './backendSimulationClient.js';

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
    executePythonBindingSync,
    executeFlowBlockPythonBindingSync,
    executeSimulationBlockPythonBindingSync,
    getPythonBindingDefaultValue,
    backend: {
      buildExecutablePackage: buildBackendExecutablePackage,
      runSimulation: runBackendSimulation,
      createSession: createBackendSimulationSession,
      stepSession: stepBackendSimulationSession,
      deleteSession: deleteBackendSimulationSession
    },
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
  window.__GZ_BACKEND_SIMULATION__ = {
    buildExecutablePackage: buildBackendExecutablePackage,
    runSimulation: runBackendSimulation,
    createSession: createBackendSimulationSession,
    stepSession: stepBackendSimulationSession,
    deleteSession: deleteBackendSimulationSession
  };
}
