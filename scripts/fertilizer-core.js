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
// CACHED HIGHS SOLVER INSTANCE
// =============================================================================
// Cache the HiGHS solver instance to avoid re-downloading the WASM file on every calculation
let _cachedHighsInstance = null;
let _highsLoadingPromise = null;

/**
 * Get or initialize the HiGHS solver instance (with caching)
 * @param {Function} onProgress - Optional callback for progress updates: (status: string) => void
 * @returns {Promise<Object>} The HiGHS solver instance
 */
window.FertilizerCore.getHighsInstance = async function(onProgress) {
  // Return cached instance if available
  if (_cachedHighsInstance) {
    return _cachedHighsInstance;
  }

  // If already loading, wait for that promise
  if (_highsLoadingPromise) {
    return _highsLoadingPromise;
  }

  // Start loading
  const highsFactory = window.highs || window.Module;
  if (typeof highsFactory !== 'function') {
    throw new Error('HiGHS solver not available');
  }

  // Notify that we're downloading the solver
  if (onProgress) {
    onProgress('downloading');
  }

  // Determine base path for WASM file - handle both file:// and http(s):// protocols
  const getWasmPath = (filename) => {
    // Try to find the highs.js script and get its directory
    const scripts = document.getElementsByTagName('script');
    for (const script of scripts) {
      if (script.src && script.src.includes('highs.js')) {
        return script.src.replace('highs.js', filename);
      }
    }
    // Fallback to absolute path for web server
    return `/assets/vendor/highs/${filename}`;
  };

  _highsLoadingPromise = highsFactory({
    locateFile: (f) => getWasmPath(f)
  }).then(instance => {
    _cachedHighsInstance = instance;
    _highsLoadingPromise = null;
    if (onProgress) {
      onProgress('ready');
    }
    return instance;
  }).catch(err => {
    _highsLoadingPromise = null;
    throw err;
  });

  return _highsLoadingPromise;
};

/**
 * Check if HiGHS solver is already loaded (cached)
 * @returns {boolean}
 */
window.FertilizerCore.isHighsLoaded = function() {
  return _cachedHighsInstance !== null;
};

/**
 * Pre-load the HiGHS solver in the background
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {Promise<void>}
 */
window.FertilizerCore.preloadHighsSolver = async function(onProgress) {
  if (_cachedHighsInstance || _highsLoadingPromise) {
    return; // Already loaded or loading
  }
  try {
    await window.FertilizerCore.getHighsInstance(onProgress);
  } catch (e) {
    console.warn('Failed to preload HiGHS solver:', e);
  }
};

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
 * @param {Object} params - {fertilizers, targets, volume, tolerance, onProgress, pekacidMaxLimit}
 * @param {Function} params.onProgress - Optional callback for progress updates: (status: string) => void
 * @param {number} params.pekacidMaxLimit - Optional max limit for PeKacid in g/L (0 = no limit)
 * @returns {Object} {formula, achieved}
 */
window.FertilizerCore.solveMilpBrowser = async function({ fertilizers, targets, volume, tolerance = 0.01, onProgress, pekacidMaxLimit = 0 }) {
  if (!window.LPModel) {
    throw new Error('MILP dependencies not loaded');
  }

  const { Model } = window.LPModel;
  const OXIDE_CONVERSIONS = window.FertilizerCore.OXIDE_CONVERSIONS;
  const P_to_P2O5 = 1 / OXIDE_CONVERSIONS.P2O5_to_P;
  const K_to_K2O = 1 / OXIDE_CONVERSIONS.K2O_to_K;

  // Use cached HiGHS instance (downloads WASM only on first call)
  const highs = await window.FertilizerCore.getHighsInstance(onProgress);

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
  const PEKACID_ID = 'icl_pekacid_pk_acid';
  fertilizers.forEach(f => {
    model.addConstr([[1, x[f.id]], [-BIG_M, y[f.id]]], '<=', 0);
  });

  // Add PeKacid limit constraint if specified (and > 0)
  // The limit is in g/L, so target grams = limit * volume
  // We add BOTH a max constraint AND a minimum incentive via slack variable
  let pekacidSlack = null;
  let pekacidTargetGrams = 0;
  if (pekacidMaxLimit > 0 && x[PEKACID_ID]) {
    pekacidTargetGrams = pekacidMaxLimit * volume;
    // Max constraint - can't exceed the limit
    model.addConstr([[1, x[PEKACID_ID]]], '<=', pekacidTargetGrams);
    // Min constraint with slack - try to use at least the limit amount
    // pekacidSlack + x[PEKACID_ID] >= targetGrams
    // When x[PEKACID_ID] < targetGrams, slack must be positive (penalized)
    // When x[PEKACID_ID] = targetGrams, slack can be 0 (no penalty)
    pekacidSlack = model.addVar({ lb: 0, ub: '+infinity', vtype: 'CONTINUOUS', name: 'pekacid_slack' });
    model.addConstr([[1, pekacidSlack], [1, x[PEKACID_ID]]], '>=', pekacidTargetGrams);
  }

  function perGramContrib(fert) {
    const c = { N_total: 0, P2O5: 0, K2O: 0, Ca: 0, Mg: 0, S: 0, Si: 0 };
    const hasNForms = fert.pct.N_NO3 || fert.pct.N_NH4;
    Object.entries(fert.pct).forEach(([nutrient, pct]) => {
      const ppm = (1 * 1000 * (pct / 100)) / volume;
      if (nutrient === 'N_NO3' || nutrient === 'N_NH4') {
        c.N_total += ppm;
      } else if (nutrient === 'N_total') {
        if (!hasNForms) c.N_total += ppm;
      } else if (nutrient === 'P2O5') {
        c.P2O5 += ppm;
      } else if (nutrient === 'P') {
        c.P2O5 += ppm * P_to_P2O5;
      } else if (nutrient === 'K2O') {
        c.K2O += ppm;
      } else if (nutrient === 'K') {
        c.K2O += ppm * K_to_K2O;
      } else if (nutrient === 'Ca') {
        c.Ca += ppm;
      } else if (nutrient === 'CaO') {
        c.Ca += ppm * OXIDE_CONVERSIONS.CaO_to_Ca;
      } else if (nutrient === 'Mg') {
        c.Mg += ppm;
      } else if (nutrient === 'MgO') {
        c.Mg += ppm * OXIDE_CONVERSIONS.MgO_to_Mg;
      } else if (nutrient === 'S') {
        c.S += ppm;
      } else if (nutrient === 'SO3') {
        c.S += ppm * OXIDE_CONVERSIONS.SO3_to_S;
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
    // PeKacid gets very low priority coefficient (near 0) to be strongly preferred first
    // This encourages the solver to use PeKacid before other P/K sources
    // Lower coefficient = higher preference (since we're minimizing)
    let priorityCoeff;
    if (f.id === PEKACID_ID) {
      priorityCoeff = 0.01;  // Very low = strongly prefer PeKacid
    } else {
      priorityCoeff = (f.priority || 10) / 10;
    }
    objective.push([priorityCoeff, y[f.id]]);
  });

  // Add very strong penalty for NOT using the full PeKacid limit
  // The pekacidSlack variable represents how much below the target we are
  // A very high penalty forces the solver to minimize this slack (i.e., use more PeKacid)
  if (pekacidSlack) {
    // Penalty of 10000 makes filling PeKacid to limit more important than exact nutrient ratios
    // (nutrient slack penalties are only 100)
    objective.push([10000, pekacidSlack]);
  }

  nutrients.forEach(n => {
    const isTargeted = (targets[n] || 0) > 0;
    // Si gets much higher penalty because it's an absolute PPM target (not ratio-normalized)
    // and Potassium Silicate also contributes K2O, so solver may under-use it otherwise
    // Using 10000 to strongly prioritize Si over ratio precision
    const slackPenalty = isTargeted ? (n === 'Si' ? 10000 : 100) : 50;
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
        achieved.P += ppm * OXIDE_CONVERSIONS.P2O5_to_P;
      } else if (nutrient === 'P') {
        achieved.P += ppm;
        achieved.P2O5 += ppm * P_to_P2O5;
      } else if (nutrient === 'K2O') {
        achieved.K2O += ppm;
        achieved.K += ppm * OXIDE_CONVERSIONS.K2O_to_K;
      } else if (nutrient === 'K') {
        achieved.K += ppm;
        achieved.K2O += ppm * K_to_K2O;
      } else if (nutrient === 'CaO') {
        achieved.Ca += ppm * OXIDE_CONVERSIONS.CaO_to_Ca;
      } else if (nutrient === 'MgO') {
        achieved.Mg += ppm * OXIDE_CONVERSIONS.MgO_to_Mg;
      } else if (nutrient === 'SO3') {
        achieved.S += ppm * OXIDE_CONVERSIONS.SO3_to_S;
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
 * @param {Object} options.onProgress - Optional callback for progress updates (e.g., WASM download)
 */
window.FertilizerCore.optimizeFormula = async function(targetRatios, volume, availableFertilizers, concentration = 75, mode = 'oxide', options = {}) {
  const OXIDE_CONVERSIONS = window.FertilizerCore.OXIDE_CONVERSIONS;
  const solveMilpBrowser = window.FertilizerCore.solveMilpBrowser;
  const onProgress = options.onProgress;

  // MILP is required - no fallback
  if (typeof solveMilpBrowser !== 'function') {
    throw new Error('MILP solver (solveMilpBrowser) is not available. Ensure HiGHS and lp-model are loaded.');
  }

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

  // Pass pekacidMaxLimit to the MILP solver if specified
  const pekacidMaxLimit = options.pekacidMaxLimit || 0;
  const milpResult = await solveMilpBrowser({ fertilizers: availableFertilizers, targets: ppmTargets, volume, tolerance: 0.01, onProgress, pekacidMaxLimit });

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

        // Si is an absolute PPM target (not ratio-based), so we need to handle it specially
        const targetSi = targetRatios.Si || 0;

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

        // For Si: if user specified an absolute Si target, we need to iteratively adjust
        // the Si target so that after EC scaling it reaches the desired value.
        // Always adjust Si after EC scaling (scale up or down) because Si is an absolute PPM target
        if (targetSi > 0) {
          let currentSiTarget = targetSi;
          let bestSiError = Math.abs((scaledAchieved.Si || 0) - targetSi);
          let bestFormula = { ...scaledFormula };
          let bestAchieved = { ...scaledAchieved };
          let bestScaleFactor = scaleFactor;

          // Iterate up to 5 times to converge Si to target
          for (let siIter = 0; siIter < 5; siIter++) {
            const achievedSi = scaledAchieved.Si || 0;
            const siError = Math.abs(achievedSi - targetSi);

            // Track best result
            if (siError < bestSiError) {
              bestSiError = siError;
              bestFormula = { ...scaledFormula };
              bestAchieved = { ...scaledAchieved };
              bestScaleFactor = scaleFactor;
            }

            // If Si is within 10% of target, good enough
            if (siError / targetSi < 0.1) break;

            // Adjust Si target based on how much we're missing
            // If achieved 14 but want 25, ratio is 25/14 = 1.79, so multiply current target by that
            const siAdjustmentRatio = achievedSi > 0 ? targetSi / achievedSi : 2;
            currentSiTarget = currentSiTarget * siAdjustmentRatio;

            // Cap the adjustment to avoid runaway values
            currentSiTarget = Math.min(currentSiTarget, targetSi * 5);

            const adjustedPpmTargets = { ...ppmTargets, Si: currentSiTarget };

            // Re-run solver with adjusted Si target
            const adjustedResult = await solveMilpBrowser({
              fertilizers: availableFertilizers,
              targets: adjustedPpmTargets,
              volume,
              tolerance: 0.01,
              onProgress
            });

            // Re-apply EC scaling to the adjusted result
            const adjustedOriginalEC = estimateECFromPPM(adjustedResult.achieved);
            if (adjustedOriginalEC && adjustedOriginalEC.ec_mS_cm > 0) {
              scaleFactor = options.targetEC / adjustedOriginalEC.ec_mS_cm;

              for (let i = 0; i < 5; i++) {
                scaledFormula = {};
                Object.entries(adjustedResult.formula).forEach(([fertId, grams]) => {
                  scaledFormula[fertId] = grams * scaleFactor;
                });

                scaledAchieved = {};
                Object.entries(adjustedResult.achieved).forEach(([key, value]) => {
                  scaledAchieved[key] = value * scaleFactor;
                });

                const newEC = estimateECFromPPM(scaledAchieved);
                finalEC = newEC.ec_mS_cm;

                const error = Math.abs(finalEC - options.targetEC) / options.targetEC;
                if (error < 0.01) break;

                scaleFactor = scaleFactor * (options.targetEC / finalEC);
              }
            }
          }

          // Use the best result found
          scaledFormula = bestFormula;
          scaledAchieved = bestAchieved;
          scaleFactor = bestScaleFactor;
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
};

// =============================================================================
// STOCK SOLUTION MAKER
// =============================================================================
// Creates shared stock solutions that can achieve multiple target ratios
// by varying dosing. Implements Progressive-K algorithm for minimal tanks.

/**
 * Get solubility limit for a fertilizer (g/L at 20°C)
 * @param {string} fertId - Fertilizer ID
 * @returns {number} Solubility in g/L
 */
window.FertilizerCore.getSolubility = function(fertId) {
  const fert = this.FERTILIZERS.find(f => f.id === fertId);
  return fert?.solubility_gL ?? this.DEFAULT_SOLUBILITY_GL;
};

/**
 * Get compatibility tag for a fertilizer
 * @param {string} fertId - Fertilizer ID
 * @returns {string} 'calcium' | 'phosphate' | 'sulfate' | 'silicate' | 'neutral'
 */
window.FertilizerCore.getCompatibilityTag = function(fertId) {
  const compat = this.FERTILIZER_COMPATIBILITY;
  if (compat.calcium_sources.includes(fertId)) return 'calcium';
  if (compat.phosphate_sources.includes(fertId)) return 'phosphate';
  if (compat.sulfate_sources.includes(fertId)) return 'sulfate';
  if (compat.silicate_sources.includes(fertId)) return 'silicate';
  return 'neutral';
};

/**
 * Parse ratio string into object
 * Supports: "2:1:3" (positional N:P:K:Ca:Mg) or "N2:P1:K3" (labeled)
 * @param {string} input - Ratio string
 * @returns {Object} { ratio: {N,P,K,Ca,Mg,S}, error?: string }
 */
window.FertilizerCore.parseRatio = function(input) {
  if (!input || typeof input !== 'string') {
    return { error: 'Invalid input: expected ratio string' };
  }

  const cleaned = input.trim().replace(/\s+/g, '');
  if (!cleaned) {
    return { error: 'Empty ratio string' };
  }

  const ratio = { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 };

  // Check if labeled format (contains letters before numbers)
  const labeledPattern = /^([A-Za-z]+[\d.]+:?)+$/;
  const isLabeled = labeledPattern.test(cleaned);

  if (isLabeled) {
    // Labeled format: "N2:P1:K3:Ca0.5"
    const parts = cleaned.split(':').filter(Boolean);
    for (const part of parts) {
      const match = part.match(/^([A-Za-z]+)([\d.]+)$/);
      if (!match) {
        return { error: `Invalid labeled format: ${part}` };
      }
      const label = match[1].toUpperCase();
      const value = parseFloat(match[2]);
      if (isNaN(value)) {
        return { error: `Invalid number: ${match[2]}` };
      }
      // Map common labels
      const labelMap = { N: 'N', P: 'P', K: 'K', CA: 'Ca', MG: 'Mg', S: 'S' };
      const key = labelMap[label];
      if (!key) {
        return { error: `Unknown nutrient label: ${label}` };
      }
      ratio[key] = value;
    }
  } else {
    // Positional format: "2:1:3" or "2:1:3:1:0.5"
    const parts = cleaned.split(':');
    const order = ['N', 'P', 'K', 'Ca', 'Mg', 'S'];
    for (let i = 0; i < parts.length && i < order.length; i++) {
      const value = parseFloat(parts[i]);
      if (isNaN(value)) {
        return { error: `Invalid number at position ${i + 1}: ${parts[i]}` };
      }
      ratio[order[i]] = value;
    }
  }

  return { ratio };
};

/**
 * Calculate elemental PPM contribution from 1 gram of fertilizer per liter
 * @param {Object} fert - Fertilizer object with pct
 * @returns {Object} { N, P, K, Ca, Mg, S } in ppm per gram per liter
 */
window.FertilizerCore.getElementalContributionPerGram = function(fert) {
  const OXIDE = this.OXIDE_CONVERSIONS;
  const contrib = { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 };
  const pct = fert.pct || {};

  // Nitrogen: sum all N forms
  const hasNForms = pct.N_NO3 || pct.N_NH4;
  if (hasNForms) {
    contrib.N = ((pct.N_NO3 || 0) + (pct.N_NH4 || 0)) * 10; // % * 10 = ppm per g/L
  } else if (pct.N_total) {
    contrib.N = pct.N_total * 10;
  }

  // Phosphorus
  if (pct.P) {
    contrib.P = pct.P * 10;
  } else if (pct.P2O5) {
    contrib.P = pct.P2O5 * 10 * OXIDE.P2O5_to_P;
  }

  // Potassium
  if (pct.K) {
    contrib.K = pct.K * 10;
  } else if (pct.K2O) {
    contrib.K = pct.K2O * 10 * OXIDE.K2O_to_K;
  }

  // Calcium
  if (pct.Ca) {
    contrib.Ca = pct.Ca * 10;
  } else if (pct.CaO) {
    contrib.Ca = pct.CaO * 10 * OXIDE.CaO_to_Ca;
  }

  // Magnesium
  if (pct.Mg) {
    contrib.Mg = pct.Mg * 10;
  } else if (pct.MgO) {
    contrib.Mg = pct.MgO * 10 * OXIDE.MgO_to_Mg;
  }

  // Sulfur
  if (pct.S) {
    contrib.S = pct.S * 10;
  } else if (pct.SO3) {
    contrib.S = pct.SO3 * 10 * OXIDE.SO3_to_S;
  }

  return contrib;
};

/**
 * Assign fertilizers to tanks based on compatibility rules
 * @param {Object} formula - { fertId: grams } for final solution
 * @param {number} numTanks - Number of tanks (2, 3, or 4)
 * @param {Object} options - Optional behavior flags
 * @param {boolean} options.separateMg - If true, place Mg sources in Tank D when available
 * @returns {Object} { A: {...}, B: {...}, C?: {...}, D?: {...} }
 */
window.FertilizerCore.assignToTanks = function(formula, numTanks = 2, options = {}) {
  const { separateMg = false } = options;
  const tanks = { A: {}, B: {} };
  if (numTanks >= 3) tanks.C = {};
  if (numTanks >= 4) tanks.D = {};

  for (const [fertId, grams] of Object.entries(formula)) {
    if (!grams || grams <= 0) continue;

    const tag = this.getCompatibilityTag(fertId);
    const fert = this.FERTILIZERS.find(f => f.id === fertId);

    // Helper: does this fertilizer have significant K content?
    const hasSignificantK = fert && fert.pct && fert.pct.K2O > 20;
    const hasP = fert && fert.pct && fert.pct.P2O5 > 5;
    const hasMg = fert && fert.pct && ((fert.pct.Mg || 0) > 0 || (fert.pct.MgO || 0) > 0);

    // If P:Mg varies across targets and we have 4+ tanks, keep Mg sources separate
    if (separateMg && numTanks >= 4 && hasMg && !hasP && !hasSignificantK) {
      tanks.D[fertId] = grams;
      continue;
    }

    switch (tag) {
      case 'calcium':
        // Ca goes to Tank A (isolated from phosphate/sulfate)
        tanks.A[fertId] = grams;
        break;
      case 'phosphate':
        // Phosphate goes to Tank B
        tanks.B[fertId] = grams;
        break;
      case 'sulfate':
        // With 3+ tanks, separate K-heavy sulfates (like K2SO4) to Tank C
        // This allows independent control of P:K ratios across targets
        if (numTanks >= 3 && hasSignificantK && !hasP) {
          // K-dominant sulfate (like K2SO4, langbeinite) goes to Tank C
          tanks.C[fertId] = grams;
        } else {
          tanks.B[fertId] = grams;
        }
        break;
      case 'silicate':
        // Silicate goes to Tank D if 4 tanks, Tank C if 3 tanks, otherwise B
        if (numTanks >= 4) {
          tanks.D[fertId] = grams;
        } else if (numTanks >= 3) {
          tanks.C[fertId] = grams;
        } else {
          tanks.B[fertId] = grams;
        }
        break;
      case 'neutral':
      default:
        // With 3+ tanks, K-containing neutrals (like KNO3) go to Tank C
        // This allows independent control of P:K ratios across targets
        if (numTanks >= 3 && hasSignificantK && !hasP) {
          tanks.C[fertId] = grams;
        } else {
          tanks.B[fertId] = grams;
        }
        break;
    }
  }

  return tanks;
};

/**
 * Check if a tank's stock composition is feasible (solubility)
 * @param {Object} tankFormula - { fertId: g/L in stock }
 * @returns {Object} { feasible: boolean, issues: [] }
 */
window.FertilizerCore.checkTankFeasibility = function(tankFormula) {
  const issues = [];

  for (const [fertId, gL] of Object.entries(tankFormula)) {
    if (!gL || gL <= 0) continue;

    const solubility = this.getSolubility(fertId);
    const pctUsed = (gL / solubility) * 100;

    if (gL > solubility) {
      const fert = this.FERTILIZERS.find(f => f.id === fertId);
      issues.push({
        level: 'error',
        code: 'SOLUBILITY_EXCEEDED',
        message: `${fert?.name || fertId} requires ${gL.toFixed(1)} g/L but max solubility is ${solubility} g/L`,
        details: { fertilizer: fertId, required_gL: gL, max_gL: solubility, pctUsed }
      });
    } else if (pctUsed > 80) {
      const fert = this.FERTILIZERS.find(f => f.id === fertId);
      issues.push({
        level: 'warning',
        code: 'SOLUBILITY_NEAR_LIMIT',
        message: `${fert?.name || fertId} at ${pctUsed.toFixed(0)}% of solubility limit`,
        details: { fertilizer: fertId, required_gL: gL, max_gL: solubility, pctUsed }
      });
    }
  }

  return {
    feasible: !issues.some(i => i.level === 'error'),
    issues
  };
};

/**
 * Calculate PPM achieved from stock compositions and dosing
 * @param {Object} tanks - { A: {fertId: g/L}, B: {...}, ... }
 * @param {Object} dosing - { A: mL/L, B: mL/L, ... }
 * @returns {Object} { N, P, K, Ca, Mg, S } in ppm
 */
window.FertilizerCore.calculateAchievedPPM = function(tanks, dosing) {
  const achieved = { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 };

  for (const [tankId, tankFormula] of Object.entries(tanks)) {
    const dose_mL = dosing[tankId] || 0;
    if (dose_mL <= 0) continue;

    for (const [fertId, stock_gL] of Object.entries(tankFormula)) {
      if (!stock_gL || stock_gL <= 0) continue;

      const fert = this.FERTILIZERS.find(f => f.id === fertId);
      if (!fert) continue;

      const contribPerGram = this.getElementalContributionPerGram(fert);
      // stock_gL = grams per liter of stock
      // dose_mL = mL of stock per liter of final
      // grams in final = stock_gL * dose_mL / 1000
      const gramsInFinal = stock_gL * dose_mL / 1000;

      for (const nutrient of Object.keys(achieved)) {
        achieved[nutrient] += contribPerGram[nutrient] * gramsInFinal;
      }
    }
  }

  return achieved;
};

/**
 * Check if achieved PPM matches target ratio within tolerance
 * @param {Object} achieved - { N, P, K, Ca, Mg, S } in ppm
 * @param {Object} targetRatio - { N, P, K, Ca, Mg, S } ratio values
 * @param {number} tolerance - Allowed deviation (0.05 = 5%)
 * @returns {Object} { matches: boolean, errors: {} }
 */
window.FertilizerCore.checkRatioMatch = function(achieved, targetRatio, tolerance = 0.05) {
  const errors = {};

  // Find non-zero target nutrients
  const targetKeys = Object.keys(targetRatio).filter(k => targetRatio[k] > 0);
  if (targetKeys.length === 0) {
    return { matches: true, errors };
  }

  // Normalize both to minimum non-zero value
  const targetMin = Math.min(...targetKeys.map(k => targetRatio[k]));
  const achievedMin = Math.min(...targetKeys.map(k => achieved[k] || 0.0001).filter(v => v > 0));

  if (achievedMin <= 0) {
    for (const k of targetKeys) {
      if (achieved[k] <= 0 && targetRatio[k] > 0) {
        errors[k] = { target: targetRatio[k], achieved: 0, error: 1.0 };
      }
    }
    return { matches: false, errors };
  }

  for (const k of targetKeys) {
    const targetNorm = targetRatio[k] / targetMin;
    const achievedNorm = (achieved[k] || 0) / achievedMin;

    if (targetNorm > 0) {
      const relError = Math.abs(achievedNorm - targetNorm) / targetNorm;
      if (relError > tolerance) {
        errors[k] = { target: targetNorm, achieved: achievedNorm, error: relError };
      }
    }
  }

  return { matches: Object.keys(errors).length === 0, errors };
};

/**
 * Solve for dosing given fixed stock compositions to match target ratio and EC
 * Two-phase approach:
 *   Phase 1: Find tank dosing RATIOS that match the target nutrient ratio (ignoring EC)
 *   Phase 2: Scale all dosing uniformly to hit target EC
 * @param {Object} tanks - { A: {fertId: g/L}, B: {...} }
 * @param {Object} target - { ratio: {...}, targetEC, baselineEC }
 * @param {Object} options - { maxDosing, tolerance }
 * @returns {Object} { dosing: {A, B, ...}, achieved, predictedEC, feasible, issues }
 */
window.FertilizerCore.solveDosing = function(tanks, target, options = {}) {
  const { maxDosing = 50, tolerance = 0.15 } = options; // Tolerance for ratio matching
  const { ratio, targetEC, baselineEC = 0 } = target;
  const estimateECFromPPM = this.estimateECFromPPM;

  // Calculate nutrient contribution per mL of each tank
  const tankContribPerML = {};
  for (const [tankId, tankFormula] of Object.entries(tanks)) {
    tankContribPerML[tankId] = { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 };
    for (const [fertId, stock_gL] of Object.entries(tankFormula)) {
      if (!stock_gL) continue;
      const fert = this.FERTILIZERS.find(f => f.id === fertId);
      if (!fert) continue;
      const contribPerGram = this.getElementalContributionPerGram(fert);
      for (const n of Object.keys(tankContribPerML[tankId])) {
        tankContribPerML[tankId][n] += contribPerGram[n] * stock_gL / 1000;
      }
    }
  }

  const tankIds = Object.keys(tanks).filter(t => Object.keys(tanks[t]).length > 0);
  if (tankIds.length === 0) {
    return { dosing: {}, achieved: { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 }, predictedEC: baselineEC, feasible: false, issues: [{ level: 'error', code: 'NO_FERTILIZERS', message: 'No fertilizers in tanks' }] };
  }

  const effectiveTargetEC = targetEC - baselineEC;
  if (effectiveTargetEC <= 0) {
    return { dosing: {}, achieved: { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 }, predictedEC: baselineEC, feasible: false, issues: [{ level: 'error', code: 'EC_UNACHIEVABLE', message: `Target EC ${targetEC} is below baseline ${baselineEC}` }] };
  }

  // Get nutrients specified in target ratio
  const targetNutrients = ['N', 'P', 'K', 'Ca', 'Mg', 'S'].filter(n => ratio[n] > 0);
  const targetMin = Math.min(...targetNutrients.map(n => ratio[n]).filter(v => v > 0)) || 1;

  // ========================================================================
  // PHASE 1: Find dosing RATIOS that match the target nutrient ratio
  // We optimize the A:B (or A:B:C, A:B:C:D) ratios to match nutrient ratios
  // EC doesn't matter yet - we'll scale for EC in Phase 2
  // ========================================================================

  let bestDosing = {};
  let bestRatioError = Infinity;

  // Helper to calculate ratio error for a given dosing
  const calcRatioError = (dosing) => {
    const achieved = this.calculateAchievedPPM(tanks, dosing);
    const achievedNonZero = targetNutrients.filter(n => achieved[n] > 0);
    if (achievedNonZero.length === 0) return Infinity;

    const achievedMin = Math.min(...achievedNonZero.map(n => achieved[n])) || 0.001;

    let ratioError = 0;
    for (const n of targetNutrients) {
      const targetNorm = ratio[n] / targetMin;
      const achievedNorm = (achieved[n] || 0) / achievedMin;
      if (targetNorm > 0) {
        const err = (achievedNorm - targetNorm) / targetNorm;
        ratioError += err * err;
      }
    }
    return ratioError;
  };

  // Ratio steps to try - expanded range including very extreme ratios
  // This allows spanning from almost-zero Tank A to almost-zero Tank B
  const ratioSteps = [0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.0, 10.0, 15.0, 20.0, 50.0];

  if (tankIds.length === 1) {
    // Single tank - just use 10 mL
    bestDosing[tankIds[0]] = 10;
  } else if (tankIds.length === 2) {
    // 2 tanks: search A:B ratios
    for (const abRatio of ratioSteps) {
      const total = abRatio + 1;
      const dosing = {
        [tankIds[0]]: 10 * abRatio / total,
        [tankIds[1]]: 10 / total
      };
      const err = calcRatioError(dosing);
      if (err < bestRatioError) {
        bestRatioError = err;
        bestDosing = { ...dosing };
      }
    }
  } else if (tankIds.length === 3) {
    // 3 tanks: search A:B:C ratios
    const steps3 = [0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0];
    for (const aRatio of steps3) {
      for (const bRatio of steps3) {
        const total = aRatio + bRatio + 1;
        const dosing = {
          [tankIds[0]]: 10 * aRatio / total,
          [tankIds[1]]: 10 * bRatio / total,
          [tankIds[2]]: 10 / total
        };
        const err = calcRatioError(dosing);
        if (err < bestRatioError) {
          bestRatioError = err;
          bestDosing = { ...dosing };
        }
      }
    }
  } else {
    // 4+ tanks: search A:B:C:D ratios
    const steps4 = [0.2, 0.5, 1.0, 2.0, 5.0];
    for (const aRatio of steps4) {
      for (const bRatio of steps4) {
        for (const cRatio of steps4) {
          const total = aRatio + bRatio + cRatio + 1;
          const dosing = {
            [tankIds[0]]: 10 * aRatio / total,
            [tankIds[1]]: 10 * bRatio / total,
            [tankIds[2]]: 10 * cRatio / total,
            [tankIds[3]]: 10 / total
          };
          // Handle 5+ tanks if ever needed
          for (let i = 4; i < tankIds.length; i++) {
            dosing[tankIds[i]] = 1;
          }
          const err = calcRatioError(dosing);
          if (err < bestRatioError) {
            bestRatioError = err;
            bestDosing = { ...dosing };
          }
        }
      }
    }
  }

  // Local refinement: try small adjustments around the best solution
  if (tankIds.length >= 2 && bestRatioError > 0.01) {
    const refinementSteps = [-0.3, -0.1, 0.1, 0.3];
    let improved = true;
    let iterations = 0;
    while (improved && iterations < 10) {
      improved = false;
      iterations++;
      for (const tankId of tankIds) {
        const baseDose = bestDosing[tankId] || 0;
        for (const delta of refinementSteps) {
          const testDosing = { ...bestDosing };
          testDosing[tankId] = Math.max(0.01, baseDose * (1 + delta));
          const err = calcRatioError(testDosing);
          if (err < bestRatioError) {
            bestRatioError = err;
            bestDosing = { ...testDosing };
            improved = true;
          }
        }
      }
    }
  }

  // ========================================================================
  // PHASE 2: Scale all dosing uniformly to hit target EC
  // The ratio between tanks stays the same, we just scale everything
  // ========================================================================

  let dosing = { ...bestDosing };

  // Calculate current EC
  let achieved = this.calculateAchievedPPM(tanks, dosing);
  let ecResult = estimateECFromPPM.call(this, achieved);
  let currentEC = ecResult.ec_mS_cm;

  // Scale to hit target EC
  if (currentEC > 0) {
    const ecScale = effectiveTargetEC / currentEC;
    for (const t of tankIds) {
      dosing[t] *= ecScale;
    }
    achieved = this.calculateAchievedPPM(tanks, dosing);
    ecResult = estimateECFromPPM.call(this, achieved);
  }

  const predictedEC = ecResult.ec_mS_cm + baselineEC;

  // ========================================================================
  // Check constraints and build issues
  // ========================================================================

  const issues = [];
  const totalDosing = Object.values(dosing).reduce((a, b) => a + b, 0);

  if (totalDosing > maxDosing) {
    issues.push({
      level: 'error',
      code: 'DOSING_EXCEEDS_MAX',
      message: `Total dosing ${totalDosing.toFixed(1)} mL/L exceeds max ${maxDosing} mL/L`,
      details: { required: totalDosing, max: maxDosing }
    });
  } else if (totalDosing > maxDosing * 0.8) {
    issues.push({
      level: 'warning',
      code: 'HIGH_DOSING_VOLUME',
      message: `Total dosing ${totalDosing.toFixed(1)} mL/L is high`,
      details: { required: totalDosing, max: maxDosing }
    });
  }

  // Check ratio match - this is an error that triggers escalation to more tanks
  const ratioCheck = this.checkRatioMatch(achieved, ratio, tolerance);
  if (!ratioCheck.matches) {
    issues.push({
      level: 'error',
      code: 'RATIO_MISMATCH',
      message: 'Achieved ratio does not match target within tolerance',
      details: ratioCheck.errors
    });
  }

  // Check EC match (should be very close after scaling)
  const ecErrorFinal = Math.abs(predictedEC - targetEC) / targetEC;
  if (ecErrorFinal > 0.05) {
    issues.push({
      level: 'warning',
      code: 'EC_MISMATCH',
      message: `Predicted EC ${predictedEC.toFixed(2)} differs from target ${targetEC.toFixed(2)}`,
      details: { predicted: predictedEC, target: targetEC, error: ecErrorFinal }
    });
  }

  return {
    dosing,
    achieved,
    predictedEC,
    feasible: !issues.some(i => i.level === 'error'),
    issues
  };
};

/**
 * Build stock compositions for a set of targets using Progressive-K algorithm
 * MODE B: Common stocks for all targets, vary dosing
 * @param {Object} options
 * @param {Array} options.targets - Array of { id, ratio, targetEC, baselineEC?, maxDosingML?, finalLiters? }
 * @param {Array} options.availableFertilizers - Array of fertilizer IDs
 * @param {number} options.stockConcentration - e.g., 100 for 100x
 * @param {number} options.stockTankVolumeL - Liters per stock tank
 * @param {number} options.baselineEC - Default baseline EC
 * @returns {Promise<Object>} StockPlan
 */
window.FertilizerCore.calculateStockSolutions = async function(options) {
  const {
    targets,
    availableFertilizers,
    stockConcentration = 100,
    stockTankVolumeL = 20,
    baselineEC: defaultBaselineEC = 0
  } = options;

  if (!targets || targets.length === 0) {
    return { success: false, errors: [{ level: 'error', code: 'NO_TARGETS', message: 'No targets specified' }] };
  }

  if (!availableFertilizers || availableFertilizers.length === 0) {
    return { success: false, errors: [{ level: 'error', code: 'NO_FERTILIZERS', message: 'No fertilizers available' }] };
  }

  // Get fertilizer objects
  const fertObjects = availableFertilizers
    .map(id => this.FERTILIZERS.find(f => f.id === id))
    .filter(Boolean);

  if (fertObjects.length === 0) {
    return { success: false, errors: [{ level: 'error', code: 'NO_VALID_FERTILIZERS', message: 'No valid fertilizers found' }] };
  }

  // Find target with highest EC (base case for stock concentration)
  const sortedTargets = [...targets].sort((a, b) => (b.targetEC || 0) - (a.targetEC || 0));
  const maxECTarget = sortedTargets[0];

  // Progressive-K algorithm: try K=2, then K=3, then K=4
  for (let numTanks = 2; numTanks <= 4; numTanks++) {
    const result = await this._tryStockSolutionWithKTanks(
      numTanks,
      targets,
      fertObjects,
      stockConcentration,
      stockTankVolumeL,
      defaultBaselineEC,
      maxECTarget
    );

    if (result.success) {
      return result;
    }

    // If K=4 failed, return the error
    if (numTanks === 4) {
      return result;
    }
  }

  return { success: false, errors: [{ level: 'error', code: 'INFEASIBLE', message: 'Could not find feasible stock solution with up to 4 tanks' }] };
};

/**
 * Internal: Try to build stock solution with K tanks
 *
 * Simple approach: Use compatibility rules for tank assignment.
 * Calcium sources in Tank A, everything else distributed by type.
 * With 3+ tanks, separate K-only sources for independent P:K control.
 */
window.FertilizerCore._tryStockSolutionWithKTanks = async function(
  numTanks,
  targets,
  fertObjects,
  stockConcentration,
  stockTankVolumeL,
  defaultBaselineEC,
  maxECTarget
) {
  const allIssues = [];
  const allErrors = [];
  const optimizeFormula = this.optimizeFormula;

  // Find target with median N:P ratio for base optimization
  // Using median (not lowest) allows the stock to span both high-N and high-P targets
  const targetsWithNP = targets.map(t => ({
    target: t,
    npRatio: (t.ratio.N || 0) / (t.ratio.P || 0.001)
  }));
  targetsWithNP.sort((a, b) => a.npRatio - b.npRatio);
  const medianIndex = Math.floor(targetsWithNP.length / 2);
  const baseTarget = targetsWithNP[medianIndex].target;
  const lowestNP = targetsWithNP[0].npRatio;

  // Check if targets have varying P:K ratios (requires separate P and K sources)
  let hasVaryingPK = false;
  if (targets.length > 1) {
    const pkRatios = targets.map(t => {
      const p = t.ratio.P || 0.001;
      const k = t.ratio.K || 0.001;
      return k / p;
    });
    const minPK = Math.min(...pkRatios);
    const maxPK = Math.max(...pkRatios);
    // If P:K varies by more than 50%, we need separate tanks
    hasVaryingPK = maxPK / minPK > 1.5;
  }

  // Check if targets have varying N:P ratios (requires N to be decoupled from P)
  let hasVaryingNP = false;
  if (targets.length > 1) {
    const npRatios = targets.map(t => {
      const n = t.ratio.N || 0.001;
      const p = t.ratio.P || 0.001;
      return n / p;
    });
    const minNP = Math.min(...npRatios);
    const maxNP = Math.max(...npRatios);
    // If N:P varies by more than 2x, we need to decouple N from P sources
    hasVaryingNP = maxNP / minNP > 2;
  }

  // Check if targets have varying P:Mg ratios (requires Mg to be decoupled from P)
  let hasVaryingPMg = false;
  if (targets.length > 1) {
    const pmgRatios = targets.map(t => {
      const p = t.ratio.P || 0.001;
      const mg = t.ratio.Mg || 0.001;
      return p / mg;
    });
    const minPMg = Math.min(...pmgRatios);
    const maxPMg = Math.max(...pmgRatios);
    // If P:Mg varies by more than 50%, we need separate Mg control
    hasVaryingPMg = maxPMg / minPMg > 1.5;
  }

  // For 3+ tanks, apply intelligent fertilizer filtering
  let adjustedFertObjects = fertObjects;
  if (numTanks >= 3) {
    const hasSignificant = (fert, keys) => {
      const pct = fert.pct || {};
      return keys.some(key => (pct[key] || 0) > 5);
    };
    const hasAny = (fert, keys) => {
      const pct = fert.pct || {};
      return keys.some(key => (pct[key] || 0) > 0);
    };
    const hasSignificantN = fert => hasSignificant(fert, ['N_total', 'N_NO3', 'N_NH4', 'N_Urea']);
    const hasSignificantP = fert => hasSignificant(fert, ['P2O5', 'P']);
    const hasSignificantK = fert => hasSignificant(fert, ['K2O', 'K']);

    let filteredFertObjects = fertObjects;

    if (hasVaryingNP) {
      // When N:P varies widely, prefer P sources WITHOUT N (like MKP over MAP)
      // This allows N to be varied independently via Tank A (Ca-N) and Tank C (K-N)
      filteredFertObjects = filteredFertObjects.filter(f => !(hasSignificantN(f) && hasSignificantP(f)));
    }

    if (hasVaryingPK) {
      // When P:K varies, prefer P sources WITHOUT K for independent control
      filteredFertObjects = filteredFertObjects.filter(f => !(hasSignificantP(f) && hasSignificantK(f)));
    }

    const filteredHasN = filteredFertObjects.some(f => hasAny(f, ['N_total', 'N_NO3', 'N_NH4', 'N_Urea']));
    const filteredHasP = filteredFertObjects.some(f => hasAny(f, ['P2O5', 'P']));
    const filteredHasK = filteredFertObjects.some(f => hasAny(f, ['K2O', 'K']));
    const missingN = hasVaryingNP && !filteredHasN;
    const missingP = (hasVaryingNP || hasVaryingPK) && !filteredHasP;
    const missingK = hasVaryingPK && !filteredHasK;

    if (filteredFertObjects.length >= 3 && !missingN && !missingP && !missingK) {
      adjustedFertObjects = filteredFertObjects;
    } else {
      // Fallback: if filtering removes too many fertilizers or key nutrients, use original list
      adjustedFertObjects = fertObjects;
    }
  }

  // De-prioritize N sources that would go to Tank B (not calcium)
  adjustedFertObjects = adjustedFertObjects.map(f => {
    const pct = f.pct || {};
    const hasN = pct.N_total > 0 || pct.N_NO3 > 0 || pct.N_NH4 > 0 || pct.N_Urea > 0;
    const hasCa = pct.Ca > 0 || pct.CaO > 0;
    if (hasN && !hasCa && lowestNP < 1.5) {
      return { ...f, priority: Math.max(f.priority || 10, 50) };
    }
    return f;
  });

  // Run MILP optimization
  const optimResult = await optimizeFormula.call(
    this,
    baseTarget.ratio,
    1,
    adjustedFertObjects,
    150,
    'elemental',
    { useMilp: true }
  );

  if (!optimResult.formula || Object.keys(optimResult.formula).length === 0) {
    return { success: false, errors: [{ level: 'error', code: 'OPTIMIZATION_FAILED', message: 'Could not find fertilizer formula for target ratio' }] };
  }

  // Assign fertilizers to tanks based on compatibility
  const tankAssignment = this.assignToTanks(optimResult.formula, numTanks, {
    separateMg: hasVaryingPMg
  });

  // Calculate maximum safe stock concentration based on solubility limits
  // For each fertilizer, max concentration = solubility / gramsPerFinalL
  let maxSafeConcentration = stockConcentration;
  for (const [tankId, tankFormula] of Object.entries(tankAssignment)) {
    for (const [fertId, gramsPerFinalL] of Object.entries(tankFormula)) {
      if (!gramsPerFinalL || gramsPerFinalL <= 0) continue;
      const solubility = this.getSolubility(fertId);
      // Use 80% of solubility as safe limit
      const maxConc = (solubility * 0.8) / gramsPerFinalL;
      if (maxConc < maxSafeConcentration) {
        maxSafeConcentration = maxConc;
      }
    }
  }

  // Use the lower of requested and safe concentration
  const effectiveConcentration = Math.min(stockConcentration, Math.floor(maxSafeConcentration));
  if (effectiveConcentration < 10) {
    // Concentration too low to be practical
    return { success: false, errors: [{ level: 'error', code: 'CONCENTRATION_TOO_LOW', message: `Required stock concentration (${effectiveConcentration}x) is too low due to solubility limits` }] };
  }

  // Scale up to stock concentration
  const tanks = {};
  const tankNames = {
    A: 'Calcium Tank',
    B: hasVaryingPMg && numTanks >= 4 ? 'Phosphate Tank' : 'Phosphate + Mg',
    C: 'Potassium',
    D: hasVaryingPMg && numTanks >= 4 ? 'Magnesium Tank' : 'Silicate/Specialty'
  };
  const tankDescriptions = {
    A: 'Calcium-bearing fertilizers (isolated from phosphate/sulfate)',
    B: hasVaryingPMg && numTanks >= 4
      ? 'Phosphate sources (separated for P:Mg control)'
      : 'Phosphate sources and magnesium sulfate',
    C: 'Potassium sulfate and K-dominant fertilizers (allows independent P:K control)',
    D: hasVaryingPMg && numTanks >= 4
      ? 'Magnesium sources (separated for P:Mg control)'
      : 'Silicate and specialty fertilizers'
  };

  for (const [tankId, tankFormula] of Object.entries(tankAssignment)) {
    if (!tankFormula || Object.keys(tankFormula).length === 0) continue;

    tanks[tankId] = {
      id: tankId,
      name: tankNames[tankId] || `Tank ${tankId}`,
      description: tankDescriptions[tankId] || '',
      fertilizers: {},
      totalSolids_gL: 0,
      nutrientsPerML: { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 }
    };

    for (const [fertId, gramsPerFinalL] of Object.entries(tankFormula)) {
      const stock_gL = gramsPerFinalL * effectiveConcentration;
      const solubility = this.getSolubility(fertId);
      const solubility_pct = (stock_gL / solubility) * 100;

      tanks[tankId].fertilizers[fertId] = {
        grams_per_L: stock_gL,
        grams_total: stock_gL * stockTankVolumeL,
        solubility_pct
      };
      tanks[tankId].totalSolids_gL += stock_gL;

      // Calculate nutrients per mL
      const fert = this.FERTILIZERS.find(f => f.id === fertId);
      if (fert) {
        const contribPerGram = this.getElementalContributionPerGram(fert);
        for (const n of Object.keys(tanks[tankId].nutrientsPerML)) {
          tanks[tankId].nutrientsPerML[n] += contribPerGram[n] * stock_gL / 1000;
        }
      }
    }

    // Check tank feasibility (should pass now with safe concentration)
    const tankFormulaGL = {};
    for (const [fertId, data] of Object.entries(tanks[tankId].fertilizers)) {
      tankFormulaGL[fertId] = data.grams_per_L;
    }
    const feasibility = this.checkTankFeasibility(tankFormulaGL);
    allIssues.push(...feasibility.issues);
    if (!feasibility.feasible) {
      allErrors.push(...feasibility.issues.filter(i => i.level === 'error'));
    }
  }

  // Add warning if concentration was reduced
  if (effectiveConcentration < stockConcentration) {
    allIssues.push({
      level: 'warning',
      code: 'CONCENTRATION_REDUCED',
      message: `Stock concentration reduced from ${stockConcentration}x to ${effectiveConcentration}x due to solubility limits`,
      details: { requested: stockConcentration, effective: effectiveConcentration }
    });
  }

  // If solubility errors, this K is infeasible
  if (allErrors.length > 0) {
    return { success: false, tanks, errors: allErrors, warnings: allIssues.filter(i => i.level !== 'error') };
  }

  // Step 4: Calculate dosing for each target
  const dosingInstructions = [];

  // Build tank structure for dosing calculation
  const tanksForDosing = {};
  for (const [tankId, tankData] of Object.entries(tanks)) {
    tanksForDosing[tankId] = {};
    for (const [fertId, fertData] of Object.entries(tankData.fertilizers)) {
      tanksForDosing[tankId][fertId] = fertData.grams_per_L;
    }
  }

  for (const target of targets) {
    const targetBaselineEC = target.baselineEC ?? defaultBaselineEC;
    const maxDosing = target.maxDosingML ?? 50;
    const finalLiters = target.finalLiters ?? 1000;

    const dosingResult = this.solveDosing(tanksForDosing, {
      ratio: target.ratio,
      targetEC: target.targetEC,
      baselineEC: targetBaselineEC
    }, { maxDosing, tolerance: 0.15 });

    const tankDosing = {};
    for (const [tankId, mL_per_L] of Object.entries(dosingResult.dosing)) {
      tankDosing[tankId] = {
        mL_per_L,
        mL_total: mL_per_L * finalLiters
      };
    }

    const totalDosing_mL_per_L = Object.values(dosingResult.dosing).reduce((a, b) => a + b, 0);

    // Calculate ion balance for achieved PPM
    const ionBalance = this.calculateIonBalanceCore
      ? this.calculateIonBalanceCore(optimResult.formula, 1)
      : { totalCations: 0, totalAnions: 0, imbalance: 0 };

    dosingInstructions.push({
      targetId: target.id,
      targetEC: target.targetEC,
      tanks: tankDosing,
      totalDosing_mL_per_L,
      predicted: {
        nutrients: dosingResult.achieved,
        ratio: target.ratio,
        EC: dosingResult.predictedEC,
        ionBalance: {
          cations: ionBalance.totalCations,
          anions: ionBalance.totalAnions,
          imbalance: ionBalance.imbalance
        }
      },
      warnings: dosingResult.issues
    });

    allIssues.push(...dosingResult.issues);
    if (!dosingResult.feasible) {
      // This target is infeasible with current K
      allErrors.push(...dosingResult.issues.filter(i => i.level === 'error'));
    }
  }

  // If any target is infeasible, this K is infeasible
  if (allErrors.length > 0) {
    return { success: false, tanks, dosing: dosingInstructions, errors: allErrors, warnings: allIssues.filter(i => i.level !== 'error') };
  }

  return {
    success: true,
    tanks,
    dosing: dosingInstructions,
    warnings: allIssues.filter(i => i.level !== 'error'),
    errors: [],
    meta: {
      concentrationFactor: stockConcentration,
      tankVolumeL: stockTankVolumeL,
      baselineEC: defaultBaselineEC,
      mode: 'B', // Common stocks
      numTanks: Object.keys(tanks).length
    }
  };
};

/**
 * Mode A (alternative): Optimize separately for each target, then try to merge
 * @param {Object} options - Same as calculateStockSolutions
 * @returns {Promise<Object>} StockPlan
 */
window.FertilizerCore.calculateStockSolutionsModeA = async function(options) {
  const {
    targets,
    availableFertilizers,
    stockConcentration = 100,
    stockTankVolumeL = 20,
    baselineEC: defaultBaselineEC = 0
  } = options;

  // For each target, optimize independently
  const perTargetResults = [];
  const fertObjects = availableFertilizers
    .map(id => this.FERTILIZERS.find(f => f.id === id))
    .filter(Boolean);

  for (const target of targets) {
    const baselineEC = target.baselineEC ?? defaultBaselineEC;
    const effectiveEC = target.targetEC - baselineEC;

    const optimResult = await this.optimizeFormula(
      target.ratio,
      1,
      fertObjects,
      effectiveEC * 50,
      'elemental',
      { useMilp: true, targetEC: effectiveEC }
    );

    perTargetResults.push({
      target,
      formula: optimResult.formula,
      achieved: optimResult.achieved
    });
  }

  // For Mode A, we return separate stock plans per target
  const plans = [];
  for (const result of perTargetResults) {
    const tankAssignment = this.assignToTanks(result.formula, 2);
    const tanks = {};

    for (const [tankId, tankFormula] of Object.entries(tankAssignment)) {
      if (!tankFormula || Object.keys(tankFormula).length === 0) continue;

      tanks[tankId] = { id: tankId, fertilizers: {} };
      for (const [fertId, gramsPerFinalL] of Object.entries(tankFormula)) {
        const stock_gL = gramsPerFinalL * stockConcentration;
        tanks[tankId].fertilizers[fertId] = {
          grams_per_L: stock_gL,
          grams_total: stock_gL * stockTankVolumeL
        };
      }
    }

    plans.push({
      targetId: result.target.id,
      tanks,
      dosing: { A: { mL_per_L: 1000 / stockConcentration }, B: { mL_per_L: 1000 / stockConcentration } }
    });
  }

  return {
    success: true,
    mode: 'A',
    plans,
    meta: {
      concentrationFactor: stockConcentration,
      tankVolumeL: stockTankVolumeL,
      baselineEC: defaultBaselineEC
    }
  };
};

// =============================================================================
// EXPORTS SUMMARY
// =============================================================================
// Data: FERTILIZERS, OXIDE_CONVERSIONS, MOLAR_MASSES, IONIC_CHARGES, EC_CONTRIBUTIONS,
//       IONIC_MOLAR_CONDUCTIVITY, ION_CHARGES, ION_DATA, COMMON_FERTILIZERS, FERTILIZER_COMPATIBILITY,
//       DEFAULT_SOLUBILITY_GL
// Helpers: hasCaContent, hasSulfateContent, hasPhosphateContent, hasSilicateContent, hasIncompatibleFertilizers,
//          getSolubility, getCompatibilityTag, parseRatio, getElementalContributionPerGram
// EC: estimateEC, ppmToIonsForEC, estimateECFromPPM
// Ion Balance: getIonBalanceStatus, calculateIonBalanceCore
// Ratios: calculateNutrientRatios
// Optimization: solveMilpBrowser, solveNonNegativeLeastSquares, pruneSolution, optimizeFormula
// Stock Solutions: assignToTanks, checkTankFeasibility, calculateAchievedPPM, checkRatioMatch,
//                  solveDosing, calculateStockSolutions, calculateStockSolutionsModeA
//
// Copy Text Builders (in fertilizer-copy.js):
//   buildTankCopyText, buildTwoTankCopyText, buildGramsToPpmCopyText, buildFormulaCopyText, buildReverseCopyText
