import runtimeSource from './legacy-runtime.txt?raw';
import * as canvasGraph from './canvasGraph.js';
import * as canvasRender from './canvasRenderService.js';
import * as canvasSelection from './canvasSelectionService.js';
import * as canvasState from './canvasStateService.js';
import * as faultBindingRuntimeService from './faultBindingRuntimeService.js';
import * as faultCatalogRender from './faultCatalogRenderService.js';
import * as faultTemplateRender from './faultTemplateRenderService.js';
import * as faultParameterPanelSchema from './faultParameterPanelSchema.js';
import * as faultSlotPanelSchema from './faultSlotPanelSchema.js';
import * as faultTagPanelSchema from './faultTagPanelSchema.js';
import * as propertyPanelSchema from './propertyPanelSchema.js';
import * as simulationPropertyPanelSchema from './simulationPropertyPanelSchema.js';
import * as simulationInterfaceLockService from './simulationInterfaceLockService.js';
import * as signalComponentRuntime from './signalComponentRuntime.js';
import * as signalSourceDomainService from './signalSourceDomainService.js';
import * as multimeterMeasurementService from './multimeterMeasurementService.js';
import * as displayConsoleConfig from '../constants/displayConsoleConfig.js';
import * as subsystemPropertyPanelSchema from './subsystemPropertyPanelSchema.js';
import * as practiceTaskPackageService from './practiceTaskPackageService.js';
import { installBackendStepSimulationRuntime } from './backendStepSimulationRuntime.js';
import {
  COMPONENT_GROUPS,
  COMPONENT_REGISTRY,
  buildComponentLibraryFromRegistry
} from './componentRegistry.js';
import {
  applyFlightModelPackage,
  exportFlightModelPackage,
  validateFlightModelPackage
} from './flightModelPackageService.js';
import {
  createWorkbenchSnapshot,
  restoreWorkbenchSnapshot
} from './workbenchSnapshotService.js';
import faultTypeCatalog from '../../fault-types/fault-type-catalog.json';

let mounted = false;
const DEFAULT_FLIGHT_MODEL_PACKAGE_PATH = 'model-packages/evtol-small-flight-control-fault-display.json';
const WORKBENCH_STORAGE_KEY = 'gz-workbench-system-model';

function normalizeBaseUrl(baseUrl = './') {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function getAppPublicBaseUrl() {
  const configuredBaseUrl = normalizeBaseUrl(import.meta.env.BASE_URL || './');
  if (configuredBaseUrl !== './') {
    return new URL(configuredBaseUrl, window.location.origin).toString();
  }

  const moduleScript = document.querySelector('script[type="module"][src]');
  if (moduleScript?.src) {
    return new URL(moduleScript.src.includes('/assets/') ? '../' : './', moduleScript.src).toString();
  }

  return new URL('./', window.location.href).toString();
}

function getDefaultFlightModelPackageUrl() {
  return new URL(DEFAULT_FLIGHT_MODEL_PACKAGE_PATH, getAppPublicBaseUrl()).toString();
}

function isPublicDemoDeployment() {
  if (typeof window === 'undefined') {
    return false;
  }

  const { hostname, pathname, search } = window.location;
  const params = new URLSearchParams(search);

  return params.get('demo') === '1'
    || (
      hostname === 'blank1cheng.github.io'
      && pathname.replace(/\/+$/, '').endsWith('/uav-fault-platform')
    );
}

function getDefaultFlightModelLoadOptions() {
  return {
    force: true,
    resetStoredWorkbench: true,
    publicDemo: isPublicDemoDeployment()
  };
}

function resetStoredWorkbenchIfRequested(options = {}) {
  if (!options.resetStoredWorkbench) {
    return;
  }

  try {
    window.localStorage?.removeItem(WORKBENCH_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in hardened browser contexts; forced import still proceeds.
  }
}

function shouldSkipDefaultFlightModelLoad({ force = false } = {}) {
  if (force) {
    return false;
  }

  if (!window.__GZ_AUTO_LOAD_DEFAULT_MODEL__ || import.meta.env.MODE === 'test' || window.__GZ_DISABLE_DEFAULT_MODEL__) {
    return true;
  }

  const state = window.__GZ_STATE__;
  return Boolean(state?.sysLoaded || state?.modelNodes?.length || window.__GZ_DEFAULT_FLIGHT_MODEL_LOADING__);
}

export async function loadDefaultFlightModelPackage(options = {}) {
  if (shouldSkipDefaultFlightModelLoad(options)) {
    return { ok: false, skipped: true, reason: 'default-model-load-skipped' };
  }

  const packageApi = window.__GZ_FLIGHT_MODEL_PACKAGE__;
  if (typeof packageApi?.importObject !== 'function') {
    return { ok: false, errors: ['Flight model package bridge is not ready.'] };
  }

  window.__GZ_DEFAULT_FLIGHT_MODEL_LOADING__ = true;
  resetStoredWorkbenchIfRequested(options);

  try {
    const pkg = options.packageObject ?? await fetchDefaultFlightModelPackage(options.url);
    const result = packageApi.importObject(pkg);

    window.__GZ_DEFAULT_FLIGHT_MODEL_STATE__ = {
      loaded: Boolean(result?.ok),
      modelId: result?.descriptor?.modelId ?? pkg?.modelId ?? null,
      modelName: result?.descriptor?.modelName ?? pkg?.modelName ?? null,
      source: options.packageObject ? 'provided-object' : options.url ?? getDefaultFlightModelPackageUrl(),
      publicDemo: Boolean(options.publicDemo),
      errors: result?.errors ?? []
    };

    if (options.publicDemo) {
      window.__GZ_PUBLIC_DEMO_MODE__ = true;
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load default flight model package.';
    window.__GZ_DEFAULT_FLIGHT_MODEL_STATE__ = {
      loaded: false,
      modelId: null,
      modelName: null,
      source: options.url ?? getDefaultFlightModelPackageUrl(),
      errors: [message]
    };
    return { ok: false, errors: [message] };
  } finally {
    window.__GZ_DEFAULT_FLIGHT_MODEL_LOADING__ = false;
  }
}

async function fetchDefaultFlightModelPackage(url = getDefaultFlightModelPackageUrl()) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch default flight model package: ${response.status}`);
  }
  return response.json();
}

function createExportMeta(state = {}) {
  const activeModelPackage = state.activeModelPackage ?? null;
  const taskName = typeof state.taskName === 'string' && state.taskName.trim()
    ? state.taskName.trim()
    : null;
  if (activeModelPackage) {
    return {
      modelId: activeModelPackage.modelId ?? 'workbench-export',
      modelName: taskName ?? activeModelPackage.modelName ?? 'Workbench Export',
      description: activeModelPackage.description ?? '',
      systemFamily: activeModelPackage.systemFamily ?? null,
      supportedFaultLibraries: Array.isArray(activeModelPackage.supportedFaultLibraries)
        ? activeModelPackage.supportedFaultLibraries
        : [],
      capabilities: activeModelPackage.capabilities ?? {},
      source: activeModelPackage.source ?? { origin: 'workbench-import' }
    };
  }

  return {
    modelId: 'workbench-export',
    modelName: taskName ?? 'Workbench Export',
    description: '',
    systemFamily: null,
    supportedFaultLibraries: [],
    capabilities: {},
    source: { origin: 'workbench-export' }
  };
}

function createExportSnapshot(state = {}) {
  return createWorkbenchSnapshot(state);
}

export function mountLegacyRuntime() {
  if (mounted || window.__GZ_LEGACY_RUNTIME_BOOTED__) {
    return;
  }

  window.__GZ_AUTO_LOAD_DEFAULT_MODEL__ = window.__GZ_AUTO_LOAD_DEFAULT_MODEL__ ?? true;
  window.__GZ_WORKBENCH_SNAPSHOT__ = {
    createWorkbenchSnapshot,
    restoreWorkbenchSnapshot
  };
  window.__GZ_CANVAS_GRAPH__ = canvasGraph;
  window.__GZ_CANVAS_RENDER__ = canvasRender;
  window.__GZ_CANVAS_SELECTION__ = canvasSelection;
  window.__GZ_CANVAS_STATE__ = canvasState;
  window.__GZ_FAULT_BINDING_RUNTIME__ = faultBindingRuntimeService;
  window.__GZ_FAULT_CATALOG_RENDER__ = faultCatalogRender;
  window.__GZ_FAULT_TEMPLATE_RENDER__ = faultTemplateRender;
  window.__GZ_FAULT_TYPE_CATALOG__ = faultTypeCatalog;
  window.__GZ_FAULT_PARAMETER_PANEL_SCHEMA__ = faultParameterPanelSchema;
  window.__GZ_FAULT_SLOT_PANEL_SCHEMA__ = faultSlotPanelSchema;
  window.__GZ_FAULT_TAG_PANEL_SCHEMA__ = faultTagPanelSchema;
  window.__GZ_COMPONENT_GROUPS__ = COMPONENT_GROUPS;
  window.__GZ_COMPONENT_REGISTRY__ = COMPONENT_REGISTRY;
  window.__GZ_COMPONENT_LIBRARY__ = buildComponentLibraryFromRegistry(COMPONENT_REGISTRY);
  window.__GZ_PROPERTY_PANEL_SCHEMA__ = propertyPanelSchema;
  window.__GZ_SIMULATION_PROPERTY_PANEL_SCHEMA__ = simulationPropertyPanelSchema;
  window.__GZ_SIMULATION_INTERFACE_LOCK__ = simulationInterfaceLockService;
  window.__GZ_SUBSYSTEM_PROPERTY_PANEL_SCHEMA__ = subsystemPropertyPanelSchema;
  window.__GZ_SIGNAL_COMPONENT_RUNTIME__ = signalComponentRuntime;
  window.__GZ_SIGNAL_SOURCE_DOMAIN__ = signalSourceDomainService;
  window.__GZ_MULTIMETER_MEASUREMENT__ = multimeterMeasurementService;
  window.__GZ_DISPLAY_CONSOLE_CONFIG__ = displayConsoleConfig;
  window.__GZ_PRACTICE_TASK_PACKAGE__ = practiceTaskPackageService;
  window.__GZ_FLIGHT_MODEL_PACKAGE__ = {
    validate(pkg) {
      return validateFlightModelPackage(pkg);
    },
    importObject(pkg) {
      const result = applyFlightModelPackage(pkg, {
        existingSnapshot: createWorkbenchSnapshot(window.__GZ_STATE__ ?? {})
      });
      if (!result.ok) {
        return result;
      }

      try {
        if (typeof window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__ === 'function') {
          window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__(pkg, result);
        }
      } catch (error) {
        return {
          ok: false,
          errors: [error instanceof Error ? error.message : 'Failed to apply flight model package.']
        };
      }

      return result;
    },
    exportCurrent() {
      const state = window.__GZ_STATE__ ?? {};

      return exportFlightModelPackage({
        meta: createExportMeta(state),
        state: createExportSnapshot(state),
        faultLibrary: state.availableFaultModels ?? []
      });
    }
  };
  window.__GZ_LOAD_DEFAULT_FLIGHT_MODEL__ = loadDefaultFlightModelPackage;
  window.eval(`${runtimeSource}\n//# sourceURL=gz-legacy-runtime.js`);
  installBackendStepSimulationRuntime(window, {
    enabled: import.meta.env.MODE !== 'test',
    onError(error) {
      console.warn('[backend-step-simulation] falling back to legacy runtime', error);
    }
  });

  queueMicrotask(() => {
    const options = getDefaultFlightModelLoadOptions();
    loadDefaultFlightModelPackage(options).catch((error) => {
      window.__GZ_DEFAULT_FLIGHT_MODEL_STATE__ = {
        loaded: false,
        modelId: null,
        modelName: null,
        source: getDefaultFlightModelPackageUrl(),
        publicDemo: Boolean(options.publicDemo),
        errors: [error instanceof Error ? error.message : 'Failed to load default flight model package.']
      };
    });
  });

  window.__GZ_LEGACY_RUNTIME_BOOTED__ = true;
  mounted = true;
}

export function __resetLegacyRuntimeForTests() {
  const runtimeListeners = window.__GZ_RUNTIME_LISTENERS__;
  if (runtimeListeners) {
    if (runtimeListeners.canvasWindowKeydown) {
      window.removeEventListener('keydown', runtimeListeners.canvasWindowKeydown);
    }
    if (runtimeListeners.canvasWindowResize) {
      window.removeEventListener('resize', runtimeListeners.canvasWindowResize);
    }
    if (runtimeListeners.pythonBindingConfirm) {
      window.removeEventListener('gz:python-binding-confirm', runtimeListeners.pythonBindingConfirm);
    }
    if (runtimeListeners.pythonBindingUnbind) {
      window.removeEventListener('gz:python-binding-unbind', runtimeListeners.pythonBindingUnbind);
    }
    if (runtimeListeners.overlayEscapeKeydown) {
      document.removeEventListener('keydown', runtimeListeners.overlayEscapeKeydown);
    }
    if (runtimeListeners.scopeWindowDragPointerMove) {
      window.removeEventListener('pointermove', runtimeListeners.scopeWindowDragPointerMove);
      window.removeEventListener('mousemove', runtimeListeners.scopeWindowDragPointerMove);
      document.removeEventListener('pointermove', runtimeListeners.scopeWindowDragPointerMove);
      document.removeEventListener('mousemove', runtimeListeners.scopeWindowDragPointerMove);
      document.removeEventListener('pointermove', runtimeListeners.scopeWindowDragPointerMove, true);
      document.removeEventListener('mousemove', runtimeListeners.scopeWindowDragPointerMove, true);
    }
    if (runtimeListeners.scopeWindowDragPointerUp) {
      window.removeEventListener('pointerup', runtimeListeners.scopeWindowDragPointerUp);
      window.removeEventListener('mouseup', runtimeListeners.scopeWindowDragPointerUp);
      document.removeEventListener('pointerup', runtimeListeners.scopeWindowDragPointerUp);
      document.removeEventListener('mouseup', runtimeListeners.scopeWindowDragPointerUp);
      document.removeEventListener('pointerup', runtimeListeners.scopeWindowDragPointerUp, true);
      document.removeEventListener('mouseup', runtimeListeners.scopeWindowDragPointerUp, true);
    }
    if (runtimeListeners.scopeWindowDragPointerCancel) {
      window.removeEventListener('pointercancel', runtimeListeners.scopeWindowDragPointerCancel);
      document.removeEventListener('pointercancel', runtimeListeners.scopeWindowDragPointerCancel);
      document.removeEventListener('pointercancel', runtimeListeners.scopeWindowDragPointerCancel, true);
    }
    if (runtimeListeners.scopeWindowDragLostPointerCapture) {
      document.removeEventListener('lostpointercapture', runtimeListeners.scopeWindowDragLostPointerCapture);
    }
    if (runtimeListeners.scopeWindowDragWindowBlur) {
      window.removeEventListener('blur', runtimeListeners.scopeWindowDragWindowBlur);
    }
    if (runtimeListeners.canvasCommandPointerEnd) {
      window.removeEventListener('pointerup', runtimeListeners.canvasCommandPointerEnd);
      window.removeEventListener('pointercancel', runtimeListeners.canvasCommandPointerEnd);
    }
    if (runtimeListeners.canvasCommandKeydown) {
      window.removeEventListener('keydown', runtimeListeners.canvasCommandKeydown);
    }
    if (runtimeListeners.canvasCommandToolbarClick) {
      document.removeEventListener('click', runtimeListeners.canvasCommandToolbarClick);
    }
    if (runtimeListeners.canvasCommandFullscreenChange) {
      document.removeEventListener('fullscreenchange', runtimeListeners.canvasCommandFullscreenChange);
    }
    if (runtimeListeners.diagnosticPointSearchInput) {
      document.removeEventListener('input', runtimeListeners.diagnosticPointSearchInput);
    }
    if (runtimeListeners.diagnosticPointSearchClick) {
      document.removeEventListener('click', runtimeListeners.diagnosticPointSearchClick);
    }
    if (runtimeListeners.simulationConfigInput) {
      document.getElementById('sim-dur')?.removeEventListener('input', runtimeListeners.simulationConfigInput);
      document.getElementById('sim-step')?.removeEventListener('input', runtimeListeners.simulationConfigInput);
      document.getElementById('sim-dur-unit')?.removeEventListener('change', runtimeListeners.simulationConfigInput);
      document.getElementById('sim-step-unit')?.removeEventListener('change', runtimeListeners.simulationConfigInput);
      document.getElementById('sim-dur')?.removeEventListener('change', runtimeListeners.simulationConfigInput);
      document.getElementById('sim-step')?.removeEventListener('change', runtimeListeners.simulationConfigInput);
    }
  }

  mounted = false;
  delete window.__GZ_LEGACY_RUNTIME_BOOTED__;
  delete window.__GZ_BACKEND_STEP_RUNTIME_INSTALLED__;
  delete window.__GZ_WORKBENCH_SNAPSHOT__;
  delete window.__GZ_CANVAS_GRAPH__;
  delete window.__GZ_CANVAS_RENDER__;
  delete window.__GZ_CANVAS_SELECTION__;
  delete window.__GZ_CANVAS_STATE__;
  delete window.__GZ_FAULT_BINDING_RUNTIME__;
  delete window.__GZ_FAULT_CATALOG_RENDER__;
  delete window.__GZ_FAULT_TEMPLATE_RENDER__;
  delete window.__GZ_FAULT_TYPE_CATALOG__;
  delete window.__GZ_FAULT_PARAMETER_PANEL_SCHEMA__;
  delete window.__GZ_FAULT_SLOT_PANEL_SCHEMA__;
  delete window.__GZ_FAULT_TAG_PANEL_SCHEMA__;
  delete window.__GZ_COMPONENT_GROUPS__;
  delete window.__GZ_COMPONENT_REGISTRY__;
  delete window.__GZ_COMPONENT_LIBRARY__;
  delete window.__GZ_PROPERTY_PANEL_SCHEMA__;
  delete window.__GZ_SIMULATION_PROPERTY_PANEL_SCHEMA__;
  delete window.__GZ_SIMULATION_INTERFACE_LOCK__;
  delete window.__GZ_SUBSYSTEM_PROPERTY_PANEL_SCHEMA__;
  delete window.__GZ_SIGNAL_COMPONENT_RUNTIME__;
  delete window.__GZ_SIGNAL_SOURCE_DOMAIN__;
  delete window.__GZ_MULTIMETER_MEASUREMENT__;
  delete window.__GZ_PRACTICE_TASK_PACKAGE__;
  delete window.__GZ_MULTIMETER_LEAD_BINDING__;
  delete window.beginMultimeterLeadBinding;
  delete window.__multimeterCanvasLeadControlsWrapped;
  delete window.__multimeterCanvasLeadControlsFinalWrapped;
  delete window.__GZ_FLIGHT_MODEL_PACKAGE__;
  delete window.__GZ_LOAD_DEFAULT_FLIGHT_MODEL__;
  delete window.__GZ_DEFAULT_FLIGHT_MODEL_LOADING__;
  delete window.__GZ_DEFAULT_FLIGHT_MODEL_STATE__;
  delete window.__GZ_PUBLIC_DEMO_MODE__;
  delete window.__GZ_DIAGNOSTIC_FAULT_CATALOG_SOURCE__;
  delete window.__GZ_DIAGNOSTIC_FAULT_CATALOG_SYNC__;
  delete window.__GZ_DISABLE_DEFAULT_MODEL__;
  delete window.__GZ_APPLY_FLIGHT_MODEL_PACKAGE__;
  delete window.__GZ_PYTHON_BINDING_EVENTS__;
  delete window.__simulationPowerPortsInstalled;
  delete window.__GZ_SCOPE_WINDOW_DRAG_BOUND__;
  delete window.__GZ_RUNTIME_LISTENERS__;
  delete window.__compactDiagnosisSearchEvents;
  delete window.__visualInjectionRemoveWrapped;
  delete window.__visualInjectionRenderModelNodesWrapped;
  delete window.__faultTaskLoaderUpdateWrapped;
  delete window.__faultTaskLoaderApplyWrapped;
  delete window.__layeredFaultGetNodePortsWrapped;
  delete window.__layeredFaultSubtitleWrapped;
  delete window.__layeredFaultCreateNodeWrapped;
  delete window.__layeredFaultSelectNodeWrapped;
  delete window.__layeredFaultRenderModelNodesWrapped;
  delete window.__layeredFaultRenderEdgesWrapped;
  delete window.__layeredFaultPortClickWrapped;
  if (window.__layeredFaultTargetCleanups) {
    window.__layeredFaultTargetCleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        // Ignore stale DOM listener cleanup during test reset.
      }
    });
  }
  delete window.__layeredFaultTargetCleanups;
  if (window.__layeredFaultBindingClickHandler) {
    document.removeEventListener('click', window.__layeredFaultBindingClickHandler, true);
  }
  delete window.__layeredFaultBindingClickHandler;
}
