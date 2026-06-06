import { reactive } from 'vue';

const dialogsState = reactive({
  scope: false,
  template: false,
  faultLibrary: false,
  electricalFault: false,
  protocolFault: false,
  config: false,
  pythonBinding: {
    open: false,
    targetNode: null,
    parsedInterface: null,
    parseError: '',
    boundSnapshot: null
  },
  componentAuthoring: {
    open: false,
    parsedInterface: null
  },
  faultAuthoring: {
    open: false,
    target: null
  }
});

export function openPythonBindingDialog(payload = {}) {
  dialogsState.pythonBinding.open = true;
  dialogsState.pythonBinding.targetNode = payload.targetNode ?? null;
  dialogsState.pythonBinding.parsedInterface = payload.parsedInterface ?? null;
  dialogsState.pythonBinding.boundSnapshot = payload.boundSnapshot ?? null;
  dialogsState.pythonBinding.parseError = payload.parseError ?? '';
}

export function closePythonBindingDialog() {
  dialogsState.pythonBinding.open = false;
  dialogsState.pythonBinding.targetNode = null;
  dialogsState.pythonBinding.parsedInterface = null;
  dialogsState.pythonBinding.boundSnapshot = null;
  dialogsState.pythonBinding.parseError = '';
}

export function setPythonBindingPreview(parsedInterface) {
  dialogsState.pythonBinding.parsedInterface = parsedInterface;
  dialogsState.pythonBinding.parseError = '';
}

export function setPythonBindingError(message) {
  dialogsState.pythonBinding.parseError = message;
}

export function openComponentAuthoringDialog(payload = {}) {
  dialogsState.componentAuthoring.open = true;
  dialogsState.componentAuthoring.parsedInterface = payload.parsedInterface ?? null;
}

export function closeComponentAuthoringDialog() {
  dialogsState.componentAuthoring.open = false;
  dialogsState.componentAuthoring.parsedInterface = null;
}

export function openFaultAuthoringDialog(payload = {}) {
  dialogsState.faultAuthoring.open = true;
  dialogsState.faultAuthoring.target = payload.target ?? null;
}

export function closeFaultAuthoringDialog() {
  dialogsState.faultAuthoring.open = false;
  dialogsState.faultAuthoring.target = null;
}

export function useDialogsState() {
  return {
    dialogsState,
    openPythonBindingDialog,
    closePythonBindingDialog,
    setPythonBindingPreview,
    setPythonBindingError,
    openComponentAuthoringDialog,
    closeComponentAuthoringDialog,
    openFaultAuthoringDialog,
    closeFaultAuthoringDialog
  };
}
