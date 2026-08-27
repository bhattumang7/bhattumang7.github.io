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

globalThis.FertilizerCore = globalThis.FertilizerCore || {};

// =============================================================================
// CACHED HIGHS SOLVER INSTANCE
// =============================================================================
// Cache the HiGHS solver instance to avoid re-downloading the WASM file on every calculation
let _cachedHighsInstance = null;
let _highsLoadingPromise = null;

// Determine base path for a HiGHS WASM asset - handle both file:// and http(s):// protocols.
// Exposed on the namespace (rather than kept as a closure) so it's directly unit-testable
// without needing a real fallback file on disk to exercise it through an actual solver load.
globalThis.FertilizerCore._getWasmPath = function(filename) {
  // Try to find the highs.js script and get its directory
  const scripts = document.getElementsByTagName('script');
  for (const script of scripts) {
    if (script.src?.includes('highs.js')) {
      return script.src.replace('highs.js', filename);
    }
  }
  // Fallback to absolute path for web server
  return `/assets/vendor/highs/${filename}`;
};

/**
 * Get or initialize the HiGHS solver instance (with caching)
 * @param {Function} onProgress - Optional callback for progress updates: (status: string) => void
 * @returns {Promise<Object>} The HiGHS solver instance
 */
globalThis.FertilizerCore.getHighsInstance = async function(onProgress) {
  // Return cached instance if available
  if (_cachedHighsInstance) {
    return _cachedHighsInstance;
  }

  // If already loading, wait for that promise
  if (_highsLoadingPromise) {
    return _highsLoadingPromise;
  }

  // Start loading
  const highsFactory = globalThis.highs || globalThis.Module;
  if (typeof highsFactory !== 'function') {
    throw new TypeError('HiGHS solver not available');
  }

  // Notify that we're downloading the solver
  if (onProgress) {
    onProgress('downloading');
  }

  _highsLoadingPromise = highsFactory({
    locateFile: (f) => globalThis.FertilizerCore._getWasmPath(f)
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
globalThis.FertilizerCore.isHighsLoaded = function() {
  return _cachedHighsInstance !== null;
};

/**
 * Pre-load the HiGHS solver in the background
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {Promise<void>}
 */
globalThis.FertilizerCore.preloadHighsSolver = async function(onProgress) {
  if (_cachedHighsInstance || _highsLoadingPromise) {
    return; // Already loaded or loading
  }
  try {
    await globalThis.FertilizerCore.getHighsInstance(onProgress);
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
globalThis.FertilizerCore.hasCaContent = function(fertId) {
  const fert = globalThis.FertilizerCore.FERTILIZERS.find(f => f.id === fertId);
  return fert?.pct?.Ca > 0;
};

// Check if a fertilizer contains sulfate
globalThis.FertilizerCore.hasSulfateContent = function(fertId) {
  const fert = globalThis.FertilizerCore.FERTILIZERS.find(f => f.id === fertId);
  return fert?.pct?.S > 0;
};

// Check if a fertilizer contains phosphate
globalThis.FertilizerCore.hasPhosphateContent = function(fertId) {
  const fert = globalThis.FertilizerCore.FERTILIZERS.find(f => f.id === fertId);
  return fert?.pct && (fert.pct.P2O5 > 0 || fert.pct.P > 0);
};

// Check if a fertilizer contains silicate
globalThis.FertilizerCore.hasSilicateContent = function(fertId) {
  const fert = globalThis.FertilizerCore.FERTILIZERS.find(f => f.id === fertId);
  return fert?.pct && (fert.pct.SiO2 > 0 || fert.pct.SiOH4 > 0 || fert.pct.Si > 0);
};

// Check if a formula contains incompatible fertilizers
globalThis.FertilizerCore.hasIncompatibleFertilizers = function(formula) {
  const activeFertIds = Object.entries(formula)
    .filter(([, grams]) => grams > 0)
    .map(([id]) => id);

  if (activeFertIds.length < 2) return false;

  let hasCalcium = false;
  let hasSulfate = false;
  let hasPhosphate = false;
  let hasSilicate = false;

  activeFertIds.forEach(fertId => {
    if (globalThis.FertilizerCore.hasCaContent(fertId)) hasCalcium = true;
    if (globalThis.FertilizerCore.hasSulfateContent(fertId)) hasSulfate = true;
    if (globalThis.FertilizerCore.hasPhosphateContent(fertId)) hasPhosphate = true;
    if (globalThis.FertilizerCore.hasSilicateContent(fertId)) hasSilicate = true;
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
globalThis.FertilizerCore.estimateEC = function(ions_mmolL, options = {}) {
  const {
    temperatureC = 25,
    applyIonicStrengthCorrection = true,
    ionicStrengthK = 0.5
  } = options;

  const IONIC_MOLAR_CONDUCTIVITY = globalThis.FertilizerCore.IONIC_MOLAR_CONDUCTIVITY;
  const ION_CHARGES = globalThis.FertilizerCore.ION_CHARGES;

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
globalThis.FertilizerCore.EC_ION_MOLAR_MASSES = {
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
globalThis.FertilizerCore.PPM_TO_ION_MAPPINGS = [
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
globalThis.FertilizerCore.ppmToIonsForEC = function(ppmResults) {
  const ions_mmolL = {};
  const MOLAR_MASSES = globalThis.FertilizerCore.EC_ION_MOLAR_MASSES;
  const mappings = globalThis.FertilizerCore.PPM_TO_ION_MAPPINGS;

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
globalThis.FertilizerCore.ppmToIonsWithDetails = function(ppmResults) {
  const ionsData = {};
  const MOLAR_MASSES = globalThis.FertilizerCore.EC_ION_MOLAR_MASSES;
  const mappings = globalThis.FertilizerCore.PPM_TO_ION_MAPPINGS;

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
globalThis.FertilizerCore.estimateECFromPPM = function(ppmResults, options = {}) {
  const ions_mmolL = globalThis.FertilizerCore.ppmToIonsForEC(ppmResults);
  const ionsDetails = globalThis.FertilizerCore.ppmToIonsWithDetails(ppmResults);
  const result = globalThis.FertilizerCore.estimateEC(ions_mmolL, options);

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
globalThis.FertilizerCore.getIonBalanceStatus = function(imbalance) {
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
globalThis.FertilizerCore.calculateIonBalanceCore = function(fertilizers, volume, options = {}) {
  const { includeBreakdown = false } = options;
  const FERTILIZERS = globalThis.FertilizerCore.FERTILIZERS;
  const ION_DATA = globalThis.FertilizerCore.ION_DATA;

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
  const { statusColor, statusLevel } = globalThis.FertilizerCore.getIonBalanceStatus(imbalance);

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
function getRatio(values, names, decimals = 2) {
  const nonZeroValues = values.filter(v => v > 0);
  if (nonZeroValues.length === 0) return null;

  const minValue = Math.min(...nonZeroValues);
  const ratioValues = values.map(v => v > 0 ? Number.parseFloat((v / minValue).toFixed(decimals)) : 0);

  return {
    name: names.join(' : '),
    ratio: ratioValues.join(' : '),
    values: values,
    labels: names
  };
}

function _pushRatioIfApplicable(ratios, condition, values, labels) {
  if (!condition) return;
  const r = getRatio(values, labels);
  if (r) ratios.push(r);
}

// K:Ca:Mg expressed on a meq/L (charge-equivalent) basis rather than mass basis.
function _pushKCaMgMeqRatio(ratios, results) {
  if (!((results.K || 0) > 0 && (results.Ca || 0) > 0 && (results.Mg || 0) > 0)) return;

  // K/Ca/Mg are all guaranteed truthy positive numbers by the guard above.
  const kMeq = results.K / 39.1;
  const caMeq = results.Ca * 2 / 40.08;
  const mgMeq = results.Mg * 2 / 24.31;

  const kcamgMeq = getRatio([kMeq, caMeq, mgMeq], ['K', 'Ca', 'Mg']);
  if (kcamgMeq) {
    kcamgMeq.name = 'K : Ca : Mg (meq/L basis)';
    kcamgMeq.values = [kMeq, caMeq, mgMeq];
    kcamgMeq.unit = 'meq/L';
    ratios.push(kcamgMeq);
  }
}

globalThis.FertilizerCore.calculateNutrientRatios = function(results) {
  const ratios = [];

  // N:P:K (elemental)
  const npk = getRatio([results.N_total || 0, results.P || 0, results.K || 0], ['N', 'P', 'K']);
  if (npk) ratios.push(npk);

  // N:P2O5:K2O (oxide form)
  const npkOxide = getRatio([results.N_total || 0, results.P2O5 || 0, results.K2O || 0], ['N', 'P₂O₅', 'K₂O']);
  if (npkOxide) ratios.push(npkOxide);

  _pushRatioIfApplicable(ratios, (results.N_total || 0) > 0 && (results.K || 0) > 0,
    [results.N_total || 0, results.K || 0], ['N', 'K']);
  _pushRatioIfApplicable(ratios, (results.N_NO3 || 0) > 0 || (results.N_NH4 || 0) > 0,
    [results.N_NO3 || 0, results.N_NH4 || 0], ['NO₃', 'NH₄']);
  _pushRatioIfApplicable(ratios, (results.Ca || 0) > 0 && (results.Mg || 0) > 0,
    [results.Ca || 0, results.Mg || 0], ['Ca', 'Mg']);
  _pushRatioIfApplicable(ratios, (results.K || 0) > 0 && (results.Ca || 0) > 0,
    [results.K || 0, results.Ca || 0], ['K', 'Ca']);

  _pushKCaMgMeqRatio(ratios, results);

  return ratios;
};

// =============================================================================
// OPTIMIZATION ALGORITHMS
// =============================================================================

// Per-1-gram nutrient contribution in the LP model's own units (N_total, oxide P2O5/K2O, plus
// Si) - a different shape than getElementalContributionPerGram (elemental only, no Si), used
// only to build the MILP's per-fertilizer coefficients.
// Dispatch table mirroring ACHIEVED_PPM_HANDLERS's classification rules, but for the LP
// model's own per-gram coefficient shape (N_total/oxide P2O5,K2O only, no separate P/K/NO3/NH4).
const MILP_PER_GRAM_HANDLERS = {
  N_NO3: (c, ppm) => { c.N_total += ppm; },
  N_NH4: (c, ppm) => { c.N_total += ppm; },
  N_Urea: (c, ppm) => { c.N_total += ppm; },
  N_total: (c, ppm, ctx) => { if (!ctx.hasNForms) c.N_total += ppm; },
  P2O5: (c, ppm) => { c.P2O5 += ppm; },
  P: (c, ppm, ctx) => { c.P2O5 += ppm * ctx.P_to_P2O5; },
  K2O: (c, ppm) => { c.K2O += ppm; },
  K: (c, ppm, ctx) => { c.K2O += ppm * ctx.K_to_K2O; },
  Ca: (c, ppm) => { c.Ca += ppm; },
  CaO: (c, ppm, ctx) => { c.Ca += ppm * ctx.OXIDE_CONVERSIONS.CaO_to_Ca; },
  Mg: (c, ppm) => { c.Mg += ppm; },
  MgO: (c, ppm, ctx) => { c.Mg += ppm * ctx.OXIDE_CONVERSIONS.MgO_to_Mg; },
  S: (c, ppm) => { c.S += ppm; },
  SO3: (c, ppm, ctx) => { c.S += ppm * ctx.OXIDE_CONVERSIONS.SO3_to_S; },
  SiO2: (c, ppm) => { c.Si += ppm * 0.46744; },
  SiOH4: (c, ppm) => { c.Si += ppm * 0.2922; },
  Si: (c, ppm) => { c.Si += ppm; }
};

function _milpPerGramContrib(fert, volume, OXIDE_CONVERSIONS, P_to_P2O5, K_to_K2O) {
  const c = { N_total: 0, P2O5: 0, K2O: 0, Ca: 0, Mg: 0, S: 0, Si: 0 };
  const ctx = { OXIDE_CONVERSIONS, P_to_P2O5, K_to_K2O, hasNForms: Boolean(fert.pct.N_NO3 || fert.pct.N_NH4 || fert.pct.N_Urea) };
  Object.entries(fert.pct).forEach(([nutrient, pct]) => {
    const ppm = (1 * 1000 * (pct / 100)) / volume;
    const handler = MILP_PER_GRAM_HANDLERS[nutrient];
    if (handler) handler(c, ppm, ctx);
  });
  return c;
}

/**
 * MILP solver helper using highs.js + lp-model
 * @param {Object} params - {fertilizers, targets, volume, tolerance, onProgress, pekacidMaxLimit}
 * @param {Function} params.onProgress - Optional callback for progress updates: (status: string) => void
 * @param {number} params.pekacidMaxLimit - Optional max limit for PeKacid in g/L (0 = no limit)
 * @returns {Object} {formula, achieved}
 */
globalThis.FertilizerCore.solveMilpBrowser = async function({ fertilizers, targets, volume, tolerance = 0.01, onProgress, pekacidMaxLimit = 0, nh4PctTarget = null }) {
  // Helper to log to both console and UI dev logs
  // Queue logs if addDevLog isn't ready yet, flush when it becomes available
  const devLog = (msg, type = 'info') => {
    const logMsg = `[MILP] ${msg}`;
    console.log(logMsg);
    if (globalThis.addDevLog) {
      globalThis.addDevLog(msg, type);
    } else {
      // Queue for later
      globalThis._pendingDevLogs = globalThis._pendingDevLogs || [];
      globalThis._pendingDevLogs.push({ msg, type });
    }
  };

  // Flush any pending logs if addDevLog is now available
  if (globalThis.addDevLog && globalThis._pendingDevLogs && globalThis._pendingDevLogs.length > 0) {
    globalThis._pendingDevLogs.forEach(log => globalThis.addDevLog(log.msg, log.type));
    globalThis._pendingDevLogs = [];
  }

  // Helper to get short fertilizer name (first part before parenthesis or dash)
  const shortName = (fert) => {
    const name = fert.name || fert.id;
    // Try to get a short version: before " - " or before " ("
    let short = name.split(' - ')[0].split(' (')[0];
    // Limit to ~20 chars
    if (short.length > 22) short = short.substring(0, 20) + '..';
    return short;
  };

  // Log setup info
  devLog(`=== MILP Solver Started ===`);
  devLog(`Volume: ${volume}L`);

  // Log selected fertilizers (short names)
  const fertNames = fertilizers.map(f => shortName(f)).join(', ');
  devLog(`Fertilizers (${fertilizers.length}): ${fertNames}`);

  // Log target ratios
  const targetStr = Object.entries(targets)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k.replace('_total', '')}:${v.toFixed(1)}`)
    .join(' ');
  devLog(`Targets: ${targetStr}`);

  // Log PeKacid limit
  if (pekacidMaxLimit > 0) {
    devLog(`PeKacid cap: ${pekacidMaxLimit} g/L (max ${(pekacidMaxLimit * volume).toFixed(2)}g)`);
  } else {
    devLog(`PeKacid cap: none`);
  }

  if (!globalThis.LPModel) {
    throw new Error('MILP dependencies not loaded');
  }

  const { Model } = globalThis.LPModel;
  const OXIDE_CONVERSIONS = globalThis.FertilizerCore.OXIDE_CONVERSIONS;
  const P_to_P2O5 = 1 / OXIDE_CONVERSIONS.P2O5_to_P;
  const K_to_K2O = 1 / OXIDE_CONVERSIONS.K2O_to_K;

  // Use cached HiGHS instance (downloads WASM only on first call)
  const highs = await globalThis.FertilizerCore.getHighsInstance(onProgress);

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
  // Shared upper bound on each targeted nutrient's *relative* slack (see constraints below).
  // Minimizing this instead of a weighted sum of the individual slacks is what actually
  // spreads an unavoidable ratio mismatch across nutrients: a linear objective on a plain
  // weighted sum of slacks is minimized at a vertex of the feasible region, which structurally
  // means it concentrates all the error on as few nutrients as possible (verified directly —
  // with 4 fertilizers unable to hit a 5-nutrient ratio exactly, a weighted-sum objective left
  // N off by 36% while Ca/P/K/Mg matched exactly, rather than spreading a smaller error across
  // all five). Minimizing the shared max instead pushes every targeted nutrient's error down
  // toward the same relative bound before any single one is allowed to grow further.
  const maxRelError = model.addVar({ lb: 0, ub: '+infinity', vtype: 'CONTINUOUS', name: 'max_rel_error' });

  const BIG_M = 10000;
  const PEKACID_ID = 'icl_pekacid_pk_acid';
  fertilizers.forEach(f => {
    model.addConstr([[1, x[f.id]], [-BIG_M, y[f.id]]], '<=', 0);
  });

  // Add PeKacid limit constraint if specified (and > 0): a max constraint AND a minimum
  // incentive via slack variable. Returns { pekacidSlack, pekacidTargetGrams }.
  function addPekacidConstraint() {
    const hasPekacid = x[PEKACID_ID] !== undefined;
    devLog(`PeKacid in fertilizers: ${hasPekacid}, limit > 0: ${pekacidMaxLimit > 0}`);
    if (!(pekacidMaxLimit > 0 && hasPekacid)) {
      if (!hasPekacid && pekacidMaxLimit > 0) {
        devLog('WARNING: PeKacid limit set but PeKacid not in selected fertilizers!', 'warn');
      }
      return { pekacidSlack: null, pekacidTargetGrams: 0 };
    }

    const pekacidTargetGrams = pekacidMaxLimit * volume;
    devLog(`Adding PeKacid constraints: maxGrams = ${pekacidTargetGrams}g`);
    // Maximum constraint - PeKacid can be used up to the limit
    // The low priority coefficient (0.01) in the objective encourages using it first
    // but allows the solver to use less if needed for better ratio matching
    model.addConstr([[1, x[PEKACID_ID]]], '<=', pekacidTargetGrams);
    // Slack variable to encourage filling PeKacid up to the cap.
    // x + slack = target, minimize slack to push x toward the cap when feasible.
    const pekacidSlack = model.addVar({ lb: 0, ub: '+infinity', vtype: 'CONTINUOUS', name: 's_pekacid' });
    model.addConstr([[1, x[PEKACID_ID]], [1, pekacidSlack]], '=', pekacidTargetGrams);
    devLog('PeKacid capped at maximum (can use less if needed for ratios)');
    return { pekacidSlack, pekacidTargetGrams };
  }
  const { pekacidSlack, pekacidTargetGrams } = addPekacidConstraint();

  // If nh4PctTarget is set (0-100), add a soft constraint: Sum((nh4_i - tau*ntotal_i)*x_i) ~ 0,
  // implemented as slack variables with a high penalty so the solver tries hard but won't
  // become infeasible. Returns { sNH4Plus, sNH4Minus } (both null if it doesn't apply).
  function addNh4FractionConstraint() {
    const hasNH4Target = typeof nh4PctTarget === 'number' && nh4PctTarget >= 0 && nh4PctTarget <= 100
      && (targets.N_total || 0) > 0;
    if (!hasNH4Target) return { sNH4Plus: null, sNH4Minus: null };

    devLog(`NH4 fraction target: ${nh4PctTarget}% of total N`);
    const tau = nh4PctTarget / 100;
    const sNH4Plus  = model.addVar({ lb: 0, ub: '+infinity', vtype: 'CONTINUOUS', name: 's_nh4_plus' });
    const sNH4Minus = model.addVar({ lb: 0, ub: '+infinity', vtype: 'CONTINUOUS', name: 's_nh4_minus' });
    const nh4Terms = [];
    fertilizers.forEach(f => {
      const hasNForms = f.pct.N_NO3 || f.pct.N_NH4;
      const nh4PerGram = ((f.pct.N_NH4 || 0) / 100 * 1000) / volume;
      const ntPerGram = hasNForms
        ? (((f.pct.N_NO3 || 0) + (f.pct.N_NH4 || 0) + (f.pct.N_Urea || 0)) / 100 * 1000) / volume
        : ((f.pct.N_total || 0) / 100 * 1000) / volume;
      const coeff = nh4PerGram - tau * ntPerGram;
      if (Math.abs(coeff) > 1e-9) {
        nh4Terms.push([coeff, x[f.id]]);
      }
    });
    if (nh4Terms.length > 0) {
      model.addConstr([...nh4Terms, [-1, sNH4Plus], [1, sNH4Minus]], '=', 0);
    }
    return { sNH4Plus, sNH4Minus };
  }
  const { sNH4Plus, sNH4Minus } = addNh4FractionConstraint();
  const hasNH4Target = sNH4Plus !== null;

  const perGramContrib = (fert) => _milpPerGramContrib(fert, volume, OXIDE_CONVERSIONS, P_to_P2O5, K_to_K2O);

  nutrients.forEach(n => {
    const terms = [];
    fertilizers.forEach(f => {
      const c = perGramContrib(f);
      if (c[n] !== 0) terms.push([c[n], x[f.id]]);
    });
    if (tMinus[n] > 0) {
      // Note: +1 (not -1) so slackMinus RELAXES the floor (sum + slack >= tMinus allows
      // sum to fall short of tMinus by up to slack, penalized in the objective below).
      // A -1 here would make slack tighten the floor instead of relaxing it, effectively
      // making the "tolerance" band unrelaxable on the low side while the upper bound
      // (slackPlus below) stayed genuinely soft — letting the solver dump all
      // infeasibility into unbounded overshoot on whichever nutrient was cheapest.
      model.addConstr([...terms, [1, slackMinus[n]]], '>=', tMinus[n]);
    }
    const ub = Math.max(tPlus[n], 0);
    model.addConstr([...terms, [-1, slackPlus[n]]], '<=', ub);

    // Tie this nutrient's relative slack to the shared maxRelError (Si excluded: it keeps its
    // own much larger fixed penalty below rather than competing in the ratio-fairness minimax,
    // since it's an absolute PPM target, not a ratio component).
    if (n !== 'Si' && targets[n] > 0) {
      model.addConstr([[1, slackPlus[n]], [-targets[n], maxRelError]], '<=', 0);
      model.addConstr([[1, slackMinus[n]], [-targets[n], maxRelError]], '<=', 0);
    }
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

  // Reference scale for the untargeted-nutrient ceiling penalty below: the largest active
  // target ppm. Ties that penalty to the same order of magnitude as the (now per-nutrient
  // normalized) targeted penalties, so it discourages a fertilizer's unwanted byproduct
  // nutrients (e.g. sulfate riding along with Mg) without being so disproportionate that the
  // solver drops a nutrient's fertilizer source entirely just to dodge it (measured directly:
  // with a flat 50 here it did, once the targeted penalties below stopped being flat too).
  const maxActiveTarget = Math.max(...nutrients.map(n => targets[n] || 0).filter(v => v > 0), 1);

  nutrients.forEach(n => {
    const isTargeted = (targets[n] || 0) > 0;
    // Si gets much higher penalty because it's an absolute PPM target (not ratio-normalized)
    // and Potassium Silicate also contributes K2O, so solver may under-use it otherwise
    // Using 10000 to strongly prioritize Si over ratio precision
    //
    // For every other targeted nutrient, the penalty coefficient is normalized by the
    // nutrient's own target (100 / target) rather than a flat 100. A flat coefficient prices
    // 1ppm of slack the same on every nutrient regardless of scale, so the LP's cheapest way
    // to absorb infeasibility is to dump it all onto whichever nutrient has the largest target
    // ppm (e.g. Ca at 600ppm) rather than spreading it proportionally. Normalizing means 1% of
    // target costs the same objective penalty on every nutrient.
    //
    // For non-Si targeted nutrients this is now a small TIE-BREAKER only (1/target, two orders
    // of magnitude below the maxRelError term below) — the maxRelError constraints above already
    // do the real work of spreading an unavoidable mismatch evenly; this term just picks, among
    // solutions that tie on maxRelError, the one with less total slack overall.
    let slackPenalty;
    if (!isTargeted) {
      slackPenalty = 50 / maxActiveTarget;
    } else if (n === 'Si') {
      slackPenalty = 10000;
    } else {
      slackPenalty = 1 / targets[n];
    }
    objective.push([slackPenalty, slackPlus[n]], [slackPenalty, slackMinus[n]]);
  });
  // Minimize the worst relative deviation any targeted nutrient has from its target. Weighted
  // well above the per-nutrient tie-breaker and untargeted-ceiling terms above (so ratio-fairness
  // dominates those), but below the explicit Si/PeKacid absolute-priority overrides (10000) —
  // this preserves the pre-existing intent that filling a PeKacid limit, or hitting an absolute
  // Si target, matters more than nutrient-ratio precision.
  objective.push([1000, maxRelError]);
  // NH4 fraction slack penalty — higher than nutrient slack (100) but lower than PeKacid (10000)
  if (hasNH4Target && sNH4Plus && sNH4Minus) {
    objective.push([500, sNH4Plus], [500, sNH4Minus]);
  }

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

  // Log PeKacid result if it was constrained
  if (pekacidTargetGrams > 0) {
    const pekacidGrams = formula[PEKACID_ID] || 0;
    const pekacidGPerL = pekacidGrams / volume;
    devLog(`RESULT: PeKacid = ${pekacidGrams.toFixed(3)}g (${pekacidGPerL.toFixed(4)} g/L), max allowed was ${pekacidTargetGrams}g (${pekacidMaxLimit} g/L)`);
    const percentUsed = (pekacidGrams/pekacidTargetGrams*100).toFixed(1);
    devLog(`PeKacid used ${percentUsed}% of maximum allowed (${pekacidGrams.toFixed(3)}g / ${pekacidTargetGrams}g)`);
  }

  const achieved = globalThis.FertilizerCore.accumulateAchievedPPM(fertilizers, formula, volume);

  return { formula, achieved };
};

function _buildPpmTargetsFromAbsoluteTargets(targetRatios, mode, P_to_P2O5, K_to_K2O) {
  return {
    N_total: targetRatios.N || 0,
    P2O5: mode === 'elemental' ? (targetRatios.P || 0) * P_to_P2O5 : (targetRatios.P || 0),
    K2O: mode === 'elemental' ? (targetRatios.K || 0) * K_to_K2O : (targetRatios.K || 0),
    Ca: targetRatios.Ca || 0,
    Mg: targetRatios.Mg || 0,
    S: targetRatios.S || 0,
    Si: targetRatios.Si || 0
  };
}

function _buildPpmTargetsFromNormalizedRatio(targetRatios, mode, concentration, P_to_P2O5, K_to_K2O) {
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

  return {
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

// Scale `formula` proportionally (up to 5 iterations) until its achieved EC is within 1% of
// ctx.targetEC, starting from startScaleFactor.
function _rescaleFormulaToTargetEC(ctx, formula, startScaleFactor) {
  const { availableFertilizers, volume, estimateECFromPPM, targetEC } = ctx;
  let scale = startScaleFactor;
  let scaledFormulaOut = {};
  let scaledAchievedOut = {};
  let ec = 0;
  for (let i = 0; i < 5; i++) {
    scaledFormulaOut = {};
    Object.entries(formula).forEach(([fertId, grams]) => {
      scaledFormulaOut[fertId] = grams * scale;
    });
    scaledAchievedOut = globalThis.FertilizerCore.accumulateAchievedPPM(availableFertilizers, scaledFormulaOut, volume);
    ec = estimateECFromPPM(scaledAchievedOut).ec_mS_cm;
    const error = Math.abs(ec - targetEC) / targetEC;
    if (error < 0.01) break;
    scale = scale * (targetEC / ec);
  }
  return { formula: scaledFormulaOut, achieved: scaledAchievedOut, ec, scaleFactor: scale };
}

// Special handling: when PeKacid is fixed at cap, solve ratios for other fertilizers at the
// target EC so total ratios stay aligned (PeKacid adds P/K but no N/Ca/Mg). Returns the final
// result object if this path applies, or null to fall through to the general EC-scaling
// approach (mirrors the original "if (pekacidFert)" guard: every branch that finds a PeKacid
// fertilizer always returned something).
async function _trySolveWithFixedPekacidRatios(ctx) {
  const {
    availableFertilizers, PEKACID_ID, fixedPekacidGrams, volume, targetRatios, milpResult,
    ppmTargets, concentration, solveMilpBrowser, onProgress, estimateECFromPPM, targetEC,
    mode, P_to_P2O5, K_to_K2O, originalEC, OXIDE_CONVERSIONS
  } = ctx;

  const pekacidFert = availableFertilizers.find(f => f.id === PEKACID_ID);
  if (!pekacidFert) return null;

  const pekacidP2O5_ppm = (fixedPekacidGrams * 1000 * (pekacidFert.pct.P2O5 || 0) / 100) / volume;
  const pekacidK2O_ppm = (fixedPekacidGrams * 1000 * (pekacidFert.pct.K2O || 0) / 100) / volume;
  const pekacidP_ppm = pekacidP2O5_ppm * OXIDE_CONVERSIONS.P2O5_to_P;
  const pekacidK_ppm = pekacidK2O_ppm * OXIDE_CONVERSIONS.K2O_to_K;

  const ratioValues = [
    targetRatios.N,
    targetRatios.P,
    targetRatios.K,
    targetRatios.Ca,
    targetRatios.Mg,
    targetRatios.S
  ].filter(v => v > 0);
  if (ratioValues.length === 0) {
    return { formula: milpResult.formula, achieved: milpResult.achieved, targetRatios, targetPPM: ppmTargets };
  }
  const minRatio = Math.min(...ratioValues);
  const normalizedRatios = {
    N: targetRatios.N / minRatio,
    P: targetRatios.P / minRatio,
    K: targetRatios.K / minRatio,
    Ca: targetRatios.Ca / minRatio,
    Mg: targetRatios.Mg / minRatio,
    S: targetRatios.S / minRatio
  };

  const fertilizersWithoutPekacid = availableFertilizers.filter(f => f.id !== PEKACID_ID);
  const targetSi = targetRatios.Si || 0;

  const solveForScale = async (scale) => {
    const targets = {
      N_total: normalizedRatios.N * scale,
      P2O5: mode === 'elemental' ? normalizedRatios.P * scale * P_to_P2O5 : normalizedRatios.P * scale,
      K2O: mode === 'elemental' ? normalizedRatios.K * scale * K_to_K2O : normalizedRatios.K * scale,
      Ca: normalizedRatios.Ca * scale,
      Mg: normalizedRatios.Mg * scale,
      S: normalizedRatios.S * scale,
      Si: targetSi
    };

    targets.P2O5 = Math.max(0, (targets.P2O5 || 0) - pekacidP2O5_ppm);
    targets.K2O = Math.max(0, (targets.K2O || 0) - pekacidK2O_ppm);

    const result = await solveMilpBrowser({
      fertilizers: fertilizersWithoutPekacid,
      targets,
      volume,
      tolerance: 0.01,
      onProgress,
      pekacidMaxLimit: 0
    });

    result.formula[PEKACID_ID] = fixedPekacidGrams;
    result.achieved.P2O5 += pekacidP2O5_ppm;
    result.achieved.P += pekacidP_ppm;
    result.achieved.K2O += pekacidK2O_ppm;
    result.achieved.K += pekacidK_ppm;

    const ecData = estimateECFromPPM(result.achieved);
    return { result, ec: ecData.ec_mS_cm };
  };

  let lowScale = 1;
  let highScale = Math.max(concentration, 10);
  let lowData = await solveForScale(lowScale);
  let highData = await solveForScale(highScale);

  for (let i = 0; i < 6 && highData.ec < targetEC; i++) {
    lowScale = highScale;
    lowData = highData;
    highScale *= 2;
    highData = await solveForScale(highScale);
  }

  let best = lowData;
  if (Math.abs(highData.ec - targetEC) < Math.abs(best.ec - targetEC)) {
    best = highData;
  }

  for (let i = 0; i < 8 && lowData.ec < targetEC && highData.ec > targetEC; i++) {
    const midScale = (lowScale + highScale) / 2;
    const midData = await solveForScale(midScale);
    if (Math.abs(midData.ec - targetEC) < Math.abs(best.ec - targetEC)) {
      best = midData;
    }
    if (midData.ec >= targetEC) {
      highScale = midScale;
      highData = midData;
    } else {
      lowScale = midScale;
      lowData = midData;
    }
  }

  return {
    formula: best.result.formula,
    achieved: best.result.achieved,
    targetRatios,
    targetPPM: ppmTargets,
    ecScaling: { scaleFactor: 1, originalEC: originalEC.ec_mS_cm, targetEC, achievedEC: best.ec },
    pekacidFixed: true
  };
}

// If EC scaling would reduce PeKacid below its cap, fix it at cap and re-run the MILP for the
// other fertilizers so acidification stays maximized. Returns updated
// { milpResult, originalEC, scaleFactor, fixedPekacidGrams }, or null if it doesn't apply.
async function _rerunKeepingPekacidAtCapIfScalingWouldDropIt(ctx) {
  const {
    pekacidMaxLimit, pekacidFromMilp, scaleFactor, pekacidMaxGrams, availableFertilizers,
    PEKACID_ID, OXIDE_CONVERSIONS, volume, estimateECFromPPM, targetEC, ppmTargets,
    solveMilpBrowser, onProgress, devLog
  } = ctx;

  const enablePekacidRerun = true;
  if (!(enablePekacidRerun && pekacidMaxLimit > 0 && pekacidFromMilp > 0 && scaleFactor < 0.99)) return null;

  const scaledPekacid = pekacidFromMilp * scaleFactor;
  if (scaledPekacid >= pekacidMaxGrams * 0.95) return null;

  devLog(`EC scaling would reduce PeKacid from ${pekacidFromMilp.toFixed(3)}g to ${scaledPekacid.toFixed(3)}g (cap is ${pekacidMaxGrams.toFixed(3)}g)`);
  devLog(`Re-running MILP with PeKacid fixed at cap (${pekacidMaxGrams.toFixed(3)}g) to maintain acidification`);

  const pekacidFert = availableFertilizers.find(f => f.id === PEKACID_ID);
  if (!pekacidFert) return null;

  // Calculate PeKacid's contribution to nutrients
  const pekacidP2O5_ppm = (pekacidMaxGrams * 1000 * (pekacidFert.pct.P2O5 || 0) / 100) / volume;
  const pekacidK2O_ppm = (pekacidMaxGrams * 1000 * (pekacidFert.pct.K2O || 0) / 100) / volume;
  const pekacidP_ppm = pekacidP2O5_ppm * OXIDE_CONVERSIONS.P2O5_to_P;
  const pekacidK_ppm = pekacidK2O_ppm * OXIDE_CONVERSIONS.K2O_to_K;

  // Calculate PeKacid's EC contribution
  const pekacidNutrients = { N_total: 0, P: pekacidP_ppm, K: pekacidK_ppm, Ca: 0, Mg: 0, S: 0 };
  const pekacidEC = estimateECFromPPM(pekacidNutrients);
  const pekacidECContrib = pekacidEC ? pekacidEC.ec_mS_cm : 0;

  // Remaining EC budget for other fertilizers
  const remainingEC = targetEC - pekacidECContrib;
  devLog(`PeKacid EC contribution: ${pekacidECContrib.toFixed(2)} mS/cm, remaining EC budget: ${remainingEC.toFixed(2)} mS/cm`);

  // Subtract PeKacid's P and K contributions from targets
  // Keep N, Ca, Mg, S at original levels (PeKacid doesn't provide these)
  // This maintains the correct N:Ca:Mg ratios while accounting for PeKacid's P and K
  const adjustedTargets = { ...ppmTargets };
  adjustedTargets.P2O5 = Math.max(0, (ppmTargets.P2O5 || 0) - pekacidP2O5_ppm);
  adjustedTargets.K2O = Math.max(0, (ppmTargets.K2O || 0) - pekacidK2O_ppm);

  devLog(`Adjusted targets for other fertilizers (PeKacid P/K subtracted): N:${(adjustedTargets.N_total || 0).toFixed(1)} P2O5:${adjustedTargets.P2O5.toFixed(1)} K2O:${adjustedTargets.K2O.toFixed(1)}`);

  // Re-run MILP without PeKacid, using adjusted targets
  const fertilizersWithoutPekacid = availableFertilizers.filter(f => f.id !== PEKACID_ID);
  const rerunResult = await solveMilpBrowser({
    fertilizers: fertilizersWithoutPekacid,
    targets: adjustedTargets,
    volume,
    tolerance: 0.01,
    onProgress,
    pekacidMaxLimit: 0
  });

  devLog(`Re-run MILP complete. Keeping ratios intact (not scaling for EC).`);

  // Now add PeKacid back at cap
  rerunResult.formula[PEKACID_ID] = pekacidMaxGrams;

  // Add PeKacid's contribution to achieved
  rerunResult.achieved.P2O5 += pekacidP2O5_ppm;
  rerunResult.achieved.P += pekacidP_ppm;
  rerunResult.achieved.K2O += pekacidK2O_ppm;
  rerunResult.achieved.K += pekacidK_ppm;

  devLog(`Re-run complete with PeKacid fixed at ${pekacidMaxGrams.toFixed(3)}g`);

  // Calculate final EC
  const rerunEC = estimateECFromPPM(rerunResult.achieved);
  devLog(`Final EC with PeKacid at cap (maintaining ratios): ${rerunEC.ec_mS_cm.toFixed(2)} mS/cm (target was: ${targetEC.toFixed(2)})`);

  // Continue scaling with PeKacid fixed at cap to match target EC as closely as possible.
  return {
    milpResult: rerunResult,
    originalEC: rerunEC,
    scaleFactor: targetEC / rerunEC.ec_mS_cm,
    fixedPekacidGrams: pekacidMaxGrams
  };
}

// Iterate up to 5 times to converge on target EC. Returns { scaledFormula, scaledAchieved, finalEC, scaleFactor }.
function _convergeEcScaling(ctx) {
  const {
    milpResult, shouldFixPekacid, PEKACID_ID, fixedPekacidGrams, availableFertilizers, volume,
    estimateECFromPPM, targetEC
  } = ctx;
  let scaleFactor = ctx.scaleFactor;
  let scaledFormula = {};
  let scaledAchieved = {};
  let finalEC = 0;

  for (let i = 0; i < 5; i++) {
    // Scale fertilizers proportionally, keeping PeKacid fixed at cap when applicable
    scaledFormula = {};
    Object.entries(milpResult.formula).forEach(([fertId, grams]) => {
      if (fertId === PEKACID_ID && shouldFixPekacid) {
        scaledFormula[fertId] = fixedPekacidGrams;
      } else {
        scaledFormula[fertId] = grams * scaleFactor;
      }
    });

    // Scale achieved PPM
    // We need to calculate from the scaled formula instead of scaling achieved PPM
    // because PeKacid may be fixed at cap during scaling
    scaledAchieved = globalThis.FertilizerCore.accumulateAchievedPPM(availableFertilizers, scaledFormula, volume);

    // Check actual EC after scaling
    const newEC = estimateECFromPPM(scaledAchieved);
    finalEC = newEC.ec_mS_cm;

    // If within 1% of target, we're done
    const error = Math.abs(finalEC - targetEC) / targetEC;
    if (error < 0.01) break;

    // Adjust scale factor to converge to target EC
    scaleFactor = scaleFactor * (targetEC / finalEC);
  }

  return { scaledFormula, scaledAchieved, finalEC, scaleFactor };
}

// For Si: if user specified an absolute Si target, iteratively adjust the Si target so that
// after EC scaling it reaches the desired value (Si is an absolute PPM target, not ratio-based).
// Returns updated { scaledFormula, scaledAchieved, scaleFactor }.
async function _convergeSiTarget(ctx) {
  const {
    targetSi, availableFertilizers, volume, ppmTargets, solveMilpBrowser, onProgress,
    pekacidMaxLimit, estimateECFromPPM, targetEC
  } = ctx;
  let { scaledFormula, scaledAchieved, scaleFactor } = ctx;

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
      onProgress,
      pekacidMaxLimit
    });

    // Re-apply EC scaling to the adjusted result (scale ALL fertilizers proportionally
    // to maintain ratios)
    const adjustedOriginalEC = estimateECFromPPM(adjustedResult.achieved);
    if (adjustedOriginalEC && adjustedOriginalEC.ec_mS_cm > 0) {
      const rescaled = _rescaleFormulaToTargetEC(ctx, adjustedResult.formula, targetEC / adjustedOriginalEC.ec_mS_cm);
      scaledFormula = rescaled.formula;
      scaledAchieved = rescaled.achieved;
      scaleFactor = rescaled.scaleFactor;
    }
  }

  // Use the best result found
  return { scaledFormula: bestFormula, scaledAchieved: bestAchieved, scaleFactor: bestScaleFactor };
}

// Once a MILP solution is found, scale it to hit the requested target EC (keeping PeKacid at
// its cap when applicable, re-running the MILP when scaling would push PeKacid off its cap in
// either direction, and iteratively converging an absolute Si target). Returns the final result.
async function _applyTargetEcScaling(ctx) {
  const { milpResult, targetRatios, ppmTargets, targetEC, devLog } = ctx;
  const estimateECFromPPM = ctx.estimateECFromPPM;

  let originalEC = estimateECFromPPM(milpResult.achieved);
  if (!(originalEC && originalEC.ec_mS_cm > 0)) {
    return { formula: milpResult.formula, achieved: milpResult.achieved, targetRatios, targetPPM: ppmTargets };
  }

  const PEKACID_ID = 'icl_pekacid_pk_acid';
  // Strategy: Keep PeKacid at cap whenever possible to maximize acidification
  // If EC scaling would reduce PeKacid below cap, re-run MILP with PeKacid fixed at cap
  let scaleFactor = targetEC / originalEC.ec_mS_cm;
  const pekacidMaxGrams = ctx.pekacidMaxLimit * ctx.volume;
  const pekacidFromMilp = milpResult.formula[PEKACID_ID] || 0;
  const shouldFixPekacid = ctx.pekacidMaxLimit > 0 && pekacidFromMilp > 0;
  let fixedPekacidGrams = shouldFixPekacid ? Math.min(pekacidFromMilp, pekacidMaxGrams) : 0;
  let currentMilpResult = milpResult;

  // Special handling: when PeKacid is fixed at cap, solve ratios for other fertilizers at the
  // target EC so total ratios stay aligned (PeKacid adds P/K but no N/Ca/Mg).
  if (shouldFixPekacid && !ctx.useAbsoluteTargets) {
    const fixedRatioResult = await _trySolveWithFixedPekacidRatios({
      ...ctx, PEKACID_ID, fixedPekacidGrams, milpResult: currentMilpResult, originalEC
    });
    if (fixedRatioResult) return fixedRatioResult;
  }

  // If EC scaling would reduce PeKacid below its cap, fix it at cap and re-run the MILP for the
  // other fertilizers so acidification stays maximized.
  const rerunState = await _rerunKeepingPekacidAtCapIfScalingWouldDropIt({
    ...ctx, PEKACID_ID, pekacidFromMilp, scaleFactor, pekacidMaxGrams, devLog
  });
  if (rerunState) {
    currentMilpResult = rerunState.milpResult;
    originalEC = rerunState.originalEC;
    scaleFactor = rerunState.scaleFactor;
    fixedPekacidGrams = rerunState.fixedPekacidGrams;
  }

  const targetSi = targetRatios.Si || 0;

  const ecScalingResult = _convergeEcScaling({
    ...ctx, milpResult: currentMilpResult, shouldFixPekacid, PEKACID_ID, fixedPekacidGrams, scaleFactor
  });
  let scaledFormula = ecScalingResult.scaledFormula;
  let scaledAchieved = ecScalingResult.scaledAchieved;
  const finalEC = ecScalingResult.finalEC;
  scaleFactor = ecScalingResult.scaleFactor;

  if (targetSi > 0) {
    const siState = await _convergeSiTarget({
      ...ctx, targetSi, scaledFormula, scaledAchieved, scaleFactor
    });
    scaledFormula = siState.scaledFormula;
    scaledAchieved = siState.scaledAchieved;
    scaleFactor = siState.scaleFactor;
  }

  return {
    formula: scaledFormula,
    achieved: scaledAchieved,
    targetRatios,
    targetPPM: ppmTargets,
    ecScaling: { scaleFactor, originalEC: originalEC.ec_mS_cm, targetEC, achievedEC: finalEC }
  };
}

/**
 * Optimization algorithm - finds best fertilizer combination
 * @param {Object} options.onProgress - Optional callback for progress updates (e.g., WASM download)
 */
globalThis.FertilizerCore.optimizeFormula = async function(targetRatios, volume, availableFertilizers, concentration = 75, mode = 'oxide', options = {}) {
  const OXIDE_CONVERSIONS = globalThis.FertilizerCore.OXIDE_CONVERSIONS;
  const solveMilpBrowser = globalThis.FertilizerCore.solveMilpBrowser;
  const onProgress = options.onProgress;

  // Helper to log to both console and UI dev logs
  const devLog = (msg, type = 'info') => {
    const logMsg = `[OptimizeFormula] ${msg}`;
    console.log(logMsg);
    if (globalThis.addDevLog) {
      globalThis.addDevLog(msg, type);
    } else {
      globalThis._pendingDevLogs = globalThis._pendingDevLogs || [];
      globalThis._pendingDevLogs.push({ msg, type });
    }
  };

  // MILP is required - no fallback
  if (typeof solveMilpBrowser !== 'function') {
    throw new TypeError('MILP solver (solveMilpBrowser) is not available. Ensure HiGHS and lp-model are loaded.');
  }

  const P_to_P2O5 = 1 / OXIDE_CONVERSIONS.P2O5_to_P;
  const K_to_K2O = 1 / OXIDE_CONVERSIONS.K2O_to_K;

  const ppmTargets = options.useAbsoluteTargets
    ? _buildPpmTargetsFromAbsoluteTargets(targetRatios, mode, P_to_P2O5, K_to_K2O)
    : _buildPpmTargetsFromNormalizedRatio(targetRatios, mode, concentration, P_to_P2O5, K_to_K2O);

  // Pass pekacidMaxLimit and nh4PctTarget to the MILP solver if specified
  const pekacidMaxLimit = options.pekacidMaxLimit || 0;
  const nh4PctTarget = (typeof options.nh4PctTarget === 'number' && options.nh4PctTarget >= 0 && options.nh4PctTarget <= 100)
    ? options.nh4PctTarget : null;
  const milpResult = await solveMilpBrowser({ fertilizers: availableFertilizers, targets: ppmTargets, volume, tolerance: 0.01, onProgress, pekacidMaxLimit, nh4PctTarget });

  // Apply EC scaling if specified; otherwise return the raw MILP result as-is.
  if (options.targetEC && options.targetEC > 0 && typeof globalThis.FertilizerCore.estimateECFromPPM === 'function') {
    return _applyTargetEcScaling({
      milpResult, targetRatios, ppmTargets, volume, mode, concentration, options,
      availableFertilizers, solveMilpBrowser, onProgress, devLog, OXIDE_CONVERSIONS,
      P_to_P2O5, K_to_K2O, pekacidMaxLimit, useAbsoluteTargets: options.useAbsoluteTargets,
      targetEC: options.targetEC, estimateECFromPPM: globalThis.FertilizerCore.estimateECFromPPM
    });
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
globalThis.FertilizerCore.getSolubility = function(fertId) {
  const fert = this.FERTILIZERS.find(f => f.id === fertId);
  return fert?.solubility_gL ?? this.DEFAULT_SOLUBILITY_GL;
};

/**
 * Get compatibility tag for a fertilizer
 * @param {string} fertId - Fertilizer ID
 * @returns {string} 'calcium' | 'phosphate' | 'sulfate' | 'silicate' | 'neutral'
 */
globalThis.FertilizerCore.getCompatibilityTag = function(fertId) {
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
// Labeled format: "N2:P1:K3:Ca0.5". Mutates `ratio` in place; returns an { error } object if
// a part is malformed, otherwise undefined.
function _parseLabeledRatio(cleaned, ratio) {
  const labelMap = { N: 'N', P: 'P', K: 'K', CA: 'Ca', MG: 'Mg', S: 'S' };
  const parts = cleaned.split(':').filter(Boolean);
  for (const part of parts) {
    const match = /^([A-Za-z]+)([\d.]+)$/.exec(part);
    if (!match) {
      return { error: `Invalid labeled format: ${part}` };
    }
    const label = match[1].toUpperCase();
    const value = Number.parseFloat(match[2]);
    if (Number.isNaN(value)) {
      return { error: `Invalid number: ${match[2]}` };
    }
    const key = labelMap[label];
    if (!key) {
      return { error: `Unknown nutrient label: ${label}` };
    }
    ratio[key] = value;
  }
  return undefined;
}

// Positional format: "2:1:3" or "2:1:3:1:0.5" (N:P:K:Ca:Mg:S). Mutates `ratio` in place;
// returns an { error } object if a part is malformed, otherwise undefined.
function _parsePositionalRatio(cleaned, ratio) {
  const parts = cleaned.split(':');
  const order = ['N', 'P', 'K', 'Ca', 'Mg', 'S'];
  for (let i = 0; i < parts.length && i < order.length; i++) {
    const value = Number.parseFloat(parts[i]);
    if (Number.isNaN(value)) {
      return { error: `Invalid number at position ${i + 1}: ${parts[i]}` };
    }
    ratio[order[i]] = value;
  }
  return undefined;
}

globalThis.FertilizerCore.parseRatio = function(input) {
  if (!input || typeof input !== 'string') {
    return { error: 'Invalid input: expected ratio string' };
  }

  const cleaned = input.trim().replaceAll(/\s+/g, '');
  if (!cleaned) {
    return { error: 'Empty ratio string' };
  }

  const ratio = { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 };

  // Labeled format has letters before numbers; positional format is just numbers.
  const isLabeled = /^([A-Za-z]+[\d.]+:?)+$/.test(cleaned);
  const parseError = isLabeled ? _parseLabeledRatio(cleaned, ratio) : _parsePositionalRatio(cleaned, ratio);

  return parseError || { ratio };
};

/**
 * Accumulate achieved PPM (N/P/K in both elemental and oxide form, plus Ca/Mg/S/Si) from a
 * formula (fertilizer id -> grams) applied to a given volume. Shared by solveMilpBrowser and
 * optimizeFormula's EC-scaling/PeKacid-rerun passes, which all previously duplicated this same
 * nutrient-classification chain inline.
 * @param {Array} fertilizerList - Fertilizer objects (with .id and .pct)
 * @param {Object} formula - { fertilizerId: grams }
 * @param {number} volume - Liters
 * @returns {Object} achieved PPM by nutrient key
 */
// Dispatch table for accumulateAchievedPPM: how each raw fert.pct key contributes to the
// achieved-PPM accumulator. Replaces a 15-branch if/else-if chain with an O(1) lookup so the
// nutrient-classification rules read as data rather than control flow.
const ACHIEVED_PPM_HANDLERS = {
  N_NO3: (achieved, ppm) => { achieved.N_NO3 += ppm; achieved.N_total += ppm; },
  N_NH4: (achieved, ppm) => { achieved.N_NH4 += ppm; achieved.N_total += ppm; },
  N_Urea: (achieved, ppm) => { achieved.N_total += ppm; },
  N_total: (achieved, ppm, ctx) => { if (!ctx.hasNForms) achieved.N_total += ppm; },
  P2O5: (achieved, ppm, ctx) => { achieved.P2O5 += ppm; achieved.P += ppm * ctx.OXIDE_CONVERSIONS.P2O5_to_P; },
  P: (achieved, ppm, ctx) => { achieved.P += ppm; achieved.P2O5 += ppm * ctx.P_to_P2O5; },
  K2O: (achieved, ppm, ctx) => { achieved.K2O += ppm; achieved.K += ppm * ctx.OXIDE_CONVERSIONS.K2O_to_K; },
  K: (achieved, ppm, ctx) => { achieved.K += ppm; achieved.K2O += ppm * ctx.K_to_K2O; },
  Ca: (achieved, ppm) => { achieved.Ca += ppm; },
  CaO: (achieved, ppm, ctx) => { achieved.Ca += ppm * ctx.OXIDE_CONVERSIONS.CaO_to_Ca; },
  Mg: (achieved, ppm) => { achieved.Mg += ppm; },
  MgO: (achieved, ppm, ctx) => { achieved.Mg += ppm * ctx.OXIDE_CONVERSIONS.MgO_to_Mg; },
  S: (achieved, ppm) => { achieved.S += ppm; },
  SO3: (achieved, ppm, ctx) => { achieved.S += ppm * ctx.OXIDE_CONVERSIONS.SO3_to_S; },
  SiO2: (achieved, ppm) => { achieved.Si += ppm * 0.46744; },
  SiOH4: (achieved, ppm) => { achieved.Si += ppm * 0.2922; },
  Si: (achieved, ppm) => { achieved.Si += ppm; }
};

globalThis.FertilizerCore.accumulateAchievedPPM = function(fertilizerList, formula, volume) {
  const OXIDE_CONVERSIONS = this.OXIDE_CONVERSIONS;
  const ctx = {
    OXIDE_CONVERSIONS,
    P_to_P2O5: 1 / OXIDE_CONVERSIONS.P2O5_to_P,
    K_to_K2O: 1 / OXIDE_CONVERSIONS.K2O_to_K,
    hasNForms: false
  };

  const achieved = { N_total: 0, N_NO3: 0, N_NH4: 0, P2O5: 0, K2O: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0, Si: 0 };
  fertilizerList.forEach(fert => {
    const grams = formula[fert.id] || 0;
    if (!grams) return;
    ctx.hasNForms = Boolean(fert.pct.N_NO3 || fert.pct.N_NH4 || fert.pct.N_Urea);
    Object.entries(fert.pct).forEach(([nutrient, pct]) => {
      const ppm = (grams * 1000 * (pct / 100)) / volume;
      const handler = ACHIEVED_PPM_HANDLERS[nutrient];
      if (handler) {
        handler(achieved, ppm, ctx);
      }
    });
  });
  return achieved;
};

/**
 * Calculate elemental PPM contribution from 1 gram of fertilizer per liter
 * @param {Object} fert - Fertilizer object with pct
 * @returns {Object} { N, P, K, Ca, Mg, S } in ppm per gram per liter
 */
globalThis.FertilizerCore.getElementalContributionPerGram = function(fert) {
  const OXIDE = this.OXIDE_CONVERSIONS;
  const contrib = { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 };
  const pct = fert.pct || {};

  // Nitrogen: sum all N forms
  const hasNForms = pct.N_NO3 || pct.N_NH4 || pct.N_Urea;
  if (hasNForms) {
    contrib.N = ((pct.N_NO3 || 0) + (pct.N_NH4 || 0) + (pct.N_Urea || 0)) * 10; // % * 10 = ppm per g/L
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
// Assign one fertilizer's grams into the appropriate tank, mutating `tanks` in place.
function _assignOneFertilizerToTank(tanks, fertId, grams, tag, numTanks, fertFlags) {
  const { hasSignificantK, hasP } = fertFlags;

  switch (tag) {
    case 'calcium':
      // Ca goes to Tank A (isolated from phosphate/sulfate)
      tanks.A[fertId] = grams;
      break;
    case 'phosphate':
      // Phosphate goes to Tank B
      tanks.B[fertId] = grams;
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
    case 'sulfate':
    case 'neutral':
    default:
      // With 3+ tanks, K-heavy sources (like K2SO4, KNO3) go to Tank C for independent
      // control of P:K ratios across targets; everything else goes to Tank B
      if (numTanks >= 3 && hasSignificantK && !hasP) {
        tanks.C[fertId] = grams;
      } else {
        tanks.B[fertId] = grams;
      }
      break;
  }
}

globalThis.FertilizerCore.assignToTanks = function(formula, numTanks = 2, options = {}) {
  const { separateMg = false } = options;
  const tanks = { A: {}, B: {} };
  if (numTanks >= 3) tanks.C = {};
  if (numTanks >= 4) tanks.D = {};

  for (const [fertId, grams] of Object.entries(formula)) {
    if (!grams || grams <= 0) continue;

    const tag = this.getCompatibilityTag(fertId);
    const fert = this.FERTILIZERS.find(f => f.id === fertId);

    // Helper: does this fertilizer have significant K content?
    const hasSignificantK = fert?.pct?.K2O > 20;
    const hasP = fert?.pct?.P2O5 > 5;
    const hasMg = fert?.pct && ((fert.pct.Mg || 0) > 0 || (fert.pct.MgO || 0) > 0);

    // If P:Mg varies across targets and we have 4+ tanks, keep Mg sources separate
    if (separateMg && numTanks >= 4 && hasMg && !hasP && !hasSignificantK) {
      tanks.D[fertId] = grams;
      continue;
    }

    _assignOneFertilizerToTank(tanks, fertId, grams, tag, numTanks, { hasSignificantK, hasP });
  }

  return tanks;
};

/**
 * Check if a tank's stock composition is feasible (solubility)
 * @param {Object} tankFormula - { fertId: g/L in stock }
 * @returns {Object} { feasible: boolean, issues: [] }
 */
globalThis.FertilizerCore.checkTankFeasibility = function(tankFormula) {
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
globalThis.FertilizerCore.calculateAchievedPPM = function(tanks, dosing) {
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
globalThis.FertilizerCore.checkRatioMatch = function(achieved, targetRatio, tolerance = 0.05) {
  const errors = {};

  // Find non-zero target nutrients
  const targetKeys = Object.keys(targetRatio).filter(k => targetRatio[k] > 0);
  if (targetKeys.length === 0) {
    return { matches: true, errors };
  }

  // Normalize both to minimum non-zero value. The `|| 0.0001` fallback means this can never
  // be <=0 (a fully-zero achieved set just normalizes against that floor instead).
  const targetMin = Math.min(...targetKeys.map(k => targetRatio[k]));
  const achievedMin = Math.min(...targetKeys.map(k => achieved[k] || 0.0001).filter(v => v > 0));

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
 */
// PHASE 1: Find dosing RATIOS (mL per tank, arbitrary overall scale) that match the target
// nutrient ratio as closely as possible. EC doesn't matter yet - Phase 2 scales for EC.
function _makeRatioErrorFn(tanks, ratio, targetNutrients, targetMin) {
  return (dosing) => {
    const achieved = globalThis.FertilizerCore.calculateAchievedPPM(tanks, dosing);
    const achievedNonZero = targetNutrients.filter(n => achieved[n] > 0);
    if (achievedNonZero.length === 0) return Infinity;

    // achievedNonZero is already filtered to >0 values, so this minimum is always truthy.
    const achievedMin = Math.min(...achievedNonZero.map(n => achieved[n]));

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
}

// Try a candidate dosing, keeping it (and its error) if it beats the current best.
function _tryDosingCandidate(dosing, calcRatioError, best) {
  const err = calcRatioError(dosing);
  if (err < best.error) {
    return { dosing: { ...dosing }, error: err };
  }
  return best;
}

function _searchTwoTankRatios(tankIds, calcRatioError, best) {
  const ratioSteps = [0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 15, 20, 50];
  for (const abRatio of ratioSteps) {
    const total = abRatio + 1;
    const dosing = {
      [tankIds[0]]: 10 * abRatio / total,
      [tankIds[1]]: 10 / total
    };
    best = _tryDosingCandidate(dosing, calcRatioError, best);
  }
  return best;
}

function _searchThreeTankRatios(tankIds, calcRatioError, best) {
  const steps3 = [0.1, 0.2, 0.5, 1, 2, 5, 10];
  for (const aRatio of steps3) {
    for (const bRatio of steps3) {
      const total = aRatio + bRatio + 1;
      const dosing = {
        [tankIds[0]]: 10 * aRatio / total,
        [tankIds[1]]: 10 * bRatio / total,
        [tankIds[2]]: 10 / total
      };
      best = _tryDosingCandidate(dosing, calcRatioError, best);
    }
  }
  return best;
}

// assignToTanks never produces more than 4 tanks (A-D), so this only ever searches exactly 4.
function _searchFourPlusTankRatios(tankIds, calcRatioError, best) {
  const steps4 = [0.2, 0.5, 1, 2, 5];
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
        best = _tryDosingCandidate(dosing, calcRatioError, best);
      }
    }
  }
  return best;
}

// Local refinement: try small adjustments around the best solution found so far.
function _refineDosingRatios(tankIds, calcRatioError, best) {
  const refinementSteps = [-0.3, -0.1, 0.1, 0.3];
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 10) {
    improved = false;
    iterations++;
    for (const tankId of tankIds) {
      const baseDose = best.dosing[tankId] || 0;
      for (const delta of refinementSteps) {
        const testDosing = { ...best.dosing };
        testDosing[tankId] = Math.max(0.01, baseDose * (1 + delta));
        const candidate = _tryDosingCandidate(testDosing, calcRatioError, best);
        if (candidate !== best) {
          best = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}

function _searchBestDosingRatios(tanks, tankIds, ratio, targetNutrients, targetMin) {
  const calcRatioError = _makeRatioErrorFn(tanks, ratio, targetNutrients, targetMin);
  let best = { dosing: {}, error: Infinity };

  if (tankIds.length === 1) {
    // Single tank - just use 10 mL
    best = { dosing: { [tankIds[0]]: 10 }, error: Infinity };
  } else if (tankIds.length === 2) {
    best = _searchTwoTankRatios(tankIds, calcRatioError, best);
  } else if (tankIds.length === 3) {
    best = _searchThreeTankRatios(tankIds, calcRatioError, best);
  } else {
    best = _searchFourPlusTankRatios(tankIds, calcRatioError, best);
  }

  if (tankIds.length >= 2 && best.error > 0.01) {
    best = _refineDosingRatios(tankIds, calcRatioError, best);
  }

  return best.dosing;
}

// PHASE 2: Scale all dosing uniformly to hit target EC (the ratio between tanks stays the same).
// Returns { dosing, achieved, predictedEC }.
function _scaleDosingToTargetEC(tanks, bestDosing, tankIds, effectiveTargetEC, baselineEC) {
  const estimateECFromPPM = globalThis.FertilizerCore.estimateECFromPPM;
  const dosing = { ...bestDosing };

  let achieved = globalThis.FertilizerCore.calculateAchievedPPM(tanks, dosing);
  let ecResult = estimateECFromPPM(achieved);
  const currentEC = ecResult.ec_mS_cm;

  if (currentEC > 0) {
    const ecScale = effectiveTargetEC / currentEC;
    for (const t of tankIds) {
      dosing[t] *= ecScale;
    }
    achieved = globalThis.FertilizerCore.calculateAchievedPPM(tanks, dosing);
    ecResult = estimateECFromPPM(achieved);
  }

  return { dosing, achieved, predictedEC: ecResult.ec_mS_cm + baselineEC };
}

// Check dosing-volume and ratio/EC-match constraints, building the issues list.
function _buildDosingIssues(dosing, achieved, predictedEC, ratio, targetEC, maxDosing, tolerance) {
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
  const ratioCheck = globalThis.FertilizerCore.checkRatioMatch(achieved, ratio, tolerance);
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

  return issues;
}

/**
 * @param {Object} target - { ratio: {...}, targetEC, baselineEC }
 * @param {Object} options - { maxDosing, tolerance }
 * @returns {Object} { dosing: {A, B, ...}, achieved, predictedEC, feasible, issues }
 */
globalThis.FertilizerCore.solveDosing = function(tanks, target, options = {}) {
  const { maxDosing = 50, tolerance = 0.15 } = options; // Tolerance for ratio matching
  const { ratio, targetEC, baselineEC = 0 } = target;

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
  // targetNutrients is already filtered to ratio[n] > 0, so Math.min over their values needs no
  // further filtering; an empty targetNutrients yields Math.min() === Infinity (always truthy).
  const targetMin = Math.min(...targetNutrients.map(n => ratio[n]));

  const bestDosing = _searchBestDosingRatios(tanks, tankIds, ratio, targetNutrients, targetMin);
  const { dosing, achieved, predictedEC } = _scaleDosingToTargetEC(tanks, bestDosing, tankIds, effectiveTargetEC, baselineEC);
  const issues = _buildDosingIssues(dosing, achieved, predictedEC, ratio, targetEC, maxDosing, tolerance);

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
globalThis.FertilizerCore.calculateStockSolutions = async function(options) {
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

  // Progressive-K algorithm: try K=2, then K=3, then K=4. The loop always returns by K=4
  // (either a success, or that K's failure result), so there's no fallthrough case.
  for (let numTanks = 2; numTanks <= 4; numTanks++) {
    const result = await this._tryStockSolutionWithKTanks(
      numTanks,
      targets,
      fertObjects,
      stockConcentration,
      stockTankVolumeL,
      defaultBaselineEC
    );

    if (result.success || numTanks === 4) {
      return result;
    }
  }
};

// Pick the target whose N:P ratio is closest to the median across all targets (not the lowest),
// so the base MILP formula can span both high-N and high-P targets.
function _selectBaseTargetAndLowestNP(targets) {
  const targetsWithNP = targets.map(t => ({
    target: t,
    npRatio: (t.ratio.N || 0) / (t.ratio.P || 0.001)
  }));
  targetsWithNP.sort((a, b) => a.npRatio - b.npRatio);
  const medianIndex = Math.floor(targetsWithNP.length / 2);
  return { baseTarget: targetsWithNP[medianIndex].target, lowestNP: targetsWithNP[0].npRatio };
}

// Detect whether the target ratios vary widely enough (across multiple simultaneous targets)
// that certain nutrients need independently-controllable fertilizer sources.
function _detectVaryingRatios(targets) {
  if (targets.length <= 1) {
    return { hasVaryingPK: false, hasVaryingNP: false, hasVaryingPMg: false };
  }

  const spread = (values) => Math.max(...values) / Math.min(...values);

  // If P:K varies by more than 50%, we need separate P and K sources
  const hasVaryingPK = spread(targets.map(t => (t.ratio.K || 0.001) / (t.ratio.P || 0.001))) > 1.5;
  // If N:P varies by more than 2x, we need to decouple N from P sources
  const hasVaryingNP = spread(targets.map(t => (t.ratio.N || 0.001) / (t.ratio.P || 0.001))) > 2;
  // If P:Mg varies by more than 50%, we need separate Mg control
  const hasVaryingPMg = spread(targets.map(t => (t.ratio.P || 0.001) / (t.ratio.Mg || 0.001))) > 1.5;

  return { hasVaryingPK, hasVaryingNP, hasVaryingPMg };
}

// For 3+ tanks, prefer fertilizers that let varying nutrients be controlled independently
// (e.g. MKP over MAP when N:P varies, so N can be varied via Tank A/C without dragging P along).
// Falls back to the original, unfiltered list if filtering would remove a needed nutrient
// entirely or leave fewer than 3 fertilizers.
function _filterFertilizersForKTanks(fertObjects, numTanks, hasVaryingNP, hasVaryingPK) {
  if (numTanks < 3) return fertObjects;

  // Only ever called with entries from the real FERTILIZERS array, which always have .pct.
  const hasSignificant = (fert, keys) => keys.some(key => (fert.pct[key] || 0) > 5);
  const hasAny = (fert, keys) => keys.some(key => (fert.pct[key] || 0) > 0);
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
    return filteredFertObjects;
  }
  // Fallback: if filtering removes too many fertilizers or key nutrients, use original list
  return fertObjects;
}

// De-prioritize N sources that would go to Tank B (i.e. not calcium-bearing) so Tank A's
// calcium nitrate is preferred for supplying N when the lowest target N:P ratio is small.
function _deprioritizeNWithoutCa(fertObjects, lowestNP) {
  return fertObjects.map(f => {
    // Only ever called with entries from the real FERTILIZERS array, which always have .pct.
    const pct = f.pct;
    const hasN = pct.N_total > 0 || pct.N_NO3 > 0 || pct.N_NH4 > 0 || pct.N_Urea > 0;
    const hasCa = pct.Ca > 0 || pct.CaO > 0;
    if (hasN && !hasCa && lowestNP < 1.5) {
      return { ...f, priority: Math.max(f.priority || 10, 50) };
    }
    return f;
  });
}

// Cap the requested stock concentration so no fertilizer in any tank exceeds 80% of its
// solubility limit.
function _calculateEffectiveConcentration(tankAssignment, stockConcentration) {
  let maxSafeConcentration = stockConcentration;
  for (const tankFormula of Object.values(tankAssignment)) {
    for (const [fertId, gramsPerFinalL] of Object.entries(tankFormula)) {
      if (!gramsPerFinalL || gramsPerFinalL <= 0) continue;
      const solubility = globalThis.FertilizerCore.getSolubility(fertId);
      // Use 80% of solubility as safe limit
      const maxConc = (solubility * 0.8) / gramsPerFinalL;
      if (maxConc < maxSafeConcentration) {
        maxSafeConcentration = maxConc;
      }
    }
  }
  return Math.min(stockConcentration, Math.floor(maxSafeConcentration));
}

// Build the { tanks } structure (fertilizer amounts, solubility %, nutrients per mL) at the
// given concentration, and check each tank's feasibility. Returns { tanks, issues, errors }.
function _tankNamesAndDescriptions(numTanks, hasVaryingPMg) {
  const separateMg = hasVaryingPMg && numTanks >= 4;
  return {
    names: {
      A: 'Calcium Tank',
      B: separateMg ? 'Phosphate Tank' : 'Phosphate + Mg',
      C: 'Potassium',
      D: separateMg ? 'Magnesium Tank' : 'Silicate/Specialty'
    },
    descriptions: {
      A: 'Calcium-bearing fertilizers (isolated from phosphate/sulfate)',
      B: separateMg ? 'Phosphate sources (separated for P:Mg control)' : 'Phosphate sources and magnesium sulfate',
      C: 'Potassium sulfate and K-dominant fertilizers (allows independent P:K control)',
      D: separateMg ? 'Magnesium sources (separated for P:Mg control)' : 'Silicate and specialty fertilizers'
    }
  };
}

// Build one tank's { fertilizers, totalSolids_gL, nutrientsPerML } at the given concentration.
function _buildOneTank(tankId, tankFormula, tankMeta, effectiveConcentration, stockTankVolumeL) {
  const tank = {
    id: tankId,
    name: tankMeta.names[tankId] || `Tank ${tankId}`,
    description: tankMeta.descriptions[tankId] || '',
    fertilizers: {},
    totalSolids_gL: 0,
    nutrientsPerML: { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 }
  };

  for (const [fertId, gramsPerFinalL] of Object.entries(tankFormula)) {
    const stock_gL = gramsPerFinalL * effectiveConcentration;
    const solubility = globalThis.FertilizerCore.getSolubility(fertId);
    const solubility_pct = (stock_gL / solubility) * 100;

    tank.fertilizers[fertId] = {
      grams_per_L: stock_gL,
      grams_total: stock_gL * stockTankVolumeL,
      solubility_pct
    };
    tank.totalSolids_gL += stock_gL;

    // Calculate nutrients per mL
    const fert = globalThis.FertilizerCore.FERTILIZERS.find(f => f.id === fertId);
    if (fert) {
      const contribPerGram = globalThis.FertilizerCore.getElementalContributionPerGram(fert);
      for (const n of Object.keys(tank.nutrientsPerML)) {
        tank.nutrientsPerML[n] += contribPerGram[n] * stock_gL / 1000;
      }
    }
  }

  return tank;
}

// Tank feasibility is checked here as a sanity check on the concentration cap computed just
// before this is called (effectiveConcentration always keeps every fertilizer at <=80% of its
// solubility, so this never actually reports an error - only ever an empty issues list).
function _buildTanksFromAssignment(tankAssignment, effectiveConcentration, stockTankVolumeL, numTanks, hasVaryingPMg) {
  const tanks = {};
  const issues = [];
  const tankMeta = _tankNamesAndDescriptions(numTanks, hasVaryingPMg);

  for (const [tankId, tankFormula] of Object.entries(tankAssignment)) {
    if (!tankFormula || Object.keys(tankFormula).length === 0) continue;

    tanks[tankId] = _buildOneTank(tankId, tankFormula, tankMeta, effectiveConcentration, stockTankVolumeL);

    const tankFormulaGL = {};
    for (const [fertId, data] of Object.entries(tanks[tankId].fertilizers)) {
      tankFormulaGL[fertId] = data.grams_per_L;
    }
    const feasibility = globalThis.FertilizerCore.checkTankFeasibility(tankFormulaGL);
    issues.push(...feasibility.issues);
  }

  return { tanks, issues };
}

// Solve dosing for every target against the built tanks. Returns
// { dosingInstructions, issues, errors }.
function _calculateDosingForTargets(targets, tanks, optimResult, defaultBaselineEC) {
  const dosingInstructions = [];
  const issues = [];
  const errors = [];

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

    const dosingResult = globalThis.FertilizerCore.solveDosing(tanksForDosing, {
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
    const ionBalance = globalThis.FertilizerCore.calculateIonBalanceCore
      ? globalThis.FertilizerCore.calculateIonBalanceCore(optimResult.formula, 1)
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

    issues.push(...dosingResult.issues);
    if (!dosingResult.feasible) {
      // This target is infeasible with current K
      errors.push(...dosingResult.issues.filter(i => i.level === 'error'));
    }
  }

  return { dosingInstructions, issues, errors };
}

/**
 * Internal: Try to build stock solution with K tanks
 *
 * Simple approach: Use compatibility rules for tank assignment.
 * Calcium sources in Tank A, everything else distributed by type.
 * With 3+ tanks, separate K-only sources for independent P:K control.
 */
globalThis.FertilizerCore._tryStockSolutionWithKTanks = async function(
  numTanks,
  targets,
  fertObjects,
  stockConcentration,
  stockTankVolumeL,
  defaultBaselineEC
) {
  const optimizeFormula = this.optimizeFormula;

  const { baseTarget, lowestNP } = _selectBaseTargetAndLowestNP(targets);
  const { hasVaryingPK, hasVaryingNP, hasVaryingPMg } = _detectVaryingRatios(targets);

  const filteredFertObjects = _filterFertilizersForKTanks(fertObjects, numTanks, hasVaryingNP, hasVaryingPK);
  const adjustedFertObjects = _deprioritizeNWithoutCa(filteredFertObjects, lowestNP);

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

  const effectiveConcentration = _calculateEffectiveConcentration(tankAssignment, stockConcentration);
  if (effectiveConcentration < 10) {
    // Concentration too low to be practical
    return { success: false, errors: [{ level: 'error', code: 'CONCENTRATION_TOO_LOW', message: `Required stock concentration (${effectiveConcentration}x) is too low due to solubility limits` }] };
  }

  const { tanks, issues: tankIssues } = _buildTanksFromAssignment(
    tankAssignment, effectiveConcentration, stockTankVolumeL, numTanks, hasVaryingPMg
  );
  const allIssues = [...tankIssues];
  const allErrors = [];

  // Add warning if concentration was reduced
  if (effectiveConcentration < stockConcentration) {
    allIssues.push({
      level: 'warning',
      code: 'CONCENTRATION_REDUCED',
      message: `Stock concentration reduced from ${stockConcentration}x to ${effectiveConcentration}x due to solubility limits`,
      details: { requested: stockConcentration, effective: effectiveConcentration }
    });
  }

  const { dosingInstructions, issues: dosingIssues, errors: dosingErrors } =
    _calculateDosingForTargets(targets, tanks, optimResult, defaultBaselineEC);
  allIssues.push(...dosingIssues);
  allErrors.push(...dosingErrors);

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
// Optimization: solveMilpBrowser, optimizeFormula
// Stock Solutions: assignToTanks, checkTankFeasibility, calculateAchievedPPM, checkRatioMatch,
//                  solveDosing, calculateStockSolutions
//
// Copy Text Builders (in fertilizer-copy.js):
//   buildTankCopyText, buildTwoTankCopyText, buildGramsToPpmCopyText, buildFormulaCopyText, buildReverseCopyText
