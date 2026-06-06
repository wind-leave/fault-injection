import { normalizeAuthoringPackage } from './authoringModelService.js';

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDetectabilityRow(row = {}) {
  return {
    faultTypeId: row.faultTypeId,
    targetId: row.targetId || '',
    slotId: row.slotId || '',
    testPointId: row.testPointId,
    detectable: Boolean(row.detectable),
    signature: row.signature || '',
    confidence: Number.isFinite(row.confidence) ? row.confidence : 0
  };
}

function detectabilityKey(row) {
  return [
    row?.faultTypeId || '',
    row?.targetId || '',
    row?.slotId || '',
    row?.testPointId || ''
  ].join('\u0000');
}

function faultGroupKey(row) {
  return [row?.faultTypeId || '', row?.targetId || '', row?.slotId || ''].join('\u0000');
}

function faultNameById(pkg) {
  return new Map(
    arrayOrEmpty(pkg.faultTypeCatalog).map((faultType) => [
      faultType?.id,
      faultType?.displayName || faultType?.name || faultType?.id
    ])
  );
}

function createDMatrixRow(row, testPointIds, faultNames) {
  return {
    faultTypeId: row.faultTypeId,
    faultName: faultNames.get(row.faultTypeId) || row.faultTypeId,
    targetId: row.targetId || '',
    slotId: row.slotId || '',
    ...Object.fromEntries(testPointIds.map((testPointId) => [testPointId, 0]))
  };
}

export function upsertDetectability(modelPackage, row) {
  const pkg = normalizeAuthoringPackage(modelPackage);
  const nextRow = normalizeDetectabilityRow(row);
  const rowKey = detectabilityKey(nextRow);
  const detectabilityMatrix = arrayOrEmpty(pkg.diagnosticModel?.detectabilityMatrix);
  const index = detectabilityMatrix.findIndex((item) => detectabilityKey(item) === rowKey);
  const nextMatrix = index === -1
    ? [...detectabilityMatrix, nextRow]
    : detectabilityMatrix.map((item, itemIndex) => (itemIndex === index ? nextRow : item));

  return {
    ...pkg,
    diagnosticModel: {
      ...pkg.diagnosticModel,
      detectabilityMatrix: nextMatrix
    }
  };
}

export function buildDMatrixRows(modelPackage) {
  const pkg = normalizeAuthoringPackage(modelPackage);
  const testPointIds = arrayOrEmpty(pkg.diagnosticModel?.testPoints)
    .map((testPoint) => testPoint?.testPointId)
    .filter(Boolean);
  const faultNames = faultNameById(pkg);
  const rows = [];
  const rowIndexByKey = new Map();

  arrayOrEmpty(pkg.diagnosticModel?.detectabilityMatrix).forEach((detectabilityRow) => {
    const key = faultGroupKey(detectabilityRow);
    if (!rowIndexByKey.has(key)) {
      rowIndexByKey.set(key, rows.length);
      rows.push(createDMatrixRow(detectabilityRow, testPointIds, faultNames));
    }

    const row = rows[rowIndexByKey.get(key)];
    if (testPointIds.includes(detectabilityRow?.testPointId)) {
      row[detectabilityRow.testPointId] = detectabilityRow.detectable ? 1 : 0;
    }
  });

  return rows;
}
