function pointId(point) {
  return String(point?.pointId || point?.id || '');
}

function cellDetectable(row, point, index) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  const id = pointId(point);
  const code = String(point?.shortName || point?.pointCode || '');
  const cell = cells.find((item) =>
    (id && String(item?.pointId || '') === id)
    || (code && String(item?.pointCode || '') === code)
  ) || cells[index];
  return Boolean(cell?.detectable);
}

function candidateFromRows(rows) {
  if (rows.length === 1) {
    const row = rows[0];
    return { ...row, faultIds: [row.faultId], faultCount: 1, mode: 'single' };
  }
  const faultIds = rows.map((row) => row.faultId);
  const names = rows.map((row) => row.faultDisplayName || row.faultName || row.faultId);
  return {
    faultId: faultIds.join('||'),
    faultIds,
    faultCount: rows.length,
    mode: 'multiple',
    faultDisplayName: names.join(' + '),
    faultDisplayDetail: rows.map((row) => row.faultDisplayDetail || row.faultName || row.faultId).join(' + '),
    targetLabel: [...new Set(rows.map((row) => row.targetLabel).filter(Boolean))].join('、'),
    layer: [...new Set(rows.map((row) => row.layer).filter(Boolean))].join(' + ')
  };
}

export function diagnoseDMatrixFaultCombinations(model, pointStates) {
  const points = Array.isArray(model?.points) ? model.points : [];
  // Enabled rows identify the injected target; every matrix row remains a
  // possible diagnosis, just as it does when generating combination paths.
  const rows = Array.isArray(model?.rows) ? model.rows : [];
  const incompletePointIds = points.map(pointId).filter((id) => pointStates?.[id] !== 'normal' && pointStates?.[id] !== 'abnormal');
  if (incompletePointIds.length) {
    return { complete: false, incompletePointIds, candidates: [], allNormal: false };
  }

  const abnormalIndices = points.flatMap((point, index) => pointStates[pointId(point)] === 'abnormal' ? [index] : []);
  const allNormal = abnormalIndices.length === 0;
  // With OR detectability, a fault affecting a normal point cannot belong to
  // any matching combination.
  const viableRows = rows.map((row) => ({
    row,
    signature: points.map((point, index) => cellDetectable(row, point, index))
  })).filter(({ signature }) => signature.every((detectable, index) => !detectable || pointStates[pointId(points[index])] === 'abnormal'));

  const candidates = [];
  const chosen = [];
  const coverage = Array(points.length).fill(false);

  function visit(start, remaining) {
    const uncovered = abnormalIndices.filter((index) => !coverage[index]);
    if (uncovered.length) {
      const available = viableRows.slice(start);
      const maxNewCoverage = Math.max(0, ...available.map(({ signature }) => uncovered.filter((index) => signature[index]).length));
      if (uncovered.length > remaining * maxNewCoverage
        || uncovered.some((index) => !available.some(({ signature }) => signature[index]))) return;
    }
    if (remaining === 0) {
      if (uncovered.length === 0) {
        candidates.push(candidateFromRows(chosen.map((item) => item.row)));
      }
      return;
    }
    for (let index = start; index <= viableRows.length - remaining; index += 1) {
      const item = viableRows[index];
      const previous = coverage.slice();
      chosen.push(item);
      item.signature.forEach((detectable, pointIndex) => { coverage[pointIndex] ||= detectable; });
      visit(index + 1, remaining - 1);
      chosen.pop();
      previous.forEach((value, pointIndex) => { coverage[pointIndex] = value; });
    }
  }

  // Show simpler explanations first, including exact single-fault matches.
  for (let size = 1; size <= viableRows.length; size += 1) visit(0, size);
  return { complete: true, incompletePointIds: [], candidates, allNormal };
}
