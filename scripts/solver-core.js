// Minimal standalone solver with the common fertilizers used in default selections.
// Exports: { FERTILIZERS, OXIDE_CONVERSIONS, optimizeFormula }

const FERTILIZERS = [
  {
    id: "potassium_nitrate_typical",
    name: "Potassium Nitrate",
    pct: { N_total: 13.7, N_NO3: 13.7, K2O: 46.3 }
  },
  {
    id: "map_typical",
    name: "Mono Ammonium Phosphate (MAP)",
    pct: { N_total: 12.0, N_NH4: 12.0, P2O5: 61.0 }
  },
  {
    id: "mkp_typical",
    name: "Mono Potassium Phosphate (MKP)",
    pct: { P2O5: 52.0, K2O: 34.0 }
  },
  {
    id: "magnesium_sulfate_heptahydrate_common",
    name: "Magnesium Sulfate - Heptahydrate / Epsom Salt (9.86% Mg)",
    pct: { Mg: 9.86, S: 13.0 }
  },
  {
    id: "magnesium_nitrate_hexahydrate_typical",
    name: "Magnesium Nitrate - Hexahydrate (10.9% N, 9.5% Mg)",
    pct: { N_total: 10.9, N_NO3: 10.9, Mg: 9.5 }
  },
  {
    id: "sop_typical",
    name: "Potassium Sulfate (SOP)",
    pct: { K2O: 50.0, S: 17.0 }
  }
];

const OXIDE_CONVERSIONS = {
  P2O5_to_P: 0.436,
  K2O_to_K: 0.830,
  MgO_to_Mg: 0.603,
  CaO_to_Ca: 0.715,
  SO3_to_S: 0.400
};

function solveNonNegativeLeastSquares(matrix, target, iterations = 1500, weights = []) {
  const rows = matrix.length;
  const cols = target.length;
  if (rows === 0 || cols === 0) {
    return { x: [], error: 0 };
  }

  let x = new Array(rows).fill(0);
  let bestX = x.slice();
  let bestError = Number.POSITIVE_INFINITY;
  const w = weights.length === cols ? weights.slice() : new Array(cols).fill(1);
  const w2 = w.map(v => v * v);

  for (let iter = 0; iter < iterations; iter++) {
    const Ax = new Array(cols).fill(0);
    for (let i = 0; i < rows; i++) {
      const xi = x[i];
      if (xi === 0) continue;
      const row = matrix[i];
      for (let j = 0; j < cols; j++) {
        Ax[j] += row[j] * xi;
      }
    }

    const residual = new Array(cols);
    let error = 0;
    for (let j = 0; j < cols; j++) {
      residual[j] = Ax[j] - target[j];
      const scaled = residual[j] * w[j];
      error += scaled * scaled;
    }

    if (error < bestError) {
      bestError = error;
      bestX = x.slice();
    }

    const lr = iter < iterations * 0.5 ? 0.0006 : iter < iterations * 0.8 ? 0.0003 : 0.00015;
    const reg = 1e-4;

    const grad = new Array(rows).fill(0);
    for (let i = 0; i < rows; i++) {
      const row = matrix[i];
      let g = 0;
      for (let j = 0; j < cols; j++) {
        g += row[j] * residual[j] * w2[j];
      }
      grad[i] = g + reg * x[i];
    }

    for (let i = 0; i < rows; i++) {
      x[i] = Math.max(0, x[i] - lr * grad[i]);
    }
  }

  return { x: bestX, error: bestError };
}

function pruneSolution(matrix, targetVector, weights, baseSolution, tolerance = 0.01, iterations = 800) {
  let activeIndices = baseSolution.x
    .map((grams, idx) => ({ idx, grams }))
    .filter(item => item.grams > 1e-4)
    .map(item => item.idx);

  let best = { x: baseSolution.x.slice(), error: baseSolution.error, active: activeIndices.slice() };

  function computeAchieved(solX) {
    const cols = targetVector.length;
    const achieved = new Array(cols).fill(0);
    for (let i = 0; i < solX.length; i++) {
      const xi = solX[i];
      if (xi === 0) continue;
      const row = matrix[i];
      for (let j = 0; j < cols; j++) {
        achieved[j] += row[j] * xi;
      }
    }
    return achieved;
  }

  function withinTolerance(achieved) {
    for (let j = 0; j < targetVector.length; j++) {
      const target = targetVector[j];
      if (target > 0) {
        const diff = Math.abs(achieved[j] - target) / target;
        if (diff > tolerance) return false;
      }
    }
    return true;
  }

  let improved = true;
  while (improved && activeIndices.length > 1) {
    improved = false;
    let bestCandidate = null;

    activeIndices.forEach(removeIdx => {
      const remaining = activeIndices.filter(idx => idx !== removeIdx);
      if (remaining.length === 0) return;

      const reducedMatrix = remaining.map(idx => matrix[idx]);
      const reducedSolution = solveNonNegativeLeastSquares(reducedMatrix, targetVector, iterations, weights);

      const fullX = new Array(matrix.length).fill(0);
      remaining.forEach((idx, pos) => {
        fullX[idx] = reducedSolution.x[pos];
      });

      const achieved = computeAchieved(fullX);

      if (withinTolerance(achieved)) {
        const candidate = {
          x: fullX,
          error: reducedSolution.error,
          active: remaining.slice()
        };

        if (
          !bestCandidate ||
          candidate.active.length < bestCandidate.active.length ||
          (candidate.active.length === bestCandidate.active.length && candidate.error < bestCandidate.error)
        ) {
          bestCandidate = candidate;
        }
      }
    });

    if (bestCandidate) {
      best = bestCandidate;
      activeIndices = bestCandidate.active;
      improved = true;
    }
  }

  return best;
}

function optimizeFormula(targetRatios, volume, availableFertilizers, concentration = 75, mode = 'oxide', options = {}) {
  const useAbsoluteTargets = options.useAbsoluteTargets === true;

  const P_to_P2O5 = 1 / OXIDE_CONVERSIONS.P2O5_to_P;
  const K_to_K2O = 1 / OXIDE_CONVERSIONS.K2O_to_K;

  let targetPPM_Commercial;

  if (useAbsoluteTargets) {
    targetPPM_Commercial = {
      N: targetRatios.N || 0,
      P2O5: mode === 'elemental'
        ? (targetRatios.P || 0) * P_to_P2O5
        : (targetRatios.P || 0),
      K2O: mode === 'elemental'
        ? (targetRatios.K || 0) * K_to_K2O
        : (targetRatios.K || 0),
      Ca: targetRatios.Ca || 0,
      Mg: targetRatios.Mg || 0,
      S: targetRatios.S || 0
    };
  } else {
    const ratioValues = Object.values(targetRatios).filter(v => v > 0);
    const minRatio = ratioValues.length > 0 ? Math.min(...ratioValues) : 1;

    const normalizedRatios = {
      N: targetRatios.N / minRatio,
      P: targetRatios.P / minRatio,
      K: targetRatios.K / minRatio,
      Ca: targetRatios.Ca / minRatio,
      Mg: targetRatios.Mg / minRatio,
      S: targetRatios.S / minRatio
    };

    const basePPMForMinRatio = concentration;

    targetPPM_Commercial = {
      N: normalizedRatios.N * basePPMForMinRatio,
      P2O5: mode === 'elemental'
        ? normalizedRatios.P * basePPMForMinRatio * P_to_P2O5
        : normalizedRatios.P * basePPMForMinRatio,
      K2O: mode === 'elemental'
        ? normalizedRatios.K * basePPMForMinRatio * K_to_K2O
        : normalizedRatios.K * basePPMForMinRatio,
      Ca: normalizedRatios.Ca * basePPMForMinRatio,
      Mg: normalizedRatios.Mg * basePPMForMinRatio,
      S: normalizedRatios.S * basePPMForMinRatio
    };
  }

  const achieved = { N_total: 0, N_NO3: 0, N_NH4: 0, P2O5: 0, K2O: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 };
  const formula = {};

  function calculatePPM(fert, grams) {
    const contribution = { N_total: 0, N_NO3: 0, N_NH4: 0, P2O5: 0, K2O: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 };
    Object.entries(fert.pct).forEach(([nutrient, percentage]) => {
      const ppm = (grams * 1000 * (percentage / 100)) / volume;

      if (nutrient === 'P2O5') {
        contribution.P2O5 += ppm;
        contribution.P += ppm * OXIDE_CONVERSIONS.P2O5_to_P;
      } else if (nutrient === 'K2O') {
        contribution.K2O += ppm;
        contribution.K += ppm * OXIDE_CONVERSIONS.K2O_to_K;
      } else if (nutrient === 'N_NO3') {
        contribution.N_NO3 += ppm;
        contribution.N_total += ppm;
      } else if (nutrient === 'N_NH4') {
        contribution.N_NH4 += ppm;
        contribution.N_total += ppm;
      } else if (nutrient === 'N_total') {
        if (!fert.pct.N_NO3 && !fert.pct.N_NH4) {
          contribution.N_total += ppm;
        }
      } else if (nutrient === 'CaO' && OXIDE_CONVERSIONS.CaO_to_Ca) {
        contribution.Ca += ppm * OXIDE_CONVERSIONS.CaO_to_Ca;
      } else if (nutrient === 'MgO' && OXIDE_CONVERSIONS.MgO_to_Mg) {
        contribution.Mg += ppm * OXIDE_CONVERSIONS.MgO_to_Mg;
      } else if (nutrient === 'SO3' && OXIDE_CONVERSIONS.SO3_to_S) {
        contribution.S += ppm * OXIDE_CONVERSIONS.SO3_to_S;
      } else {
        contribution[nutrient] = (contribution[nutrient] || 0) + ppm;
      }
    });
    return contribution;
  }

  function addFertilizer(fert, grams) {
    if (!formula[fert.id]) formula[fert.id] = 0;
    formula[fert.id] += grams;
    const contribution = calculatePPM(fert, grams);
    Object.keys(contribution).forEach(nutrient => {
      achieved[nutrient] += contribution[nutrient];
    });
  }

  const allNutrients = ['N_total', 'P2O5', 'K2O', 'Ca', 'Mg', 'S'];
  const targetedKeys = allNutrients.filter(key => (targetPPM_Commercial[key] || 0) > 0);
  const extraKeys = allNutrients.filter(key => (targetPPM_Commercial[key] || 0) === 0);
  const nutrientKeys = targetedKeys.concat(extraKeys);

  const weights = [];
  const targetVector = [];
  const softWeight = 0.1;

  nutrientKeys.forEach(key => {
    const isTargeted = (targetPPM_Commercial[key] || 0) > 0;
    weights.push(isTargeted ? 1 : softWeight);
    targetVector.push(targetPPM_Commercial[key] || 0);
  });

  if (targetedKeys.length === 0) {
    weights.fill(1);
  }

  const matrix = availableFertilizers.map(fert => {
    const contrib = calculatePPM(fert, 1);
    return nutrientKeys.map(key => contrib[key] || 0);
  });

  const pruneTolerance = typeof options.pruneTolerance === 'number' ? options.pruneTolerance : 0.01;

  // Solve for a chosen subset of fertilizers
  function solveForSubset(indices) {
    const subsetMatrix = indices.map(idx => matrix[idx]);
    const baseSolution = solveNonNegativeLeastSquares(subsetMatrix, targetVector, 2000, weights);
    // Skip pruning for small subsets to avoid dropping needed items
    return { solution: baseSolution, indices };
  }

  function evaluateSolution(solObj) {
    const achievedVec = new Array(targetVector.length).fill(0);
    solObj.solution.x.forEach((xi, pos) => {
      if (xi === 0) return;
      const row = solObj.indices.map(idx => matrix[idx])[pos];
      row.forEach((val, j) => {
        achievedVec[j] += val * xi;
      });
    });
    let err = 0;
    targetVector.forEach((t, j) => {
      if (t > 0) {
        const diff = Math.abs(achievedVec[j] - t) / t;
        err += diff * diff;
      } else {
        err += achievedVec[j] * achievedVec[j] * 1e-6;
      }
    });
    return { err, achievedVec };
  }

  let best = null;
  let bestWithin = null;
  const maxCombo = Math.min(4, availableFertilizers.length);

  if (availableFertilizers.length <= 8) {
    function choose(start, depth, combo) {
      if (depth === 0) {
        const sol = solveForSubset(combo);
        const { err } = evaluateSolution(sol);
        const usedCount = sol.solution.x.filter(v => v > 1e-4).length;
        const achievedVec = new Array(targetVector.length).fill(0);
        sol.solution.x.forEach((xi, pos) => {
          if (xi === 0) return;
          const row = sol.indices.map(idx => matrix[idx])[pos];
          row.forEach((val, j) => {
            achievedVec[j] += val * xi;
          });
        });
        const withinTol = targetVector.every((t, j) => t <= 0 || Math.abs(achievedVec[j] - t) / t <= pruneTolerance);

        if (withinTol) {
          if (!bestWithin || usedCount < bestWithin.usedCount || (usedCount === bestWithin.usedCount && err < bestWithin.err)) {
            bestWithin = { sol, err, usedCount };
          }
        }
        if (!best || usedCount < best.usedCount || (usedCount === best.usedCount && err < best.err)) {
          best = { sol, err, usedCount };
        }
        return;
      }
      for (let i = start; i <= availableFertilizers.length - depth; i++) {
        combo.push(i);
        choose(i + 1, depth - 1, combo);
        combo.pop();
      }
    }

    for (let size = 1; size <= maxCombo; size++) {
      choose(0, size, []);
      if (best && best.usedCount === size) break;
    }
  }

  let chosen = bestWithin;

  if (!chosen) {
    const baseSolution = solveNonNegativeLeastSquares(matrix, targetVector, 1500, weights);
    const pruned = pruneSolution(matrix, targetVector, weights, baseSolution, availableFertilizers, pruneTolerance, 800);
    chosen = { sol: pruned && pruned.x ? pruned : baseSolution, err: 0, usedCount: availableFertilizers.length };
  }

  const finalSol = chosen.sol.solution || chosen.sol;
  const finalIndices = chosen.sol.active || chosen.sol.indices || availableFertilizers.map((_, i) => i);
  finalSol.x.forEach((grams, pos) => {
    if (grams > 0.0001) {
      const fertIdx = finalIndices[pos] !== undefined ? finalIndices[pos] : pos;
      addFertilizer(availableFertilizers[fertIdx], grams);
    }
  });

  // Safety fallback: if nothing was added, use the full set without pruning
  if (Object.keys(formula).length === 0) {
    const baseSolution = solveNonNegativeLeastSquares(matrix, targetVector, 1500, weights);
    baseSolution.x.forEach((grams, index) => {
      if (grams > 0.0001) {
        addFertilizer(availableFertilizers[index], grams);
      }
    });
  }

  return { formula, achieved, targetRatios, targetPPM: targetPPM_Commercial, nutrientKeys };
}

module.exports = {
  FERTILIZERS,
  OXIDE_CONVERSIONS,
  optimizeFormula
};
