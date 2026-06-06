export const UAV_FLIGHT_CONTROL_SYSTEM_FAMILY = 'uav-flight-control';
export const UAV_FLIGHT_CONTROL_FAULT_LIBRARY_ID = 'uav-flight-control-faults';

const UAV_FLIGHT_CONTROL_HINTS = [
  'uav',
  'evtol',
  'eVTOL_Small_nonandlin_algorithm_validation'
];

function hasUsableText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeText(value) {
  return hasUsableText(value) ? value.trim() : '';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map(normalizeText).filter(Boolean)));
}

function getPackageHintText(modelPackage = {}) {
  return [
    modelPackage.modelId,
    modelPackage.modelName,
    modelPackage.description,
    modelPackage.source?.slxFile,
    modelPackage.source?.origin,
    modelPackage.source?.notes
  ]
    .filter(hasUsableText)
    .join(' ')
    .toLowerCase();
}

function hasUavFlightControlHints(modelPackage = {}) {
  const hintText = getPackageHintText(modelPackage);
  return UAV_FLIGHT_CONTROL_HINTS.some((hint) => hintText.includes(hint.toLowerCase()));
}

function inferCatalogLibraryId(catalog = {}) {
  const explicit = normalizeText(catalog.libraryId);
  if (explicit) {
    return explicit;
  }

  const hintText = [
    catalog.modelFamily,
    catalog.source,
    catalog.description,
    catalog.name
  ]
    .filter(hasUsableText)
    .join(' ')
    .toLowerCase();

  if (hintText.includes('uav') || hintText.includes('flight-control') || hintText.includes('flight control')) {
    return UAV_FLIGHT_CONTROL_FAULT_LIBRARY_ID;
  }

  return '';
}

function inferCatalogSystemFamily(catalog = {}) {
  const explicit = normalizeText(catalog.systemFamily);
  if (explicit) {
    return explicit;
  }

  const hintText = [
    catalog.modelFamily,
    catalog.source,
    catalog.description,
    catalog.name
  ]
    .filter(hasUsableText)
    .join(' ')
    .toLowerCase();

  if (hintText.includes('uav') || hintText.includes('flight-control') || hintText.includes('flight control')) {
    return UAV_FLIGHT_CONTROL_SYSTEM_FAMILY;
  }

  return '';
}

export function getModelSystemFamily(modelPackage = {}) {
  const explicit = normalizeText(modelPackage.systemFamily ?? modelPackage.modelFamily);
  if (explicit) {
    return explicit;
  }

  return hasUavFlightControlHints(modelPackage) ? UAV_FLIGHT_CONTROL_SYSTEM_FAMILY : '';
}

export function getModelFaultLibraryIds(modelPackage = {}) {
  if (Array.isArray(modelPackage.supportedFaultLibraries)) {
    return normalizeStringArray(modelPackage.supportedFaultLibraries);
  }

  return getModelSystemFamily(modelPackage) === UAV_FLIGHT_CONTROL_SYSTEM_FAMILY
    ? [UAV_FLIGHT_CONTROL_FAULT_LIBRARY_ID]
    : [];
}

export function getFaultLibraryId(faultOrCatalog = {}, parentCatalog = null) {
  const explicit = normalizeText(faultOrCatalog.libraryId);
  if (explicit) {
    return explicit;
  }

  return inferCatalogLibraryId(parentCatalog ?? faultOrCatalog);
}

export function getFaultSystemFamily(faultOrCatalog = {}, parentCatalog = null) {
  const explicit = normalizeText(faultOrCatalog.systemFamily ?? faultOrCatalog.modelFamily);
  if (explicit) {
    return explicit;
  }

  return inferCatalogSystemFamily(parentCatalog ?? faultOrCatalog);
}

export function isFaultLibraryCompatibleWithModel(faultLibrary, modelPackage = {}) {
  const libraryId = typeof faultLibrary === 'string'
    ? normalizeText(faultLibrary)
    : getFaultLibraryId(faultLibrary);
  const librarySystemFamily = typeof faultLibrary === 'string'
    ? ''
    : getFaultSystemFamily(faultLibrary);
  const modelLibraryIds = getModelFaultLibraryIds(modelPackage);
  const modelSystemFamily = getModelSystemFamily(modelPackage);

  if (libraryId && modelLibraryIds.includes(libraryId)) {
    return true;
  }

  return Boolean(librarySystemFamily && modelSystemFamily && librarySystemFamily === modelSystemFamily);
}

export function isFaultCompatibleWithModel(faultModel, modelPackage = {}, parentCatalog = null) {
  const faultLibraryId = getFaultLibraryId(faultModel, parentCatalog);
  const faultSystemFamily = getFaultSystemFamily(faultModel, parentCatalog);
  const modelLibraryIds = getModelFaultLibraryIds(modelPackage);
  const modelSystemFamily = getModelSystemFamily(modelPackage);

  if (faultLibraryId && modelLibraryIds.includes(faultLibraryId)) {
    return true;
  }

  return Boolean(faultSystemFamily && modelSystemFamily && faultSystemFamily === modelSystemFamily);
}

export function filterCompatibleFaultTypes(faultCatalogOrTypes, modelPackage = {}) {
  const faultTypes = Array.isArray(faultCatalogOrTypes)
    ? faultCatalogOrTypes
    : faultCatalogOrTypes?.faultTypes;
  const parentCatalog = Array.isArray(faultCatalogOrTypes) ? null : faultCatalogOrTypes;

  if (!Array.isArray(faultTypes)) {
    return [];
  }

  return faultTypes.filter((faultModel) => isFaultCompatibleWithModel(faultModel, modelPackage, parentCatalog));
}

export function describeModelFaultCompatibility(modelPackage = {}, faultCatalog = null) {
  const faultLibraryIds = getModelFaultLibraryIds(modelPackage);
  const systemFamily = getModelSystemFamily(modelPackage);
  const compatibleFaultTypes = faultCatalog
    ? filterCompatibleFaultTypes(faultCatalog, modelPackage)
    : [];

  return {
    systemFamily,
    faultLibraryIds,
    compatible: faultCatalog ? compatibleFaultTypes.length > 0 : faultLibraryIds.length > 0,
    compatibleFaultTypes,
    reason: faultLibraryIds.length > 0
      ? 'model declares compatible fault libraries'
      : 'model has no compatible fault-library metadata'
  };
}
