/**
 * Fertilizer Calculator Core - Data and Calculations
 * Pure logic with no DOM or i18n dependencies
 *
 * This module contains:
 * - Fertilizer database and chemical constants
 * - EC estimation algorithms
 * - Ion balance calculations
 * - Formula optimization (MILP and gradient descent)
 * - Nutrient ratio calculations
 */

window.FertilizerCore = window.FertilizerCore || {};

// =============================================================================
// DATA (loaded from fertilizer-data.js)
// =============================================================================
// The following data structures are defined in fertilizer-data.js:
// - FERTILIZERS: Array of fertilizer objects with id, name, aliases, pct
// - OXIDE_CONVERSIONS: Conversion factors for oxides to elements
// - MOLAR_MASSES: Molar masses for nutrients (g/mol)
// - IONIC_CHARGES: Ionic charges (legacy)
// - EC_CONTRIBUTIONS: EC contribution factors (legacy)
// - IONIC_MOLAR_CONDUCTIVITY: Ionic molar conductivity at 25°C
// - ION_CHARGES: Ionic charges for EC calculation
// - ION_DATA: Ion balance data for each fertilizer
// - COMMON_FERTILIZERS: Array of commonly used fertilizer IDs
// - FERTILIZER_COMPATIBILITY: Compatibility groups for two-tank system

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Check if a fertilizer contains calcium
window.FertilizerCore.hasCaContent = function(fertId) {
  const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === fertId);
  return fert && fert.pct && fert.pct.Ca > 0;
};

// Check if a fertilizer contains sulfate
window.FertilizerCore.hasSulfateContent = function(fertId) {
  const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === fertId);
  return fert && fert.pct && fert.pct.S > 0;
};

// Check if a fertilizer contains phosphate
window.FertilizerCore.hasPhosphateContent = function(fertId) {
  const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === fertId);
  return fert && fert.pct && (fert.pct.P2O5 > 0 || fert.pct.P > 0);
};

// Check if a fertilizer contains silicate
window.FertilizerCore.hasSilicateContent = function(fertId) {
  const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === fertId);
  return fert && fert.pct && (fert.pct.SiO2 > 0 || fert.pct.SiOH4 > 0 || fert.pct.Si > 0);
};

// Check if a formula contains incompatible fertilizers
window.FertilizerCore.hasIncompatibleFertilizers = function(formula) {
  const activeFertIds = Object.entries(formula)
    .filter(([id, grams]) => grams > 0)
    .map(([id]) => id);

  if (activeFertIds.length < 2) return false;

  let hasCalcium = false;
  let hasSulfate = false;
  let hasPhosphate = false;
  let hasSilicate = false;

  activeFertIds.forEach(fertId => {
    if (window.FertilizerCore.hasCaContent(fertId)) hasCalcium = true;
    if (window.FertilizerCore.hasSulfateContent(fertId)) hasSulfate = true;
    if (window.FertilizerCore.hasPhosphateContent(fertId)) hasPhosphate = true;
    if (window.FertilizerCore.hasSilicateContent(fertId)) hasSilicate = true;
  });

  return hasCalcium && (hasSulfate || hasPhosphate || hasSilicate);
};

// =============================================================================
// EC ESTIMATION
// =============================================================================

/**
 * Estimate EC from ion concentrations using the sum of ionic molar conductivities model.
 * @param {Object} ions_mmolL - Ion concentrations in mmol/L
 * @param {Object} options - Optional settings
 * @returns {Object} EC estimation results
 */
window.FertilizerCore.estimateEC = function(ions_mmolL, options = {}) {
  const {
    temperatureC = 25,
    applyIonicStrengthCorrection = true,
    ionicStrengthK = 0.5
  } = options;

  const IONIC_MOLAR_CONDUCTIVITY = window.FertilizerCore.IONIC_MOLAR_CONDUCTIVITY;
  const ION_CHARGES = window.FertilizerCore.ION_CHARGES;

  let ec_raw = 0;
  const contributions = {};

  for (const [ion, c_mmolL] of Object.entries(ions_mmolL)) {
    if (IONIC_MOLAR_CONDUCTIVITY[ion] && c_mmolL > 0) {
      const contrib = 0.001 * IONIC_MOLAR_CONDUCTIVITY[ion] * c_mmolL;
      contributions[ion] = {
        concentration_mmolL: c_mmolL,
        lambda: IONIC_MOLAR_CONDUCTIVITY[ion],
        contribution_mS_cm: contrib
      };
      ec_raw += contrib;
    }
  }

  let ionicStrength = 0;
  for (const [ion, c_mmolL] of Object.entries(ions_mmolL)) {
    if (ION_CHARGES[ion] && c_mmolL > 0) {
      const c_molL = c_mmolL / 1000;
      const z = ION_CHARGES[ion];
      ionicStrength += c_molL * z * z;
    }
  }
  ionicStrength = ionicStrength / 2;

  let ec_25 = ec_raw;
  if (applyIonicStrengthCorrection && ionicStrength > 0) {
    ec_25 = ec_raw / (1 + ionicStrengthK * Math.sqrt(ionicStrength));
  }

  const tempCorrectionFactor = 1 + 0.02 * (temperatureC - 25);
  const ec_at_temp = ec_25 * tempCorrectionFactor;

  return {
    ec_mS_cm: ec_25,
    ec_at_temp: ec_at_temp,
    ionicStrength: ionicStrength,
    contributions: contributions,
    temperatureC: temperatureC,
    rawEC: ec_raw,
    correctionApplied: applyIonicStrengthCorrection
  };
};

/**
 * Atomic/molar masses for EC ion conversion
 */
window.FertilizerCore.EC_ION_MOLAR_MASSES = {
  'NO3-': 14.007,   // Based on N atomic mass
  'NH4+': 14.007,   // Based on N atomic mass
  'H2PO4-': 30.974, // Based on P atomic mass
  'K+': 39.098,
  'Ca2+': 40.078,
  'Mg2+': 24.305,
  'SO4^2-': 32.065, // Based on S atomic mass
  'Na+': 22.99,
  'Cl-': 35.453,
  'Fe2+': 55.845,
  'Mn2+': 54.938,
  'Zn2+': 65.38,
  'Cu2+': 63.546
};

/**
 * Mapping from PPM keys to ion symbols for EC calculations
 */
window.FertilizerCore.PPM_TO_ION_MAPPINGS = [
  { ppmKey: 'N_NO3', ion: 'NO3-' },
  { ppmKey: 'N_NH4', ion: 'NH4+' },
  { ppmKey: 'P', ion: 'H2PO4-' },
  { ppmKey: 'K', ion: 'K+' },
  { ppmKey: 'Ca', ion: 'Ca2+' },
  { ppmKey: 'Mg', ion: 'Mg2+' },
  { ppmKey: 'S', ion: 'SO4^2-' },
  { ppmKey: 'Na', ion: 'Na+' },
  { ppmKey: 'Cl', ion: 'Cl-' },
  { ppmKey: 'Fe', ion: 'Fe2+' },
  { ppmKey: 'Mn', ion: 'Mn2+' },
  { ppmKey: 'Zn', ion: 'Zn2+' },
  { ppmKey: 'Cu', ion: 'Cu2+' }
];

/**
 * Convert PPM results to ion concentrations in mmol/L for EC estimation.
 * Uses centralized molar mass lookup.
 * @param {Object} ppmResults - PPM values from the calculator
 * @returns {Object} Ion concentrations in mmol/L
 */
window.FertilizerCore.ppmToIonsForEC = function(ppmResults) {
  const ions_mmolL = {};
  const MOLAR_MASSES = window.FertilizerCore.EC_ION_MOLAR_MASSES;
  const mappings = window.FertilizerCore.PPM_TO_ION_MAPPINGS;

  for (const { ppmKey, ion } of mappings) {
    const ppm = ppmResults[ppmKey] || 0;
    if (ppm > 0 && MOLAR_MASSES[ion]) {
      ions_mmolL[ion] = ppm / MOLAR_MASSES[ion];
    }
  }

  return ions_mmolL;
};

/**
 * Convert PPM results to ion data with full details for EC display
 * Uses centralized molar mass lookup.
 * @param {Object} ppmResults - PPM values from the calculator
 * @returns {Object} Ion data with ppm, molarMass, and mmolL for each ion
 */
window.FertilizerCore.ppmToIonsWithDetails = function(ppmResults) {
  const ionsData = {};
  const MOLAR_MASSES = window.FertilizerCore.EC_ION_MOLAR_MASSES;
  const mappings = window.FertilizerCore.PPM_TO_ION_MAPPINGS;

  for (const { ppmKey, ion } of mappings) {
    const ppm = ppmResults[ppmKey] || 0;
    if (ppm > 0 && MOLAR_MASSES[ion]) {
      const molarMass = MOLAR_MASSES[ion];
      ionsData[ion] = {
        ppm: ppm,
        molarMass: molarMass,
        mmolL: ppm / molarMass
      };
    }
  }

  return ionsData;
};

/**
 * Estimate EC from PPM results (convenience wrapper)
 * @param {Object} ppmResults - PPM values from the calculator
 * @param {Object} options - Options passed to estimateEC
 * @returns {Object} EC estimation results with detailed ion data
 */
window.FertilizerCore.estimateECFromPPM = function(ppmResults, options = {}) {
  const ions_mmolL = window.FertilizerCore.ppmToIonsForEC(ppmResults);
  const ionsDetails = window.FertilizerCore.ppmToIonsWithDetails(ppmResults);
  const result = window.FertilizerCore.estimateEC(ions_mmolL, options);

  // Add ppm and molarMass to each contribution
  for (const ion in result.contributions) {
    if (ionsDetails[ion]) {
      result.contributions[ion].ppm = ionsDetails[ion].ppm;
      result.contributions[ion].molarMass = ionsDetails[ion].molarMass;
    }
  }

  return result;
};

// =============================================================================
// ION BALANCE
// =============================================================================

/**
 * Determines ion balance status based on imbalance percentage
 * Returns status level and color (no i18n - UI layer handles translation)
 * @param {number} imbalance - Imbalance percentage
 * @returns {Object} {statusColor, statusLevel} - Status color and level key
 */
window.FertilizerCore.getIonBalanceStatus = function(imbalance) {
  if (imbalance <= 10) {
    return { statusColor: '#28a745', statusLevel: 'balanced' };
  } else if (imbalance <= 20) {
    return { statusColor: '#ffc107', statusLevel: 'caution' };
  } else {
    return { statusColor: '#dc3545', statusLevel: 'imbalanced' };
  }
};

/**
 * Core ion balance calculation
 * @param {Object|Array} fertilizers - Either array of {id, grams} or object {fertId: grams}
 * @param {number} volume - Solution volume in liters
 * @param {Object} options - Optional settings
 * @returns {Object} Complete ion balance data
 */
window.FertilizerCore.calculateIonBalanceCore = function(fertilizers, volume, options = {}) {
  const { includeBreakdown = false } = options;
  const FERTILIZERS = window.FertilizerCore.FERTILIZERS;
  const ION_DATA = window.FertilizerCore.ION_DATA;

  let totalCations = 0;
  let totalAnions = 0;
  const ionDetails = {};
  const fertilizerBreakdown = [];

  const fertArray = Array.isArray(fertilizers)
    ? fertilizers
    : Object.entries(fertilizers).map(([fertId, grams]) => {
        const fert = FERTILIZERS.find(f => f.id === fertId);
        return fert ? { ...fert, grams } : { id: fertId, grams };
      });

  fertArray.forEach(fert => {
    const ionData = ION_DATA[fert.id];
    if (!ionData || !fert.grams || fert.grams <= 0) return;

    const moles = fert.grams / ionData.molarMass;
    const fertIons = [];

    ionData.ions.forEach(ionInfo => {
      const meq = moles * ionInfo.count * ionInfo.charge * 1000;
      const meqPerLiter = meq / volume;

      if (includeBreakdown) {
        fertIons.push({
          ...ionInfo,
          meq: meqPerLiter,
          calculation: { moles, meq, meqPerLiter }
        });
      }

      if (!ionDetails[ionInfo.ion]) {
        ionDetails[ionInfo.ion] = { meq: 0, type: ionInfo.type };
      }
      ionDetails[ionInfo.ion].meq += meqPerLiter;

      if (ionInfo.type === 'cation') {
        totalCations += meqPerLiter;
      } else {
        totalAnions += meqPerLiter;
      }
    });

    if (includeBreakdown) {
      fertilizerBreakdown.push({
        fert,
        ionData,
        moles,
        ions: fertIons
      });
    }
  });

  const average = (totalCations + totalAnions) / 2;
  const imbalance = average > 0 ? Math.abs(totalCations - totalAnions) / average * 100 : 0;
  const { statusColor, statusLevel } = window.FertilizerCore.getIonBalanceStatus(imbalance);

  const result = {
    totalCations,
    totalAnions,
    imbalance,
    statusColor,
    statusLevel,
    ionDetails
  };

  if (includeBreakdown) {
    result.fertilizerBreakdown = fertilizerBreakdown;
  }

  return result;
};

// =============================================================================
// NUTRIENT RATIOS
// =============================================================================

/**
 * Calculate nutrient ratios from results
 * @param {Object} results - Nutrient concentration results
 * @returns {Array} Array of ratio objects
 */
window.FertilizerCore.calculateNutrientRatios = function(results) {
  const ratios = [];

  function getRatio(values, names, decimals = 2) {
    const nonZeroValues = values.filter(v => v > 0);
    if (nonZeroValues.length === 0) return null;

    const minValue = Math.min(...nonZeroValues);
    const ratioValues = values.map(v => v > 0 ? parseFloat((v / minValue).toFixed(decimals)) : 0);

    return {
      name: names.join(' : '),
      ratio: ratioValues.join(' : '),
      values: values,
      labels: names
    };
  }

  // N:P:K (elemental)
  const npk = getRatio([results.N_total || 0, results.P || 0, results.K || 0], ['N', 'P', 'K']);
  if (npk) ratios.push(npk);

  // N:P2O5:K2O (oxide form)
  const npkOxide = getRatio([results.N_total || 0, results.P2O5 || 0, results.K2O || 0], ['N', 'P₂O₅', 'K₂O']);
  if (npkOxide) ratios.push(npkOxide);

  // N:K ratio
  if ((results.N_total || 0) > 0 && (results.K || 0) > 0) {
    const nk = getRatio([results.N_total || 0, results.K || 0], ['N', 'K']);
    if (nk) ratios.push(nk);
  }

  // NO3:NH4 ratio
  if ((results.N_NO3 || 0) > 0 || (results.N_NH4 || 0) > 0) {
    const no3nh4 = getRatio([results.N_NO3 || 0, results.N_NH4 || 0], ['NO₃', 'NH₄']);
    if (no3nh4) ratios.push(no3nh4);
  }

  // Ca:Mg ratio
  if ((results.Ca || 0) > 0 && (results.Mg || 0) > 0) {
    const camg = getRatio([results.Ca || 0, results.Mg || 0], ['Ca', 'Mg']);
    if (camg) ratios.push(camg);
  }

  // K:Ca ratio
  if ((results.K || 0) > 0 && (results.Ca || 0) > 0) {
    const kca = getRatio([results.K || 0, results.Ca || 0], ['K', 'Ca']);
    if (kca) ratios.push(kca);
  }

  // K:Ca:Mg ratio in meq/L
  if ((results.K || 0) > 0 && (results.Ca || 0) > 0 && (results.Mg || 0) > 0) {
    const kMeq = (results.K || 0) / 39.1;
    const caMeq = (results.Ca || 0) * 2 / 40.08;
    const mgMeq = (results.Mg || 0) * 2 / 24.31;

    const kcamgMeq = getRatio([kMeq, caMeq, mgMeq], ['K', 'Ca', 'Mg']);
    if (kcamgMeq) {
      kcamgMeq.name = 'K : Ca : Mg (meq/L basis)';
      kcamgMeq.values = [kMeq, caMeq, mgMeq];
      kcamgMeq.unit = 'meq/L';
      ratios.push(kcamgMeq);
    }
  }

  return ratios;
};

// =============================================================================
// OPTIMIZATION ALGORITHMS
// =============================================================================

/**
 * MILP solver helper using highs.js + lp-model
 * @param {Object} params - {fertilizers, targets, volume, tolerance}
 * @returns {Object} {formula, achieved}
 */
window.FertilizerCore.solveMilpBrowser = async function({ fertilizers, targets, volume, tolerance = 0.01 }) {
  const highsFactory = window.highs || window.Module;
  if (!window.LPModel || typeof highsFactory !== 'function') {
    throw new Error('MILP dependencies not loaded');
  }

  const { Model } = window.LPModel;
  const highs = await highsFactory({
    locateFile: (f) => `/assets/vendor/highs/${f}`
  });

  const nutrients = ['N_total', 'P2O5', 'K2O', 'Ca', 'Mg', 'S', 'Si'];
  const tPlus = {}, tMinus = {};
  nutrients.forEach(n => {
    const t = targets[n] || 0;
    tPlus[n] = t > 0 ? t * (1 + tolerance) : 0;
    tMinus[n] = t > 0 ? t * (1 - tolerance) : 0;
  });

  const model = new Model();
  const x = {}, y = {}, slackPlus = {}, slackMinus = {};
  fertilizers.forEach(f => {
    x[f.id] = model.addVar({ lb: 0, ub: '+infinity', vtype: 'CONTINUOUS', name: `x_${f.id}` });
    y[f.id] = model.addVar({ lb: 0, ub: 1, vtype: 'BINARY', name: `y_${f.id}` });
  });
  nutrients.forEach(n => {
    slackPlus[n] = model.addVar({ lb: 0, ub: '+infinity', vtype: 'CONTINUOUS', name: `s_plus_${n}` });
    slackMinus[n] = model.addVar({ lb: 0, ub: '+infinity', vtype: 'CONTINUOUS', name: `s_minus_${n}` });
  });

  const BIG_M = 10000;
  fertilizers.forEach(f => {
    model.addConstr([[1, x[f.id]], [-BIG_M, y[f.id]]], '<=', 0);
  });

  function perGramContrib(fert) {
    const c = { N_total: 0, P2O5: 0, K2O: 0, Ca: 0, Mg: 0, S: 0, Si: 0 };
    const hasNForms = fert.pct.N_NO3 || fert.pct.N_NH4;
    Object.entries(fert.pct).forEach(([nutrient, pct]) => {
      const ppm = (1 * 1000 * (pct / 100)) / volume;
      if (nutrient === 'N_NO3' || nutrient === 'N_NH4') {
        c.N_total += ppm;
      } else if (nutrient === 'N_total') {
        if (!hasNForms) c.N_total += ppm;
      } else if (nutrient === 'P2O5' || nutrient === 'K2O' || nutrient === 'Ca' || nutrient === 'Mg' || nutrient === 'S') {
        c[nutrient] += ppm;
      } else if (nutrient === 'SiO2') {
        c.Si += ppm * 0.46744;
      } else if (nutrient === 'SiOH4') {
        c.Si += ppm * 0.2922;
      } else if (nutrient === 'Si') {
        c.Si += ppm;
      }
    });
    return c;
  }

  nutrients.forEach(n => {
    const terms = [];
    fertilizers.forEach(f => {
      const c = perGramContrib(f);
      if (c[n] !== 0) terms.push([c[n], x[f.id]]);
    });
    if (tMinus[n] > 0) {
      model.addConstr([...terms, [-1, slackMinus[n]]], '>=', tMinus[n]);
    }
    const ub = tPlus[n] > 0 ? tPlus[n] : 0;
    model.addConstr([...terms, [-1, slackPlus[n]]], '<=', ub);
  });

  const objective = [];
  fertilizers.forEach(f => {
    const priorityCoeff = (f.priority || 10) / 10;
    objective.push([priorityCoeff, y[f.id]]);
  });
  nutrients.forEach(n => {
    const isTargeted = (targets[n] || 0) > 0;
    const slackPenalty = isTargeted ? 100 : 50;
    objective.push([slackPenalty, slackPlus[n]]);
    objective.push([slackPenalty, slackMinus[n]]);
  });
  model.setObjective(objective, 'MINIMIZE');

  const lp = model.toLPFormat();
  const solution = highs.solve(lp);
  if (!solution || !model.variables) throw new Error('MILP solver failed');

  const formula = {};
  if (solution.Columns) {
    fertilizers.forEach(f => {
      const col = solution.Columns[`x_${f.id}`] || solution.Columns[f.id];
      const grams = col && typeof col.Primal === 'number' ? col.Primal : 0;
      if (grams > 1e-4) formula[f.id] = grams;
    });
  }

  const achieved = { N_total: 0, N_NO3: 0, N_NH4: 0, P2O5: 0, K2O: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0, Si: 0 };
  Object.entries(formula).forEach(([fid, grams]) => {
    const fert = fertilizers.find(f => f.id === fid);
    if (!fert) return;
    const hasNForms = fert.pct.N_NO3 || fert.pct.N_NH4;
    Object.entries(fert.pct).forEach(([nutrient, pct]) => {
      const ppm = (grams * 1000 * (pct / 100)) / volume;
      if (nutrient === 'N_NO3') {
        achieved.N_NO3 += ppm;
        achieved.N_total += ppm;
      } else if (nutrient === 'N_NH4') {
        achieved.N_NH4 += ppm;
        achieved.N_total += ppm;
      } else if (nutrient === 'N_total') {
        if (!hasNForms) achieved.N_total += ppm;
      } else if (nutrient === 'P2O5') {
        achieved.P2O5 += ppm;
        achieved.P += ppm * 0.436;
      } else if (nutrient === 'K2O') {
        achieved.K2O += ppm;
        achieved.K += ppm * 0.830;
      } else if (nutrient === 'SiO2') {
        achieved.Si += ppm * 0.46744;
      } else if (nutrient === 'SiOH4') {
        achieved.Si += ppm * 0.2922;
      } else if (nutrient === 'Si') {
        achieved.Si += ppm;
      } else if (achieved[nutrient] !== undefined) {
        achieved[nutrient] += ppm;
      }
    });
  });

  return { formula, achieved };
};

/**
 * Simple weighted projected gradient NNLS solver for fertilizer grams
 */
window.FertilizerCore.solveNonNegativeLeastSquares = function(matrix, target, iterations = 1500, weights = []) {
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
};

/**
 * Try to prune fertilizers while staying within tolerance
 */
window.FertilizerCore.pruneSolution = function(matrix, targetVector, weights, baseSolution, fertilizers, tolerance = 0.01, iterations = 800) {
  const solveNNLS = window.FertilizerCore.solveNonNegativeLeastSquares;

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
      const reducedSolution = solveNNLS(reducedMatrix, targetVector, iterations, weights);

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
};

/**
 * Optimization algorithm - finds best fertilizer combination
 */
window.FertilizerCore.optimizeFormula = async function(targetRatios, volume, availableFertilizers, concentration = 75, mode = 'oxide', options = {}) {
  const OXIDE_CONVERSIONS = window.FertilizerCore.OXIDE_CONVERSIONS;
  const solveMilpBrowser = window.FertilizerCore.solveMilpBrowser;
  const solveNNLS = window.FertilizerCore.solveNonNegativeLeastSquares;
  const pruneSolution = window.FertilizerCore.pruneSolution;

  // Optional MILP path
  if (options.useMilp && typeof solveMilpBrowser === 'function') {
    const P_to_P2O5 = 1 / OXIDE_CONVERSIONS.P2O5_to_P;
    const K_to_K2O = 1 / OXIDE_CONVERSIONS.K2O_to_K;

    let ppmTargets;

    if (options.useAbsoluteTargets) {
      ppmTargets = {
        N_total: targetRatios.N || 0,
        P2O5: mode === 'elemental' ? (targetRatios.P || 0) * P_to_P2O5 : (targetRatios.P || 0),
        K2O: mode === 'elemental' ? (targetRatios.K || 0) * K_to_K2O : (targetRatios.K || 0),
        Ca: targetRatios.Ca || 0,
        Mg: targetRatios.Mg || 0,
        S: targetRatios.S || 0,
        Si: targetRatios.Si || 0
      };
    } else {
      const ratioNutrients = { N: targetRatios.N, P: targetRatios.P, K: targetRatios.K, Ca: targetRatios.Ca, Mg: targetRatios.Mg, S: targetRatios.S };
      const ratioValues = Object.values(ratioNutrients).filter(v => v > 0);
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

      ppmTargets = {
        N_total: normalizedRatios.N * basePPMForMinRatio,
        P2O5: mode === 'elemental'
          ? normalizedRatios.P * basePPMForMinRatio * P_to_P2O5
          : normalizedRatios.P * basePPMForMinRatio,
        K2O: mode === 'elemental'
          ? normalizedRatios.K * basePPMForMinRatio * K_to_K2O
          : normalizedRatios.K * basePPMForMinRatio,
        Ca: normalizedRatios.Ca * basePPMForMinRatio,
        Mg: normalizedRatios.Mg * basePPMForMinRatio,
        S: normalizedRatios.S * basePPMForMinRatio,
        Si: targetRatios.Si || 0
      };
    }

    const milpResult = await solveMilpBrowser({ fertilizers: availableFertilizers, targets: ppmTargets, volume, tolerance: 0.01 });

    // Apply EC scaling if targetEC is specified
    if (options.targetEC && options.targetEC > 0) {
      const estimateECFromPPM = window.FertilizerCore.estimateECFromPPM;
      if (typeof estimateECFromPPM === 'function') {
        const originalEC = estimateECFromPPM(milpResult.achieved);
        if (originalEC && originalEC.ec_mS_cm > 0) {
          // Iterative scaling to handle non-linear ionic strength correction
          let scaleFactor = options.targetEC / originalEC.ec_mS_cm;
          let scaledFormula = {};
          let scaledAchieved = {};
          let finalEC = originalEC.ec_mS_cm;

          // Iterate up to 5 times to converge on target EC
          for (let i = 0; i < 5; i++) {
            // Scale formula
            scaledFormula = {};
            Object.entries(milpResult.formula).forEach(([fertId, grams]) => {
              scaledFormula[fertId] = grams * scaleFactor;
            });

            // Scale achieved PPM
            scaledAchieved = {};
            Object.entries(milpResult.achieved).forEach(([key, value]) => {
              scaledAchieved[key] = value * scaleFactor;
            });

            // Check actual EC after scaling
            const newEC = estimateECFromPPM(scaledAchieved);
            finalEC = newEC.ec_mS_cm;

            // If within 1% of target, we're done
            const error = Math.abs(finalEC - options.targetEC) / options.targetEC;
            if (error < 0.01) break;

            // Adjust scale factor based on error
            scaleFactor = scaleFactor * (options.targetEC / finalEC);
          }

          return {
            formula: scaledFormula,
            achieved: scaledAchieved,
            targetRatios,
            targetPPM: ppmTargets,
            ecScaling: { scaleFactor, originalEC: originalEC.ec_mS_cm, targetEC: options.targetEC, achievedEC: finalEC }
          };
        }
      }
    }

    return { formula: milpResult.formula, achieved: milpResult.achieved, targetRatios, targetPPM: ppmTargets };
  }

  // Fallback gradient descent + pruning path
  const ratioNutrients = { N: targetRatios.N, P: targetRatios.P, K: targetRatios.K, Ca: targetRatios.Ca, Mg: targetRatios.Mg, S: targetRatios.S };
  const ratioValues = Object.values(ratioNutrients).filter(v => v > 0);
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
  const P_to_P2O5 = 1 / OXIDE_CONVERSIONS.P2O5_to_P;
  const K_to_K2O = 1 / OXIDE_CONVERSIONS.K2O_to_K;

  const targetPPM_Commercial = {
    N: normalizedRatios.N * basePPMForMinRatio,
    P2O5: mode === 'elemental'
      ? normalizedRatios.P * basePPMForMinRatio * P_to_P2O5
      : normalizedRatios.P * basePPMForMinRatio,
    K2O: mode === 'elemental'
      ? normalizedRatios.K * basePPMForMinRatio * K_to_K2O
      : normalizedRatios.K * basePPMForMinRatio,
    Ca: normalizedRatios.Ca * basePPMForMinRatio,
    Mg: normalizedRatios.Mg * basePPMForMinRatio,
    S: normalizedRatios.S * basePPMForMinRatio,
    Si: targetRatios.Si || 0
  };

  if (options.useAbsoluteTargets) {
    targetPPM_Commercial.N = targetRatios.N || 0;
    targetPPM_Commercial.P2O5 = mode === 'elemental' ? (targetRatios.P || 0) * P_to_P2O5 : (targetRatios.P || 0);
    targetPPM_Commercial.K2O = mode === 'elemental' ? (targetRatios.K || 0) * K_to_K2O : (targetRatios.K || 0);
    targetPPM_Commercial.Ca = targetRatios.Ca || 0;
    targetPPM_Commercial.Mg = targetRatios.Mg || 0;
    targetPPM_Commercial.S = targetRatios.S || 0;
    targetPPM_Commercial.Si = targetRatios.Si || 0;
  }

  const formula = {};
  const achieved = { N_total: 0, N_NO3: 0, N_NH4: 0, P2O5: 0, K2O: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0, Si: 0 };

  function calculatePPM(fert, grams) {
    const contribution = { N_total: 0, N_NO3: 0, N_NH4: 0, P2O5: 0, K2O: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0, Si: 0 };

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
      } else if (nutrient === 'SiO2' && OXIDE_CONVERSIONS.SiO2_to_Si) {
        contribution.Si += ppm * OXIDE_CONVERSIONS.SiO2_to_Si;
      } else if (nutrient === 'SiOH4' && OXIDE_CONVERSIONS.SiOH4_to_Si) {
        contribution.Si += ppm * OXIDE_CONVERSIONS.SiOH4_to_Si;
      } else if (nutrient === 'Si') {
        contribution.Si += ppm;
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

  // Build matrix for least-squares solver
  const allNutrients = ['N_total', 'P2O5', 'K2O', 'Ca', 'Mg', 'S', 'Si'];
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

  function solveForSubset(indices) {
    const subsetMatrix = indices.map(idx => matrix[idx]);
    const subsetFerts = indices.map(idx => availableFertilizers[idx]);
    const baseSolution = solveNNLS(subsetMatrix, targetVector, 1500, weights);
    const pruned = pruneSolution(subsetMatrix, targetVector, weights, baseSolution, subsetFerts, pruneTolerance, 800);
    return pruned && pruned.x ? { solution: pruned, indices } : { solution: baseSolution, indices };
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
        const withinTol = targetVector.every((t, j) => {
          if (t <= 0) return true;
          const achievedVal = sol.solution.x.reduce((sum, xi, pos) => {
            const row = sol.indices.map(idx => matrix[idx])[pos];
            return sum + xi * row[j];
          }, 0);
          return Math.abs(achievedVal - t) / t <= pruneTolerance;
        });

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
    const baseSolution = solveNNLS(matrix, targetVector, 1500, weights);
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

  if (Object.keys(formula).length === 0) {
    const baseSolution = solveNNLS(matrix, targetVector, 1500, weights);
    baseSolution.x.forEach((grams, index) => {
      if (grams > 0.0001) {
        addFertilizer(availableFertilizers[index], grams);
      }
    });
  }

  // Apply EC scaling if targetEC is specified (fallback path)
  if (options.targetEC && options.targetEC > 0) {
    const estimateECFromPPM = window.FertilizerCore.estimateECFromPPM;
    if (typeof estimateECFromPPM === 'function') {
      const originalEC = estimateECFromPPM(achieved);
      if (originalEC && originalEC.ec_mS_cm > 0) {
        // Iterative scaling to handle non-linear ionic strength correction
        let scaleFactor = options.targetEC / originalEC.ec_mS_cm;
        let finalEC = originalEC.ec_mS_cm;

        // Store original values for scaling
        const originalFormula = { ...formula };
        const originalAchieved = { ...achieved };

        // Iterate up to 5 times to converge on target EC
        for (let i = 0; i < 5; i++) {
          // Scale formula
          Object.keys(formula).forEach(fertId => {
            formula[fertId] = originalFormula[fertId] * scaleFactor;
          });

          // Scale achieved PPM
          Object.keys(achieved).forEach(key => {
            achieved[key] = originalAchieved[key] * scaleFactor;
          });

          // Check actual EC after scaling
          const newEC = estimateECFromPPM(achieved);
          finalEC = newEC.ec_mS_cm;

          // If within 1% of target, we're done
          const error = Math.abs(finalEC - options.targetEC) / options.targetEC;
          if (error < 0.01) break;

          // Adjust scale factor based on error
          scaleFactor = scaleFactor * (options.targetEC / finalEC);
        }

        return {
          formula,
          achieved,
          targetRatios,
          targetPPM: targetPPM_Commercial,
          ecScaling: { scaleFactor, originalEC: originalEC.ec_mS_cm, targetEC: options.targetEC, achievedEC: finalEC }
        };
      }
    }
  }

  return { formula, achieved, targetRatios, targetPPM: targetPPM_Commercial };
};

// =============================================================================
// EXPORTS SUMMARY
// =============================================================================
// Data: FERTILIZERS, OXIDE_CONVERSIONS, MOLAR_MASSES, IONIC_CHARGES, EC_CONTRIBUTIONS,
//       IONIC_MOLAR_CONDUCTIVITY, ION_CHARGES, ION_DATA, COMMON_FERTILIZERS, FERTILIZER_COMPATIBILITY
// Helpers: hasCaContent, hasSulfateContent, hasPhosphateContent, hasSilicateContent, hasIncompatibleFertilizers
// EC: estimateEC, ppmToIonsForEC, estimateECFromPPM
// Ion Balance: getIonBalanceStatus, calculateIonBalanceCore
// Ratios: calculateNutrientRatios
// Optimization: solveMilpBrowser, solveNonNegativeLeastSquares, pruneSolution, optimizeFormula
//
// Copy Text Builders (in fertilizer-copy.js):
//   buildTankCopyText, buildTwoTankCopyText, buildGramsToPpmCopyText, buildFormulaCopyText, buildReverseCopyText
