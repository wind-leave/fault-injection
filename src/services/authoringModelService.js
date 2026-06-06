export const AUTHORING_SCHEMA_VERSION = '3.0';

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? clone(value) : [];
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function createEmptyAuthoringPackage({ modelId = 'untitled-model', modelName = '未命名模型' } = {}) {
  return {
    schemaVersion: AUTHORING_SCHEMA_VERSION,
    packageType: 'flight-control-model',
    modelInfo: {
      modelId: text(modelId, 'untitled-model'),
      modelName: text(modelName, '未命名模型')
    },
    componentTemplates: [],
    systemModel: {
      nodes: [],
      edges: []
    },
    faultTypeCatalog: [],
    faultCapabilityMap: [],
    faultInstances: [],
    diagnosticModel: {
      testPoints: [],
      detectabilityMatrix: []
    },
    pythonModules: []
  };
}

export function normalizeAuthoringPackage(pkg = {}) {
  const source = objectOrEmpty(pkg);
  const base = createEmptyAuthoringPackage({
    modelId: source.modelInfo?.modelId ?? source.modelId,
    modelName: source.modelInfo?.modelName ?? source.modelName
  });
  const modelInfo = objectOrEmpty(source.modelInfo);
  const systemModel = objectOrEmpty(source.systemModel);
  const diagnosticModel = objectOrEmpty(source.diagnosticModel);

  return {
    ...base,
    ...source,
    schemaVersion: AUTHORING_SCHEMA_VERSION,
    packageType: text(source.packageType, base.packageType),
    modelInfo: {
      ...base.modelInfo,
      ...modelInfo,
      modelId: text(modelInfo.modelId ?? source.modelId, base.modelInfo.modelId),
      modelName: text(modelInfo.modelName ?? source.modelName, base.modelInfo.modelName)
    },
    componentTemplates: arrayOrEmpty(source.componentTemplates),
    systemModel: {
      ...systemModel,
      nodes: arrayOrEmpty(systemModel.nodes ?? source.nodes ?? source.workbenchSnapshot?.modelNodes),
      edges: arrayOrEmpty(systemModel.edges ?? source.edges ?? source.workbenchSnapshot?.modelEdges)
    },
    faultTypeCatalog: arrayOrEmpty(source.faultTypeCatalog ?? source.faultLibrary ?? source.faultTypes),
    faultCapabilityMap: arrayOrEmpty(source.faultCapabilityMap),
    faultInstances: arrayOrEmpty(source.faultInstances),
    diagnosticModel: {
      ...diagnosticModel,
      testPoints: arrayOrEmpty(diagnosticModel.testPoints ?? source.testPoints),
      detectabilityMatrix: arrayOrEmpty(diagnosticModel.detectabilityMatrix ?? source.detectabilityMatrix)
    },
    pythonModules: arrayOrEmpty(source.pythonModules)
};
}

export function upsertById(list, record, idKey = 'id') {
  const items = arrayOrEmpty(list);
  const nextRecord = clone(record);
  const recordId = nextRecord?.[idKey];
  if (!recordId) {
    throw new Error(`Missing ${idKey}`);
  }
  const index = items.findIndex((item) => item?.[idKey] === recordId);

  if (index === -1) {
    return [...items, nextRecord];
  }

  return items.map((item, itemIndex) => (itemIndex === index ? nextRecord : item));
}
