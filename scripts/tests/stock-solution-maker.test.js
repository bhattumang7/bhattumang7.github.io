/**
 * Unit Tests for Stock Solution Maker
 *
 * Run in browser: Include fertilizer-data.js, fertilizer-core.js, then this file
 * Run with Node.js: See instructions below
 *
 * Tests cover:
 * - parseRatio: Positional and labeled formats
 * - getSolubility: Default and explicit values
 * - getCompatibilityTag: Tank assignment rules
 * - assignToTanks: Compatibility separation
 * - checkTankFeasibility: Solubility validation
 * - calculateAchievedPPM: Nutrient calculations
 * - solveDosing: EC-based dosing solver
 * - calculateStockSolutions: Full Progressive-K algorithm
 * - Regression: Existing single-ratio feature unchanged
 */

(function() {
  'use strict';

  // Test framework
  const tests = [];
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    tests.push({ name, fn });
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message || 'assertEqual'}: expected ${expected}, got ${actual}`);
    }
  }

  function assertApprox(actual, expected, tolerance, message) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message || 'assertApprox'}: expected ~${expected} (±${tolerance}), got ${actual}`);
    }
  }

  function assertHasKey(obj, key, message) {
    if (!(key in obj)) {
      throw new Error(`${message || 'assertHasKey'}: missing key "${key}"`);
    }
  }

  // Node.js without the real HiGHS/LPModel WASM solver (run-tests.js's mocked environment)
  // can't run MILP-backed calls at all - solveMilpBrowser throws before doing any real work.
  // Tests that only care about MILP-adjacent behavior (dev-log hooks, cache state) skip
  // cleanly here instead of failing; run-stock-solution-tests.js (real WASM) always has
  // LPModel loaded, so it runs them for real and is what coverage is measured from.
  function milpAvailable() {
    return typeof globalThis.LPModel !== 'undefined';
  }

  // Reconstructs grams-dosed-per-liter-of-final-solution from tank stock concentrations
  // (g/L) and per-tank dosing (mL/L), so calculateIonBalanceCore (which expects a formula
  // in grams, not tank/dosing pairs) can be run against the same scenario a test set up.
  function finalFormulaFromTanksDosing(tanks, dosingMLPerL) {
    const formula = {};
    for (const [tankId, tankFerts] of Object.entries(tanks)) {
      const mLPerL = dosingMLPerL[tankId] || 0;
      for (const [fertId, stockGPerL] of Object.entries(tankFerts)) {
        formula[fertId] = (formula[fertId] || 0) + stockGPerL * (mLPerL / 1000);
      }
    }
    return formula;
  }

  async function runTests() {
    console.log('='.repeat(60));
    console.log('Stock Solution Maker - Unit Tests');
    console.log('='.repeat(60));

    for (const t of tests) {
      try {
        await t.fn();
        console.log(`✓ ${t.name}`);
        passed++;
      } catch (e) {
        console.error(`✗ ${t.name}`);
        console.error(`  ${e.message}`);
        failed++;
      }
    }

    console.log('-'.repeat(60));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));

    return { passed, failed };
  }

  // Mock fertilizer library for isolated testing
  const MOCK_FERTILIZERS = [
    {
      id: 'calcium_nitrate_mock',
      name: 'Calcium Nitrate (Mock)',
      pct: { N_total: 15.5, N_NO3: 14.4, N_NH4: 1.1, Ca: 19.0 },
      solubility_gL: 1290
    },
    {
      id: 'mkp_mock',
      name: 'MKP (Mock)',
      pct: { P2O5: 52.0, K2O: 34.0 },
      solubility_gL: 230
    },
    {
      id: 'potassium_nitrate_mock',
      name: 'Potassium Nitrate (Mock)',
      pct: { N_total: 13.7, N_NO3: 13.7, K2O: 46.3 },
      solubility_gL: 320
    },
    {
      id: 'magnesium_sulfate_mock',
      name: 'Magnesium Sulfate (Mock)',
      pct: { Mg: 9.86, S: 13.0 },
      solubility_gL: 710
    }
  ];

  // ==========================================================================
  // HiGHS solver bootstrap Tests (getHighsInstance / preloadHighsSolver)
  // ==========================================================================
  // These must run before any other test touches the solver, since they rely on
  // FertilizerCore's module-level HiGHS cache still being empty (there's no reset hook,
  // so once something else loads the real solver, these paths become unreachable for the
  // rest of the process). Registered first in this file for that reason.

  test('_getWasmPath: falls back to an absolute path when no matching <script src="highs.js"> is found', () => {
    // Overrides document.getElementsByTagName unconditionally (rather than relying on
    // whichever mock the current runner set up) so this passes the same way under both
    // run-tests.js's minimal document mock and run-stock-solution-tests.js's script-aware one.
    const originalGetElementsByTagName = document.getElementsByTagName;
    document.getElementsByTagName = () => [{ src: 'https://cdn.example.com/app.js' }];
    try {
      const result = window.FertilizerCore._getWasmPath('highs.wasm');
      assertEqual(result, '/assets/vendor/highs/highs.wasm', 'Should fall back to the absolute web-server path');
    } finally {
      document.getElementsByTagName = originalGetElementsByTagName;
    }
  });

  test('preloadHighsSolver: swallows a failure to load the solver instead of throwing', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    if (window.FertilizerCore.isHighsLoaded()) { console.log('  (skipped - HiGHS already cached by an earlier test)'); return; }
    const originalHighs = globalThis.highs;
    globalThis.highs = undefined;
    try {
      await window.FertilizerCore.preloadHighsSolver();
      assert(!window.FertilizerCore.isHighsLoaded(), 'Should not have cached a solver instance');
    } finally {
      globalThis.highs = originalHighs;
    }
  });

  test('getHighsInstance: propagates a solver load rejection and clears the in-flight promise', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    if (window.FertilizerCore.isHighsLoaded()) { console.log('  (skipped - HiGHS already cached by an earlier test)'); return; }
    const originalHighs = globalThis.highs;
    globalThis.highs = () => Promise.reject(new Error('simulated WASM load failure'));
    try {
      let threw = false;
      try {
        await window.FertilizerCore.getHighsInstance();
      } catch (e) {
        threw = true;
      }
      assert(threw, 'Should propagate the rejection to the caller');
      assert(!window.FertilizerCore.isHighsLoaded(), 'A failed load should not be cached');
    } finally {
      globalThis.highs = originalHighs;
    }
  });

  test('getHighsInstance: concurrent calls share the in-flight promise and both report progress', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    if (window.FertilizerCore.isHighsLoaded()) { console.log('  (skipped - HiGHS already cached by an earlier test)'); return; }
    const progress1 = [];
    const progress2 = [];
    // Async functions never return the same Promise object twice (even when both return the
    // same already-existing promise), so what actually proves the second call reused the
    // in-flight load rather than starting a new one is that only the FIRST caller's onProgress
    // ever fires - a second real load would call progress2 too.
    const p1 = window.FertilizerCore.getHighsInstance((status) => progress1.push(status));
    const p2 = window.FertilizerCore.getHighsInstance((status) => progress2.push(status));
    const [instance1, instance2] = await Promise.all([p1, p2]);
    assert(instance1 === instance2, 'Both calls should resolve to the same solver instance');
    assertEqual(progress1[0], 'downloading', 'First caller should be told the solver is downloading');
    assertEqual(progress1[progress1.length - 1], 'ready', 'First caller should be told the solver is ready');
    assertEqual(progress2.length, 0, 'Second (concurrent) caller should not trigger its own load');
    assert(window.FertilizerCore.isHighsLoaded(), 'Solver instance should now be cached');
  });

  test('preloadHighsSolver: no-op once the solver is already cached', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    assert(window.FertilizerCore.isHighsLoaded(), 'Previous test should have cached the solver');
    await window.FertilizerCore.preloadHighsSolver();
    assert(window.FertilizerCore.isHighsLoaded(), 'Should still be cached');
  });

  // ==========================================================================
  // parseRatio Tests
  // ==========================================================================

  test('parseRatio: Positional format - 3 values', () => {
    const result = window.FertilizerCore.parseRatio('2:1:3');
    assert(!result.error, 'Should not have error');
    assertEqual(result.ratio.N, 2, 'N');
    assertEqual(result.ratio.P, 1, 'P');
    assertEqual(result.ratio.K, 3, 'K');
    assertEqual(result.ratio.Ca, 0, 'Ca default');
    assertEqual(result.ratio.Mg, 0, 'Mg default');
  });

  test('parseRatio: Positional format - 5 values', () => {
    const result = window.FertilizerCore.parseRatio('3:1:4:2:0.5');
    assert(!result.error, 'Should not have error');
    assertEqual(result.ratio.N, 3, 'N');
    assertEqual(result.ratio.P, 1, 'P');
    assertEqual(result.ratio.K, 4, 'K');
    assertEqual(result.ratio.Ca, 2, 'Ca');
    assertEqual(result.ratio.Mg, 0.5, 'Mg');
  });

  test('parseRatio: Labeled format - basic', () => {
    const result = window.FertilizerCore.parseRatio('N2:P1:K3');
    assert(!result.error, 'Should not have error');
    assertEqual(result.ratio.N, 2, 'N');
    assertEqual(result.ratio.P, 1, 'P');
    assertEqual(result.ratio.K, 3, 'K');
  });

  test('parseRatio: Labeled format - with Ca and Mg', () => {
    const result = window.FertilizerCore.parseRatio('N3:K4:Ca1:Mg0.5');
    assert(!result.error, 'Should not have error');
    assertEqual(result.ratio.N, 3, 'N');
    assertEqual(result.ratio.P, 0, 'P (omitted)');
    assertEqual(result.ratio.K, 4, 'K');
    assertEqual(result.ratio.Ca, 1, 'Ca');
    assertEqual(result.ratio.Mg, 0.5, 'Mg');
  });

  test('parseRatio: Invalid input - empty', () => {
    const result = window.FertilizerCore.parseRatio('');
    assert(result.error, 'Should have error');
  });

  test('parseRatio: Invalid input - null', () => {
    const result = window.FertilizerCore.parseRatio(null);
    assert(result.error, 'Should have error');
  });

  test('parseRatio: Labeled format - unrecognized nutrient label', () => {
    // Real scenario: a grower tries to add an iron ratio the same way they add N/P/K,
    // not realizing micros aren't part of the labeled-ratio grammar.
    const result = window.FertilizerCore.parseRatio('Fe2:N3:K2');
    assert(result.error, 'Should have error');
    assert(/Unknown nutrient label/.test(result.error), 'Error should name the bad label');
  });

  test('parseRatio: Labeled format - missing colon separators', () => {
    // Real scenario: a grower copies a feed label like "N5P3K2" and forgets the colons
    // parseRatio expects between labeled values.
    const result = window.FertilizerCore.parseRatio('N5P3K2');
    assert(result.error, 'Should have error');
    assert(/Invalid labeled format/.test(result.error), 'Error should flag the malformed token');
  });

  test('parseRatio: Positional format - non-numeric value', () => {
    // Real scenario: a stray character survives a copy-paste from a PDF feed chart.
    const result = window.FertilizerCore.parseRatio('2:1:abc');
    assert(result.error, 'Should have error');
    assert(/Invalid number/.test(result.error), 'Error should flag the invalid number');
  });

  // ==========================================================================
  // getSolubility Tests
  // ==========================================================================

  test('getSolubility: Known fertilizer', () => {
    const sol = window.FertilizerCore.getSolubility('calcium_nitrate_calcinit_typical');
    assertEqual(sol, 1290, 'Calcium nitrate solubility');
  });

  test('getSolubility: Low solubility fertilizer', () => {
    const sol = window.FertilizerCore.getSolubility('potassium_sulfate_common');
    assertEqual(sol, 120, 'Potassium sulfate solubility');
  });

  test('getSolubility: Unknown fertilizer - returns default', () => {
    const sol = window.FertilizerCore.getSolubility('unknown_fertilizer_xyz');
    assertEqual(sol, window.FertilizerCore.DEFAULT_SOLUBILITY_GL, 'Default solubility');
  });

  // ==========================================================================
  // getCompatibilityTag Tests
  // ==========================================================================

  test('getCompatibilityTag: Calcium source', () => {
    const tag = window.FertilizerCore.getCompatibilityTag('calcium_nitrate_calcinit_typical');
    assertEqual(tag, 'calcium', 'Should be calcium');
  });

  test('getCompatibilityTag: Phosphate source', () => {
    const tag = window.FertilizerCore.getCompatibilityTag('mkp_typical');
    assertEqual(tag, 'phosphate', 'Should be phosphate');
  });

  test('getCompatibilityTag: Sulfate source', () => {
    const tag = window.FertilizerCore.getCompatibilityTag('magnesium_sulfate_heptahydrate_common');
    assertEqual(tag, 'sulfate', 'Should be sulfate');
  });

  test('getCompatibilityTag: Neutral', () => {
    const tag = window.FertilizerCore.getCompatibilityTag('potassium_nitrate_typical');
    assertEqual(tag, 'neutral', 'Should be neutral');
  });

  // ==========================================================================
  // assignToTanks Tests
  // ==========================================================================

  test('assignToTanks: Ca goes to Tank A', () => {
    const formula = {
      'calcium_nitrate_calcinit_typical': 10,
      'mkp_typical': 5
    };
    const tanks = window.FertilizerCore.assignToTanks(formula, 2);

    assertHasKey(tanks.A, 'calcium_nitrate_calcinit_typical', 'Ca in A');
    assertHasKey(tanks.B, 'mkp_typical', 'P in B');
    assert(!tanks.A['mkp_typical'], 'P not in A');
    assert(!tanks.B['calcium_nitrate_calcinit_typical'], 'Ca not in B');
  });

  test('assignToTanks: Neutral goes to Tank B', () => {
    const formula = {
      'potassium_nitrate_typical': 10
    };
    const tanks = window.FertilizerCore.assignToTanks(formula, 2);

    assertHasKey(tanks.B, 'potassium_nitrate_typical', 'Neutral in B');
    assert(!tanks.A['potassium_nitrate_typical'], 'Neutral not in A');
  });

  test('assignToTanks: Mixed formula separates correctly', () => {
    const formula = {
      'calcium_nitrate_calcinit_typical': 10,
      'mkp_typical': 5,
      'magnesium_sulfate_heptahydrate_common': 3,
      'potassium_nitrate_typical': 7
    };
    const tanks = window.FertilizerCore.assignToTanks(formula, 2);

    // Tank A: Ca only
    assertEqual(Object.keys(tanks.A).length, 1, 'Tank A has 1 fertilizer');
    assertHasKey(tanks.A, 'calcium_nitrate_calcinit_typical', 'Ca in A');

    // Tank B: P, S, neutral
    assertEqual(Object.keys(tanks.B).length, 3, 'Tank B has 3 fertilizers');
  });

  test('assignToTanks: a zero-gram entry in the formula is skipped', () => {
    const formula = { calcium_nitrate_calcinit_typical: 10, mkp_typical: 0 };
    const tanks = window.FertilizerCore.assignToTanks(formula, 2);
    assert(!tanks.A['mkp_typical'] && !tanks.B['mkp_typical'], 'Zero-gram fertilizer should not be assigned anywhere');
  });

  // ==========================================================================
  // checkTankFeasibility Tests
  // ==========================================================================

  test('checkTankFeasibility: Within limits', () => {
    const tankFormula = {
      'calcium_nitrate_calcinit_typical': 100  // 1290 g/L limit
    };
    const result = window.FertilizerCore.checkTankFeasibility(tankFormula);
    assert(result.feasible, 'Should be feasible');
    assertEqual(result.issues.length, 0, 'No issues');
  });

  test('checkTankFeasibility: Near limit - warning', () => {
    const tankFormula = {
      'calcium_nitrate_calcinit_typical': 1100  // 85% of 1290
    };
    const result = window.FertilizerCore.checkTankFeasibility(tankFormula);
    assert(result.feasible, 'Should still be feasible');
    assert(result.issues.some(i => i.code === 'SOLUBILITY_NEAR_LIMIT'), 'Should warn');
  });

  test('checkTankFeasibility: Exceeded - error', () => {
    const tankFormula = {
      'potassium_sulfate_common': 150  // Exceeds 120 g/L limit
    };
    const result = window.FertilizerCore.checkTankFeasibility(tankFormula);
    assert(!result.feasible, 'Should be infeasible');
    assert(result.issues.some(i => i.code === 'SOLUBILITY_EXCEEDED'), 'Should have error');
  });

  test('checkTankFeasibility: a zero-g/L entry is skipped', () => {
    const result = window.FertilizerCore.checkTankFeasibility({ calcium_nitrate_calcinit_typical: 0 });
    assertEqual(result.issues.length, 0, 'Nothing to check for a zero-g/L entry');
  });

  test('checkTankFeasibility: an unrecognized fertilizer id falls back to its id in the message', () => {
    // Exercises the `fert?.name || fertId` fallback in both the SOLUBILITY_EXCEEDED and
    // SOLUBILITY_NEAR_LIMIT messages - getSolubility already defaults an unknown id to 200 g/L,
    // so unknown ids can still trigger either branch.
    const result = window.FertilizerCore.checkTankFeasibility({
      unknown_fert_exceeded: 250,   // > 200 g/L default -> SOLUBILITY_EXCEEDED
      unknown_fert_near_limit: 170  // 85% of 200 g/L default -> SOLUBILITY_NEAR_LIMIT
    });
    const exceeded = result.issues.find(i => i.code === 'SOLUBILITY_EXCEEDED');
    const nearLimit = result.issues.find(i => i.code === 'SOLUBILITY_NEAR_LIMIT');
    assert(exceeded && exceeded.message.includes('unknown_fert_exceeded'), 'Should fall back to the raw id');
    assert(nearLimit && nearLimit.message.includes('unknown_fert_near_limit'), 'Should fall back to the raw id');
  });

  // ==========================================================================
  // calculateAchievedPPM Tests
  // ==========================================================================

  test('calculateAchievedPPM: Simple case', () => {
    const tanks = {
      A: { 'calcium_nitrate_calcinit_typical': 100 }  // 100 g/L stock
    };
    const dosing = { A: 10 };  // 10 mL/L

    const achieved = window.FertilizerCore.calculateAchievedPPM(tanks, dosing);

    // 100 g/L stock × 10 mL/L = 1 g/L in final
    // Ca: 19% × 10 = 190 ppm per g/L → 190 ppm
    // N: 15.5% × 10 = 155 ppm per g/L → 155 ppm
    assertApprox(achieved.Ca, 190, 1, 'Ca ppm');
    assertApprox(achieved.N, 155, 1, 'N ppm');

    // Ion balance: Ca2+ (9.26 meq) + NH4+ (0.93 meq, from the 1.1% NH4-N fraction) should
    // exactly balance the NO3- from all of calcium nitrate's N (10.19 meq).
    const formula = finalFormulaFromTanksDosing(tanks, dosing);
    const ionBalance = window.FertilizerCore.calculateIonBalanceCore(formula, 1);
    assertApprox(ionBalance.totalCations, 10.19, 0.05, 'Total cations meq/L');
    assertApprox(ionBalance.totalAnions, 10.19, 0.05, 'Total anions meq/L');
    assertApprox(ionBalance.imbalance, 0, 0.01, 'Ion balance should be ~0 (single N-only fertilizer)');
  });

  test('calculateAchievedPPM: Two tanks', () => {
    const tanks = {
      A: { 'calcium_nitrate_calcinit_typical': 100 },
      B: { 'mkp_typical': 50 }
    };
    const dosing = { A: 10, B: 10 };

    const achieved = window.FertilizerCore.calculateAchievedPPM(tanks, dosing);

    // Tank A: 100 g/L CaNO3 stock × 10 mL/L dosing = 1 g/L equivalent -> N=155, Ca=190
    // Tank B: 50 g/L MKP stock × 10 mL/L dosing = 0.5 g/L equivalent -> P=113.48, K=141.12
    assertApprox(achieved.N, 155, 1, 'N ppm from Tank A');
    assertApprox(achieved.Ca, 190, 1, 'Ca ppm from Tank A');
    assertApprox(achieved.P, 113.48, 1, 'P ppm from Tank B');
    assertApprox(achieved.K, 141.12, 1, 'K ppm from Tank B');

    // Ion balance: Ca2+ + NH4+ (from CaNO3) + K+ (from MKP) as cations, NO3- + H2PO4- as
    // anions - two independent fertilizers, so this also checks cross-tank ion accounting.
    const formula = finalFormulaFromTanksDosing(tanks, dosing);
    const ionBalance = window.FertilizerCore.calculateIonBalanceCore(formula, 1);
    assertApprox(ionBalance.totalCations, 13.86, 0.05, 'Total cations meq/L (Ca2+ + NH4+ + K+)');
    assertApprox(ionBalance.totalAnions, 13.86, 0.05, 'Total anions meq/L (NO3- + H2PO4-)');
    assertApprox(ionBalance.imbalance, 0, 0.01, 'Ion balance should be ~0');
  });

  test('calculateAchievedPPM: skips zero-dosed tanks, zero-stock fertilizers, and unknown fertilizer ids', () => {
    // Exercises calculateAchievedPPM's three "nothing to contribute here" continue guards:
    // a tank with 0 mL/L dosing, a fertilizer entry with 0 g/L stock, and (in a separate,
    // positively-dosed tank, so its lookup is actually reached rather than short-circuited by
    // the zero-dosing guard first) a fertilizer id that isn't in FERTILIZERS at all.
    const tanks = {
      A: { calcium_nitrate_calcinit_typical: 100, mkp_typical: 0 },
      B: { calcium_nitrate_calcinit_typical: 100 },
      C: { not_a_real_fertilizer_id: 50, potassium_nitrate_typical: 50 }
    };
    const dosing = { A: 10, B: 0, C: 10 };

    const achieved = window.FertilizerCore.calculateAchievedPPM(tanks, dosing);
    assertApprox(achieved.Ca, 190, 1, 'Only Tank A/calcium nitrate should contribute Ca (Tank B is zero-dosed)');
    assertEqual(achieved.P, 0, 'Zero-stock MKP entry should contribute nothing');
    assert(achieved.K > 0, 'The unknown id should be skipped but potassium nitrate should still contribute');
  });

  // ==========================================================================
  // accumulateAchievedPPM Tests (grams-to-ppm / "PPM Calculator" mode)
  // ==========================================================================

  test('accumulateAchievedPPM: 6-fertilizer blend matches real calculator output', async () => {
    // Reproduces the PPM Calculator tab's grams-to-ppm mode: 6 fertilizers (including
    // ICL PeKacid, an acidifying PK source with its own H+/H2PO4- ion contribution) dosed
    // by fixed gram amounts into 10L. Checked against a known-good calculator run: achieved
    // PPM per nutrient, N forms, ion balance, and the derived N:P:K / N:P2O5:K2O / N:K /
    // NO3:NH4 ratios - not just that the function returns *an* object.
    const formula = {
      calcium_nitrate_calcinit_typical: 7.35,
      potassium_nitrate_typical: 2.39,
      ammonium_nitrate_common: 0.37,
      magnesium_sulfate_heptahydrate_common: 3.94,
      potassium_sulfate_common: 1.42,
      icl_pekacid_pk_acid: 1.48
    };
    const volume = 10;
    const fertilizerList = Object.keys(formula).map(
      id => window.FertilizerCore.FERTILIZERS.find(f => f.id === id)
    );
    assert(fertilizerList.every(Boolean), 'All 6 fertilizers should be found');

    const achieved = window.FertilizerCore.accumulateAchievedPPM(fertilizerList, formula, volume);

    // Nutrient Concentrations (PPM)
    assertApprox(achieved.N_total, 159.25, 1, 'N ppm');
    assertApprox(achieved.N_NO3, 144.87, 1, 'NO3-N ppm');
    assertApprox(achieved.N_NH4, 14.38, 1, 'NH4-N ppm');
    assertApprox(achieved.P, 38.76, 1, 'P ppm');
    assertApprox(achieved.K, 175.37, 1, 'K ppm');
    assertApprox(achieved.Ca, 139.65, 1, 'Ca ppm');
    assertApprox(achieved.Mg, 38.85, 1, 'Mg ppm');
    assertApprox(achieved.S, 75.36, 1, 'S ppm');

    // Ion Balance: Cations 16.40 meq/L, Anions 16.40 meq/L, balanced (PeKacid contributes
    // both H+ cation and H2PO4- anion, on top of the usual Ca2+/NH4+/K+/Mg2+/NO3-/SO4^2-)
    const ionBalance = window.FertilizerCore.calculateIonBalanceCore(formula, volume);
    assertApprox(ionBalance.totalCations, 16.40, 0.1, 'Total cations meq/L');
    assertApprox(ionBalance.totalAnions, 16.40, 0.1, 'Total anions meq/L');
    assertApprox(ionBalance.imbalance, 0, 0.01, 'Ion balance should be ~0 (balanced)');

    // Key Ratios
    const ratios = window.FertilizerCore.calculateNutrientRatios(achieved);
    const npk = ratios.find(r => r.name === 'N : P : K');
    const npkOxide = ratios.find(r => r.name === 'N : P₂O₅ : K₂O');
    const nk = ratios.find(r => r.name === 'N : K');
    const no3nh4 = ratios.find(r => r.name === 'NO₃ : NH₄');

    assert(npk, 'Should have N:P:K ratio');
    assertEqual(npk.ratio, '4.11 : 1 : 4.52', 'N:P:K ratio string');
    assert(npkOxide, 'Should have N:P2O5:K2O ratio');
    assertEqual(npkOxide.ratio, '1.79 : 1 : 2.38', 'N:P2O5:K2O ratio string');
    assert(nk, 'Should have N:K ratio');
    assertEqual(nk.ratio, '1 : 1.1', 'N:K ratio string');
    assert(no3nh4, 'Should have NO3:NH4 ratio');
    assertEqual(no3nh4.ratio, '10.08 : 1', 'NO3:NH4 ratio string');
  });

  test('accumulateAchievedPPM: a fertilizer with N reported only as N_total (no NO3/NH4/Urea split)', () => {
    // Every real fertilizer in the database that lists N_total also lists at least one N form
    // (NO3/NH4/Urea), so ACHIEVED_PPM_HANDLERS' N_total handler's "no other N form present"
    // branch is otherwise never taken. Uses a fabricated fertilizer to exercise it directly.
    const achieved = window.FertilizerCore.accumulateAchievedPPM(
      [{ id: 'custom_ntotal_only', pct: { N_total: 20 } }],
      { custom_ntotal_only: 10 },
      1
    );
    assertApprox(achieved.N_total, 2000, 1, 'N_total ppm (10g x 1000 x 20% / 1L)');
  });

  // ==========================================================================
  // Ca/CaO and Mg/MgO cross-conversion Tests (syncCalciumMagnesiumOxideForms,
  // and its use inside accumulateAchievedPPM)
  // ==========================================================================

  test('syncCalciumMagnesiumOxideForms: derives CaO/MgO from elemental-only input', () => {
    const OX = window.FertilizerCore.OXIDE_CONVERSIONS;
    const result = window.FertilizerCore.syncCalciumMagnesiumOxideForms({ Ca: 100, Mg: 50 });
    assertEqual(result.Ca, 100, 'Ca unchanged when no CaO present');
    assertEqual(result.Mg, 50, 'Mg unchanged when no MgO present');
    assertApprox(result.CaO, 100 / OX.CaO_to_Ca, 0.01, 'CaO derived from elemental Ca');
    assertApprox(result.MgO, 50 / OX.MgO_to_Mg, 0.01, 'MgO derived from elemental Mg');
  });

  test('syncCalciumMagnesiumOxideForms: derives elemental Ca/Mg from oxide-only input', () => {
    const OX = window.FertilizerCore.OXIDE_CONVERSIONS;
    const result = window.FertilizerCore.syncCalciumMagnesiumOxideForms({ CaO: 80, MgO: 110 });
    assertEqual(result.CaO, 80, 'CaO unchanged when no elemental Ca present');
    assertEqual(result.MgO, 110, 'MgO unchanged when no elemental Mg present');
    assertApprox(result.Ca, 80 * OX.CaO_to_Ca, 0.01, 'Ca derived from CaO');
    assertApprox(result.Mg, 110 * OX.MgO_to_Mg, 0.01, 'Mg derived from MgO');
  });

  test('syncCalciumMagnesiumOxideForms: sums both directions when elemental and oxide are both already present', () => {
    const OX = window.FertilizerCore.OXIDE_CONVERSIONS;
    const result = window.FertilizerCore.syncCalciumMagnesiumOxideForms({ Ca: 100, CaO: 80, Mg: 50, MgO: 110 });
    assertApprox(result.Ca, 100 + 80 * OX.CaO_to_Ca, 0.01, 'Ca = direct Ca + CaO-derived Ca');
    assertApprox(result.CaO, 80 + 100 / OX.CaO_to_Ca, 0.01, 'CaO = direct CaO + Ca-derived CaO');
    assertApprox(result.Mg, 50 + 110 * OX.MgO_to_Mg, 0.01, 'Mg = direct Mg + MgO-derived Mg');
    assertApprox(result.MgO, 110 + 50 / OX.MgO_to_Mg, 0.01, 'MgO = direct MgO + Mg-derived MgO');
  });

  test('syncCalciumMagnesiumOxideForms: leaves an all-zero/empty object at zero', () => {
    const result = window.FertilizerCore.syncCalciumMagnesiumOxideForms({});
    assertEqual(result.Ca, 0, 'Ca defaults to 0');
    assertEqual(result.CaO, 0, 'CaO defaults to 0');
    assertEqual(result.Mg, 0, 'Mg defaults to 0');
    assertEqual(result.MgO, 0, 'MgO defaults to 0');
  });

  test('accumulateAchievedPPM: populates CaO/MgO for a fertilizer that only declares elemental Ca/Mg', () => {
    // Mirrors how P/P2O5 and K/K2O are already kept in sync, so oxide-mode displays
    // (Results grid, formula-builder/reverse comparisons, two-tank badges) always have a
    // CaO/MgO value even when every selected fertilizer declares only elemental Ca/Mg.
    const OX = window.FertilizerCore.OXIDE_CONVERSIONS;
    const achieved = window.FertilizerCore.accumulateAchievedPPM(
      [{ id: 'custom_ca_mg_elemental', pct: { Ca: 10, Mg: 5 } }],
      { custom_ca_mg_elemental: 10 },
      1
    );
    assertApprox(achieved.Ca, 1000, 0.01, 'Ca ppm (direct)');
    assertApprox(achieved.Mg, 500, 0.01, 'Mg ppm (direct)');
    assertApprox(achieved.CaO, 1000 / OX.CaO_to_Ca, 0.1, 'CaO derived from elemental Ca');
    assertApprox(achieved.MgO, 500 / OX.MgO_to_Mg, 0.1, 'MgO derived from elemental Mg');
  });

  test('accumulateAchievedPPM: populates Ca/Mg for a fertilizer that only declares oxide CaO/MgO', () => {
    const OX = window.FertilizerCore.OXIDE_CONVERSIONS;
    const achieved = window.FertilizerCore.accumulateAchievedPPM(
      [{ id: 'custom_ca_mg_oxide', pct: { CaO: 8, MgO: 11 } }],
      { custom_ca_mg_oxide: 10 },
      1
    );
    assertApprox(achieved.CaO, 800, 0.01, 'CaO ppm (direct)');
    assertApprox(achieved.MgO, 1100, 0.01, 'MgO ppm (direct)');
    assertApprox(achieved.Ca, 800 * OX.CaO_to_Ca, 0.1, 'Ca derived from CaO');
    assertApprox(achieved.Mg, 1100 * OX.MgO_to_Mg, 0.1, 'Mg derived from MgO');
  });

  test('accumulateAchievedPPM: sums Ca/CaO contributions across fertilizers declaring different forms', () => {
    const OX = window.FertilizerCore.OXIDE_CONVERSIONS;
    const achieved = window.FertilizerCore.accumulateAchievedPPM(
      [
        { id: 'custom_ca_elemental', pct: { Ca: 10 } },
        { id: 'custom_ca_oxide', pct: { CaO: 8 } }
      ],
      { custom_ca_elemental: 10, custom_ca_oxide: 10 },
      1
    );
    assertApprox(achieved.Ca, 1000 + 800 * OX.CaO_to_Ca, 0.1, 'Ca = direct Ca + CaO-derived Ca');
    assertApprox(achieved.CaO, 800 + 1000 / OX.CaO_to_Ca, 0.1, 'CaO = direct CaO + Ca-derived CaO');
  });

  // ==========================================================================
  // solveDosing Tests
  // ==========================================================================

  test('solveDosing: Achieves target EC', async () => {
    // Use calcium nitrate only - ratio is determined by its N:Ca content (~0.8:1)
    const tanks = {
      A: { 'calcium_nitrate_calcinit_typical': 150 }
    };
    const target = {
      // Calcium nitrate has N:Ca ≈ 15.5:19 ≈ 0.82:1, use this achievable ratio
      ratio: { N: 0.82, P: 0, K: 0, Ca: 1, Mg: 0 },
      targetEC: 1.5,
      baselineEC: 0
    };

    const result = window.FertilizerCore.solveDosing(tanks, target, { maxDosing: 50 });

    assert(result.feasible, 'Should be feasible');
    assertApprox(result.predictedEC, 1.5, 0.2, 'EC should be close to target');
    assert(result.dosing.A > 0, 'Tank A dosing > 0');

    // At this EC, calcium nitrate's fixed N:Ca composition should land on N~436.7, Ca~535.3.
    assertApprox(result.achieved.N, 436.7, 15, 'Achieved N ppm');
    assertApprox(result.achieved.Ca, 535.3, 15, 'Achieved Ca ppm');

    const formula = finalFormulaFromTanksDosing(tanks, result.dosing);
    const ionBalance = window.FertilizerCore.calculateIonBalanceCore(formula, 1);
    assertApprox(ionBalance.totalCations, 28.7, 1, 'Total cations meq/L');
    assertApprox(ionBalance.totalAnions, 28.7, 1, 'Total anions meq/L');
    assertApprox(ionBalance.imbalance, 0, 0.01, 'Ion balance should be ~0 (single N-only fertilizer)');
  });

  test('solveDosing: Fails when EC below baseline', () => {
    const tanks = {
      A: { 'calcium_nitrate_calcinit_typical': 100 }
    };
    const target = {
      ratio: { N: 1, Ca: 1 },
      targetEC: 0.3,
      baselineEC: 0.5
    };

    const result = window.FertilizerCore.solveDosing(tanks, target);

    assert(!result.feasible, 'Should be infeasible');
    assert(result.issues.some(i => i.code === 'EC_UNACHIEVABLE'), 'Should have EC error');
  });

  test('solveDosing: 3-tank system (Ca / P+Mg / K) solves a veg ratio', async () => {
    // Real 3-tank rig: Tank A isolates Calcium Nitrate (precipitates with phosphate/sulfate),
    // Tank B combines MKP + Epsom salt (both compatible with each other), Tank C carries
    // Potassium Nitrate for independent K control. This exercises the 3-tank dosing search
    // (_searchThreeTankRatios), not just the 2-tank path the other solveDosing tests cover.
    const formula = {
      calcium_nitrate_calcinit_typical: 200,
      mkp_typical: 80,
      potassium_nitrate_typical: 150,
      magnesium_sulfate_heptahydrate_common: 100
    };
    const tanks = window.FertilizerCore.assignToTanks(formula, 3);
    assertHasKey(tanks.A, 'calcium_nitrate_calcinit_typical', 'Ca source isolated in Tank A');
    assertHasKey(tanks.B, 'mkp_typical', 'MKP in Tank B');
    assertHasKey(tanks.B, 'magnesium_sulfate_heptahydrate_common', 'Epsom salt shares Tank B with MKP');
    assertHasKey(tanks.C, 'potassium_nitrate_typical', 'KNO3 isolated in Tank C for K control');

    const target = { ratio: { N: 1, P: 0.35, K: 1.2, Ca: 1.2 }, targetEC: 1.8 };
    const result = window.FertilizerCore.solveDosing(tanks, target, { maxDosing: 50 });

    assert(result.feasible, 'Should be feasible with this 3-tank layout and ratio');
    assertApprox(result.predictedEC, 1.8, 0.15, 'EC should be close to target');
    assertApprox(result.achieved.N, 276.6, 20, 'Achieved N ppm');
    assertApprox(result.achieved.K, 278.9, 20, 'Achieved K ppm');
    assertApprox(result.achieved.Ca, 264.8, 20, 'Achieved Ca ppm');
  });

  test('solveDosing: 4-tank system separates Mg from P for independent Cal-Mag control', async () => {
    // Real 4-tank rig used when P:Mg needs to vary independently across grow stages: the
    // separateMg option pulls Epsom salt into its own Tank D instead of sharing Tank B with
    // MKP. Exercises the 4+-tank dosing search (_searchFourPlusTankRatios).
    const formula = {
      calcium_nitrate_calcinit_typical: 200,
      mkp_typical: 80,
      potassium_nitrate_typical: 150,
      magnesium_sulfate_heptahydrate_common: 100
    };
    const tanks = window.FertilizerCore.assignToTanks(formula, 4, { separateMg: true });
    assertHasKey(tanks.A, 'calcium_nitrate_calcinit_typical', 'Ca source in Tank A');
    assertHasKey(tanks.B, 'mkp_typical', 'MKP alone in Tank B');
    assertHasKey(tanks.C, 'potassium_nitrate_typical', 'KNO3 in Tank C');
    assertHasKey(tanks.D, 'magnesium_sulfate_heptahydrate_common', 'Epsom salt separated into Tank D');

    const target = { ratio: { N: 1.5, P: 0.4, K: 1.8, Ca: 1.8, Mg: 0.25 }, targetEC: 2.0 };
    const result = window.FertilizerCore.solveDosing(tanks, target, { maxDosing: 50 });

    assert(result.feasible, 'Should be feasible with independent Mg control');
    assertApprox(result.predictedEC, 2.0, 0.15, 'EC should be close to target');
    assertApprox(result.achieved.Mg, 47.6, 10, 'Achieved Mg ppm');
    assertApprox(result.achieved.Ca, 297.0, 25, 'Achieved Ca ppm');
  });

  test('solveDosing: 2-tank system hits an achievable K:Ca ratio', () => {
    // Real 2-tank rig: Tank A isolates Calcium Nitrate, Tank B is Potassium Nitrate alone.
    // A K:Ca-only ratio target has exactly 1 degree of freedom (the A:B dosing ratio), which
    // 2 tanks can satisfy exactly. Exercises the 2-tank dosing search (_searchTwoTankRatios),
    // which none of the other solveDosing tests reach (the EC-only test uses 1 tank; the 3-
    // and 4-tank tests use 3+ tanks).
    const formula = { calcium_nitrate_calcinit_typical: 200, potassium_nitrate_typical: 150 };
    const tanks = window.FertilizerCore.assignToTanks(formula, 2);
    assertHasKey(tanks.A, 'calcium_nitrate_calcinit_typical', 'Ca source in Tank A');
    assertHasKey(tanks.B, 'potassium_nitrate_typical', 'KNO3 in Tank B');

    const target = { ratio: { K: 1, Ca: 1 }, targetEC: 1.6 };
    const result = window.FertilizerCore.solveDosing(tanks, target, { maxDosing: 50 });

    assert(result.feasible, 'A pure K:Ca ratio is achievable with 2 tanks');
    assertApprox(result.predictedEC, 1.6, 0.1, 'EC should be close to target');
    assertApprox(result.achieved.K, 352.1, 15, 'Achieved K ppm');
    assertApprox(result.achieved.Ca, 348.2, 15, 'Achieved Ca ppm');
  });

  test('solveDosing: 2-tank system flags RATIO_MISMATCH when P and K cannot be independently controlled', () => {
    // Real limitation: MKP and Potassium Nitrate combined into Tank B means P and K can only be
    // scaled together, not independently. A 3-nutrient target (N/K from KNO3 side, P from MKP,
    // Ca fixed) has 2 independent ratios to satisfy but only 1 free dosing parameter (A:B), so
    // it's structurally unreachable with 2 tanks - this is exactly why the real 3-tank test
    // above isolates KNO3 into its own tank instead.
    const formula = {
      calcium_nitrate_calcinit_typical: 200,
      mkp_typical: 80,
      potassium_nitrate_typical: 150
    };
    const tanks = window.FertilizerCore.assignToTanks(formula, 2);
    assertHasKey(tanks.B, 'mkp_typical', 'MKP in Tank B');
    assertHasKey(tanks.B, 'potassium_nitrate_typical', 'KNO3 shares Tank B with MKP at 2 tanks');

    const target = { ratio: { N: 1, P: 0.35, K: 1.2, Ca: 1.2 }, targetEC: 1.8 };
    const result = window.FertilizerCore.solveDosing(tanks, target, { maxDosing: 50 });

    assert(!result.feasible, '2 tanks cannot hit this 3-nutrient ratio independently');
    assert(result.issues.some(i => i.code === 'RATIO_MISMATCH'), 'Should flag a ratio mismatch');
  });

  test('solveDosing: dosing-volume warnings and errors scale with maxDosing', () => {
    // Same achievable K:Ca scenario as above (~15.3 mL/L total dosing at this target EC), but
    // sweeping maxDosing across the HIGH_DOSING_VOLUME (>80%) and DOSING_EXCEEDS_MAX thresholds.
    const formula = { calcium_nitrate_calcinit_typical: 200, potassium_nitrate_typical: 150 };
    const tanks = window.FertilizerCore.assignToTanks(formula, 2);
    const target = { ratio: { K: 1, Ca: 1 }, targetEC: 1.6 };

    const nearLimit = window.FertilizerCore.solveDosing(tanks, target, { maxDosing: 16 });
    assert(nearLimit.feasible, 'Still feasible when just under the max');
    assert(nearLimit.issues.some(i => i.code === 'HIGH_DOSING_VOLUME'), 'Should warn when dosing is >80% of max');

    const overLimit = window.FertilizerCore.solveDosing(tanks, target, { maxDosing: 10 });
    assert(!overLimit.feasible, 'Infeasible once required dosing exceeds the max');
    assert(overLimit.issues.some(i => i.code === 'DOSING_EXCEEDS_MAX'), 'Should error when dosing exceeds max');
  });

  test('solveDosing: NO_FERTILIZERS when every tank is empty', () => {
    const result = window.FertilizerCore.solveDosing(
      { A: {}, B: {} },
      { ratio: { K: 1, Ca: 1 }, targetEC: 1.6 }
    );
    assert(!result.feasible, 'Should be infeasible with no fertilizers in any tank');
    assert(result.issues.some(i => i.code === 'NO_FERTILIZERS'), 'Should report NO_FERTILIZERS');
  });

  test('solveDosing: RATIO_MISMATCH when no tank supplies any of the target nutrients at all', () => {
    // Tanks have fertilizers, but neither supplies Mg - every dosing candidate the ratio search
    // tries ends up with achieved.Mg === 0 for the only target nutrient. Exercises
    // _makeRatioErrorFn's "no target nutrient ever came out nonzero" Infinity early return.
    const tanks = {
      A: { calcium_nitrate_calcinit_typical: 100 },
      B: { potassium_nitrate_typical: 100 }
    };
    const result = window.FertilizerCore.solveDosing(tanks, { ratio: { Mg: 1 }, targetEC: 1.5 }, {});
    assert(!result.feasible, 'Cannot match a ratio for a nutrient nothing supplies');
    assert(result.issues.some(i => i.code === 'RATIO_MISMATCH'), 'Should report RATIO_MISMATCH');
  });

  test('solveDosing: RATIO_MISMATCH when only some target nutrients are ever achieved', () => {
    // N is supplied by both tanks, but Mg is supplied by neither - exercises
    // _makeRatioErrorFn's per-nutrient (achieved[n] || 0) fallback for the nutrient that stays
    // at 0 while N (achievedNonZero) keeps the function past its Infinity early return.
    const tanks = {
      A: { calcium_nitrate_calcinit_typical: 100 },
      B: { potassium_nitrate_typical: 100 }
    };
    const result = window.FertilizerCore.solveDosing(tanks, { ratio: { N: 1, Mg: 1 }, targetEC: 1.5 }, {});
    assert(!result.feasible, 'Cannot match a ratio requiring Mg when nothing supplies it');
    assert(result.issues.some(i => i.code === 'RATIO_MISMATCH'), 'Should report RATIO_MISMATCH');
  });

  test('solveDosing: EC_MISMATCH when the dosing cap prevents reaching target EC', () => {
    // A single, very concentrated tank pushed against the default 50 mL/L dosing cap: the
    // scaling step in _scaleDosingToTargetEC wants to dose far more than maxDosing allows, so
    // _buildDosingIssues' final EC check (predictedEC vs targetEC) can't be satisfied even
    // though DOSING_EXCEEDS_MAX already caps the achievable dosing.
    const tanks = { A: { calcium_nitrate_calcinit_typical: 100 } };
    const target = { ratio: { Ca: 1 }, targetEC: 5.0 };

    const result = window.FertilizerCore.solveDosing(tanks, target, {});
    assert(!result.feasible, 'Capped dosing cannot reach this target EC');
    assert(result.issues.some(i => i.code === 'DOSING_EXCEEDS_MAX'), 'Dosing should be capped');
    assert(result.issues.some(i => i.code === 'EC_MISMATCH'), 'Predicted EC should miss target by more than 5%');
  });

  // ==========================================================================
  // calculateStockSolutions Tests (Full Integration)
  // ==========================================================================

  test('calculateStockSolutions: Includes solubility percentage', async () => {
    // Potassium nitrate has N:K ≈ 13.7:38.2 ≈ 1:2.8
    // Use a ratio that matches what KNO3 can actually produce
    const options = {
      targets: [
        {
          id: 'test',
          ratio: { N: 1, P: 0, K: 2.8, Ca: 0, Mg: 0 },
          targetEC: 2.0
        }
      ],
      availableFertilizers: ['potassium_nitrate_typical'],
      stockConcentration: 100,
      stockTankVolumeL: 20
    };

    const result = await window.FertilizerCore.calculateStockSolutions(options);

    assert(result.success, 'Should succeed');

    // Check that solubility_pct is calculated
    for (const tank of Object.values(result.tanks)) {
      for (const fertData of Object.values(tank.fertilizers)) {
        assertHasKey(fertData, 'solubility_pct', 'Should have solubility_pct');
        assert(fertData.solubility_pct > 0, 'Solubility pct > 0');
      }
    }

    // KNO3 alone at this target EC: achieved N~393.1, K~1102.7 (its fixed 1:2.8 N:K).
    const dosing = result.dosing.find(d => d.targetId === 'test');
    assertApprox(dosing.predicted.nutrients.N, 393.1, 15, 'Achieved N ppm');
    assertApprox(dosing.predicted.nutrients.K, 1102.7, 30, 'Achieved K ppm');

    const tanks = {};
    const dosingML = {};
    for (const [tankId, tank] of Object.entries(result.tanks)) {
      tanks[tankId] = {};
      for (const [fertId, fertData] of Object.entries(tank.fertilizers)) {
        tanks[tankId][fertId] = fertData.grams_per_L;
      }
      dosingML[tankId] = dosing.tanks[tankId].mL_per_L;
    }
    const formula = finalFormulaFromTanksDosing(tanks, dosingML);
    const ionBalance = window.FertilizerCore.calculateIonBalanceCore(formula, 1);
    assertApprox(ionBalance.totalCations, 28.4, 1, 'Total cations meq/L (K+)');
    assertApprox(ionBalance.totalAnions, 28.4, 1, 'Total anions meq/L (NO3-)');
    assertApprox(ionBalance.imbalance, 0, 0.01, 'Ion balance should be ~0 (single N-only source)');
  });

  test('calculateStockSolutions: 1:6:6 (N-P2O5-K2O) ratio via AN + MKP + K2SO4', async () => {
    // "1:6:6" as a grower would write it is the standard N-P2O5-K2O (oxide) label - that's
    // what the target ratio means in optimizeFormula's default 'oxide' mode. solveDosing
    // (which calculateStockSolutions uses) has no such mode: it treats ratio.P/K as
    // ELEMENTAL P/K directly. So the oxide ratio must be converted before use here, or the
    // solver ends up targeting a very different (much more P/K-heavy) composition.
    const P2O5_to_P = window.FertilizerCore.OXIDE_CONVERSIONS.P2O5_to_P;
    const K2O_to_K = window.FertilizerCore.OXIDE_CONVERSIONS.K2O_to_K;
    const elementalRatio = { N: 1, P: 6 * P2O5_to_P, K: 6 * K2O_to_K };

    const options = {
      targets: [
        {
          id: 'bloom',
          ratio: elementalRatio,
          targetEC: 2.0
        }
      ],
      availableFertilizers: [
        'ammonium_nitrate_common',
        'mkp_typical',
        'potassium_sulfate_common'
      ],
      stockConcentration: 100,
      stockTankVolumeL: 20
    };

    const result = await window.FertilizerCore.calculateStockSolutions(options);

    assert(result.success, 'Should succeed');

    const dosing = result.dosing.find(d => d.targetId === 'bloom');
    assert(dosing, 'Should have dosing for bloom target');

    // This is a well-known bloom fertigation recipe (MKP + AN + K2SO4 for 1:6:6), so unlike
    // ratios that are structurally unreachable with their fertilizer set, this one is
    // achievable close to exactly - a modest tolerance is still used since it's MILP output,
    // not a hand-solved linear system.
    const achieved = dosing.predicted.nutrients;
    const achievedKN = achieved.K / achieved.N;
    const achievedPN = achieved.P / achieved.N;

    assertApprox(achievedKN, elementalRatio.K / elementalRatio.N, 0.3, 'K:N ratio should match target closely (±0.3)');
    assertApprox(achievedPN, elementalRatio.P / elementalRatio.N, 0.3, 'P:N ratio should match target closely (±0.3)');

    // Also check absolute achieved PPM (ratios alone can't catch an overall-scale bug).
    assertApprox(achieved.N, 137.4, 10, 'Achieved N ppm');
    assertApprox(achieved.P, 367.0, 25, 'Achieved P ppm');
    assertApprox(achieved.K, 684.2, 40, 'Achieved K ppm');
    assertApprox(achieved.S, 93.3, 15, 'Achieved S ppm (from K2SO4)');

    // Flatten grams_per_L across tanks (fertilizer -> tank assignment can shift with the solver).
    const gramsById = {};
    const dosingML = {};
    for (const [tankId, tank] of Object.entries(result.tanks)) {
      for (const [fertId, fertData] of Object.entries(tank.fertilizers)) {
        gramsById[fertId] = fertData.grams_per_L;
      }
      dosingML[tankId] = dosing.tanks[tankId].mL_per_L;
    }

    const anGrams = gramsById['ammonium_nitrate_common'] || 0;
    const mkpGrams = gramsById['mkp_typical'] || 0;
    const k2so4Grams = gramsById['potassium_sulfate_common'] || 0;

    // Measured stock-solution dosing at this stockConcentration/volume/targetEC is
    // ~43.7 g/L AN, ~174.8 g/L MKP, ~59.3 g/L K2SO4. Allow a tolerance band around each
    // rather than pinning the exact MILP output.
    assertApprox(anGrams, 43.7, 10, 'Ammonium Nitrate dosing should be ~43.7 g/L (±10)');
    assertApprox(mkpGrams, 174.8, 25, 'MKP dosing should be ~174.8 g/L (±25)');
    assertApprox(k2so4Grams, 59.3, 15, 'K2SO4 dosing should be ~59.3 g/L (±15)');

    // Ion balance: NH4+ (AN) + K+ (MKP + K2SO4) as cations vs. NO3- (AN) + H2PO4- (MKP) +
    // SO4^2- (K2SO4) as anions.
    const finalFormula = finalFormulaFromTanksDosing(
      Object.fromEntries(Object.entries(result.tanks).map(([id, t]) =>
        [id, Object.fromEntries(Object.entries(t.fertilizers).map(([fid, fd]) => [fid, fd.grams_per_L]))]
      )),
      dosingML
    );
    const ionBalance = window.FertilizerCore.calculateIonBalanceCore(finalFormula, 1);
    assertApprox(ionBalance.totalCations, 23.2, 2, 'Total cations meq/L (NH4+ + K+)');
    assertApprox(ionBalance.totalAnions, 23.2, 2, 'Total anions meq/L (NO3- + H2PO4- + SO4^2-)');
    assertApprox(ionBalance.imbalance, 0, 0.01, 'Ion balance should be ~0');
  });

  test('calculateStockSolutions: reduces stock concentration when it would exceed solubility', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Real scenario: a grower asks for a very concentrated stock (300x) but Potassium Nitrate's
    // solubility (320 g/L) caps how concentrated any single stock tank can safely be. Exercises
    // the CONCENTRATION_REDUCED path in _calculateEffectiveConcentration/_tryStockSolutionWithKTanks.
    const options = {
      targets: [
        { id: 'test', ratio: { N: 1, P: 0, K: 2.8, Ca: 0, Mg: 0 }, targetEC: 2.0 }
      ],
      availableFertilizers: ['potassium_nitrate_typical'],
      stockConcentration: 300,
      stockTankVolumeL: 20
    };

    const result = await window.FertilizerCore.calculateStockSolutions(options);

    assert(result.success, 'Should still succeed at a reduced concentration');
    assertEqual(result.meta.concentrationFactor, 300, 'Requested concentration is recorded as-is');
    const reducedWarning = result.warnings.find(w => w.code === 'CONCENTRATION_REDUCED');
    assert(reducedWarning, 'Should warn that concentration was reduced');
    assertEqual(reducedWarning.details.requested, 300, 'Warning records the requested concentration');
    assert(reducedWarning.details.effective < 300, 'Effective concentration should be capped below the request');
  });

  test('calculateStockSolutions: CONCENTRATION_TOO_LOW for a low-solubility fertilizer at high EC', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Real scenario: Single Super Phosphate (SSP) is the only fertilizer providing P/Ca/S
    // together, but it has very low solubility (20 g/L - it's essentially calcium phosphate).
    // At a real target EC, the required stock concentration collapses below the practical
    // (10x) floor. Exercises the CONCENTRATION_TOO_LOW failure path.
    const options = {
      targets: [
        { id: 'test', ratio: { P: 0.7, Ca: 1, S: 0.5 }, targetEC: 3.0 }
      ],
      availableFertilizers: ['ssp_common'],
      stockConcentration: 100,
      stockTankVolumeL: 20
    };

    const result = await window.FertilizerCore.calculateStockSolutions(options);

    assert(!result.success, 'SSP alone cannot reach this EC at a usable stock concentration');
    assert(result.errors.some(e => e.code === 'CONCENTRATION_TOO_LOW'), 'Should report CONCENTRATION_TOO_LOW');
  });

  test('calculateStockSolutions: incompatible veg/bloom targets exhaust Progressive-K (2→3→4 tanks) and report infeasible', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Real scenario: sharing one set of stock tanks across a veg-stage target (high N:K, low P)
    // and a bloom-stage target (lower N, higher P and K) using only 4 fixed fertilizers. This
    // exercises the multi-target path end-to-end: _detectVaryingRatios (N:P and P:K spread
    // trigger hasVaryingNP/hasVaryingPK), _filterFertilizersForKTanks, and the full
    // Progressive-K escalation loop in calculateStockSolutions failing at K=2, K=3, and finally
    // K=4 (the maximum), returning the overall INFEASIBLE result.
    const options = {
      targets: [
        { id: 'veg', ratio: { N: 1, P: 0.2, K: 1, Ca: 1, Mg: 0.3 }, targetEC: 1.5 },
        { id: 'bloom', ratio: { N: 0.5, P: 0.6, K: 1.3, Ca: 0.8, Mg: 0.3 }, targetEC: 1.8 }
      ],
      availableFertilizers: [
        'calcium_nitrate_calcinit_typical',
        'mkp_typical',
        'potassium_nitrate_typical',
        'magnesium_sulfate_heptahydrate_common'
      ],
      stockConcentration: 100,
      stockTankVolumeL: 20
    };

    const result = await window.FertilizerCore.calculateStockSolutions(options);

    assert(!result.success, 'These 2 targets cannot both be matched by dosing alone from a fixed formula');
    assert(!result.meta, 'No successful tank configuration was found');
    assert(result.errors.length > 0, 'Should report why it failed');
    assert(
      result.errors.some(e => e.code === 'RATIO_MISMATCH' || e.code === 'OPTIMIZATION_FAILED'),
      'Failure should be a ratio-matching or optimization error, not a silent empty result'
    );
  });

  test('calculateStockSolutions: veg/bloom targets with independent P and K sources still fail dosing at every K', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Same varying-ratio veg/bloom setup as above, but swapping MKP for two single-nutrient
    // sources (Phosphoric Acid for P, Potassium Sulfate for K). Since no fertilizer here
    // carries both P and K (or both N and P), _filterFertilizersForKTanks's N/P/K coverage
    // check passes and it returns its filtered (here, unfiltered) list rather than falling
    // back to the original - exercising that success path, not just its fallback.
    const options = {
      targets: [
        { id: 'veg', ratio: { N: 1, P: 0.2, K: 1, Ca: 1 }, targetEC: 1.5 },
        { id: 'bloom', ratio: { N: 0.5, P: 0.6, K: 1.3, Ca: 0.8 }, targetEC: 1.8 }
      ],
      availableFertilizers: [
        'calcium_nitrate_calcinit_typical',
        'potassium_nitrate_typical',
        'phosphoric_acid_49',
        'potassium_sulfate_common'
      ],
      stockConcentration: 100,
      stockTankVolumeL: 20
    };

    const result = await window.FertilizerCore.calculateStockSolutions(options);

    assert(!result.success, 'These 2 targets still cannot both be matched by dosing alone');
    assert(result.errors.some(e => e.code === 'RATIO_MISMATCH'), 'Should fail on ratio matching');
  });

  test('calculateStockSolutions: a target omitting N, K, P, or Mg entirely still gets varying-ratio detection right', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // The 'veg' target below omits N, K, P, and Mg entirely (not just zero - absent), unlike
    // every other multi-target test which always sets all of N/P/K/Ca/Mg on every target.
    // Exercises _detectVaryingRatios' four `|| 0.001` fallbacks (for N, K, P, and Mg
    // respectively) when computing each spread ratio against 'bloom', which does set all of them.
    const options = {
      targets: [
        { id: 'veg', ratio: { Ca: 1 }, targetEC: 1.5 },
        { id: 'bloom', ratio: { N: 0.5, P: 0.6, K: 1.3, Ca: 0.8, Mg: 0.3 }, targetEC: 1.8 }
      ],
      availableFertilizers: [
        'calcium_nitrate_calcinit_typical',
        'mkp_typical',
        'potassium_nitrate_typical',
        'magnesium_sulfate_heptahydrate_common'
      ],
      stockConcentration: 100,
      stockTankVolumeL: 20
    };

    const result = await window.FertilizerCore.calculateStockSolutions(options);
    assert(result.errors.length > 0 || result.success, 'Should complete without crashing on a target missing K/P/Mg');
  });

  test('calculateStockSolutions: NO_VALID_FERTILIZERS when none of the requested IDs exist', async () => {
    const result = await window.FertilizerCore.calculateStockSolutions({
      targets: [{ id: 'test', ratio: { N: 1, K: 1 }, targetEC: 1.5 }],
      availableFertilizers: ['not_a_real_fertilizer_id', 'also_fake'],
      stockConcentration: 100,
      stockTankVolumeL: 20
    });

    assert(!result.success, 'Should fail with no valid fertilizers');
    assert(result.errors.some(e => e.code === 'NO_VALID_FERTILIZERS'), 'Should report NO_VALID_FERTILIZERS');
  });

  test('_tryStockSolutionWithKTanks: OPTIMIZATION_FAILED when no fertilizers are available to solve with', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // calculateStockSolutions always rejects an empty/invalid fertilizer list earlier with
    // NO_VALID_FERTILIZERS (see above), so this internal helper's own empty-formula guard -
    // reached when optimizeFormula legitimately returns nothing to solve with - is exercised
    // directly here instead.
    const result = await window.FertilizerCore._tryStockSolutionWithKTanks(
      2, [{ id: 'test', ratio: { N: 1, K: 1 }, targetEC: 1.5 }], [], 100, 20, 0
    );
    assert(!result.success, 'Should fail with no fertilizers to build a formula from');
    assert(result.errors.some(e => e.code === 'OPTIMIZATION_FAILED'), 'Should report OPTIMIZATION_FAILED');
  });

  test('assignToTanks: Silicate goes to Tank C with 3 tanks and Tank D with 4 tanks', () => {
    // Real scenario: dosing Potassium Silicate alongside Calcium Nitrate. With only 2 tanks,
    // silicate shares Tank B (assignToTanks: Neutral goes to Tank B is already covered
    // elsewhere); with 3+ tanks it gets its own tank so it isn't mixed with phosphate sources.
    const formula = {
      calcium_nitrate_calcinit_typical: 100,
      potassium_silicate_liquid_typical: 50
    };

    const twoTanks = window.FertilizerCore.assignToTanks(formula, 2);
    assertHasKey(twoTanks.B, 'potassium_silicate_liquid_typical', 'Silicate falls back to shared Tank B at 2 tanks');

    const threeTanks = window.FertilizerCore.assignToTanks(formula, 3);
    assertHasKey(threeTanks.C, 'potassium_silicate_liquid_typical', 'Silicate isolated in Tank C at 3 tanks');
    assertEqual(Object.keys(threeTanks.B).length, 0, 'Tank B should be empty (nothing else to put there)');

    const fourTanks = window.FertilizerCore.assignToTanks(formula, 4);
    assertHasKey(fourTanks.D, 'potassium_silicate_liquid_typical', 'Silicate isolated in Tank D at 4 tanks');
  });

  test('optimizeFormula (oxide mode): 3:20:20 N-P2O5-K2O matches real calculator output', async () => {
    // Reproduces the reverse-calc wizard's actual call shape (mode='oxide', volume=100L,
    // concentration=100, targetEC via options) for KNO3 + MAP + MKP, and checks the result
    // against a known-good calculator run (grams, achieved PPM, N forms, ion balance) -
    // not just success/structure.
    const ratio = { N: 3, P: 20, K: 20 };
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'map_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical')
    ].filter(Boolean);
    assertEqual(fertObjects.length, 3, 'All 3 fertilizers should be found');

    const result = await window.FertilizerCore.optimizeFormula(
      ratio, 100, fertObjects, 100, 'oxide', { targetEC: 2.0, useMilp: true }
    );

    assertHasKey(result, 'formula', 'Should have formula');
    assertHasKey(result, 'achieved', 'Should have achieved');

    // Fertilizers to Add (100L): KNO3 69.71g, MAP 15.15g, MKP 127.97g
    assertApprox(result.formula.potassium_nitrate_typical, 69.71, 2, 'Potassium Nitrate grams');
    assertApprox(result.formula.map_typical, 15.15, 2, 'MAP grams');
    assertApprox(result.formula.mkp_typical, 127.97, 3, 'MKP grams');

    // Achieved PPM: N 113.7, P2O5 757.8, K2O 757.8
    const a = result.achieved;
    assertApprox(a.N_total, 113.7, 2, 'Achieved N ppm');
    assertApprox(a.P2O5, 757.8, 5, 'Achieved P2O5 ppm');
    assertApprox(a.K2O, 757.8, 5, 'Achieved K2O ppm');

    // Nitrogen Forms: NO3-N 95.5, NH4-N 18.2 (~16% NH4)
    assertApprox(a.N_NO3, 95.5, 2, 'Achieved NO3-N ppm');
    assertApprox(a.N_NH4, 18.2, 2, 'Achieved NH4-N ppm');
    assertApprox(a.N_NH4 / a.N_total, 0.16, 0.02, 'NH4 ratio should be ~16%');

    // Ion Balance: Cations 17.61 meq/L, Anions 17.61 meq/L, balanced
    const ionBalance = window.FertilizerCore.calculateIonBalanceCore(result.formula, 100);
    assertApprox(ionBalance.totalCations, 17.61, 0.1, 'Total cations meq/L');
    assertApprox(ionBalance.totalAnions, 17.61, 0.1, 'Total anions meq/L');
    assertApprox(ionBalance.imbalance, 0, 0.05, 'Ion balance should be ~0% (balanced)');
  });

  test('optimizeFormula: nh4PctTarget solves across a range with this 8-fertilizer set', async () => {
    // Regression guard for a real HiGHS WASM crash ("null function or function signature
    // mismatch") previously triggered by this exact combination: COMMON_FERTILIZERS plus
    // Ammonium Nitrate, Potassium Sulfate (0-0-50), and Magnesium Nitrate (8 fertilizers
    // total), with nh4PctTarget set to 15/20/30/35 - a mathematically feasible problem
    // (verified by hand-solving the LP relaxation) that the solver nonetheless choked on.
    // Root cause: our vendored highs.js/highs.wasm traced back to npm `highs@1.8.0`
    // (HiGHS core ~1.8.x, from Nov 2024) - ~7 minor releases and a known MIP-presolve
    // instability window behind. Fixed by updating the vendored solver to `highs@1.15.2`.
    const targets = { N: 159.25, P: 38.76, K: 175.37, Ca: 139.65, Mg: 38.85, S: 75.36 };
    const volume = 10;
    const fertIds = [
      ...window.FertilizerCore.COMMON_FERTILIZERS,
      'ammonium_nitrate_common',
      'potassium_sulfate_common',
      'magnesium_nitrate_hexahydrate_typical'
    ];
    const fertObjects = fertIds.map(id => window.FertilizerCore.FERTILIZERS.find(f => f.id === id)).filter(Boolean);
    assertEqual(fertObjects.length, 8, 'All 8 fertilizers should be found');

    for (const nh4PctTarget of [15, 20, 25, 30, 35]) {
      const result = await window.FertilizerCore.optimizeFormula(
        targets, volume, fertObjects, 100, 'elemental', { useAbsoluteTargets: true, useMilp: true, nh4PctTarget }
      );

      assertHasKey(result, 'formula', `nh4=${nh4PctTarget}: should have formula`);
      assert(Object.keys(result.formula).length > 0, `nh4=${nh4PctTarget}: should have fertilizers in formula`);

      // Independently recompute NH4% from raw formula grams + fertilizer pct data,
      // rather than trusting result.achieved - confirms the solver actually reached the
      // requested NH4 fraction, not just that it returned without throwing.
      let manualNH4 = 0, manualNtotal = 0;
      for (const [fertId, grams] of Object.entries(result.formula)) {
        const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === fertId);
        const nh4 = ((fert.pct.N_NH4 || 0) / 100 * 1000 * grams) / volume;
        const no3 = ((fert.pct.N_NO3 || 0) / 100 * 1000 * grams) / volume;
        const urea = ((fert.pct.N_Urea || 0) / 100 * 1000 * grams) / volume;
        const hasForms = fert.pct.N_NO3 || fert.pct.N_NH4 || fert.pct.N_Urea;
        const nTotal = hasForms ? nh4 + no3 + urea : ((fert.pct.N_total || 0) / 100 * 1000 * grams) / volume;
        manualNH4 += nh4;
        manualNtotal += nTotal;
      }
      assertApprox(manualNH4 / manualNtotal * 100, nh4PctTarget, 1, `nh4=${nh4PctTarget}: achieved NH4% should match target (±1%)`);
    }
  });

  test('optimizeFormula: PeKacid capped in ratio mode is fixed and re-solved against the rest of the ratio', async () => {
    // Real scenario: a grower running a concentrated 3:20:20 bloom feed wants to acidify RO
    // water with ICL PeKacid (0-60-20) but caps it at 0.05 g/L (0.5g/10L) to avoid over-acidifying.
    // Exercises _trySolveWithFixedPekacidRatios - once the MILP pushes PeKacid to its cap, the
    // solver re-runs for the remaining fertilizers so the overall N:P:K ratio stays aligned.
    const ratio = { N: 3, P: 20, K: 20 };
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical')
    ].filter(Boolean);
    assertEqual(fertObjects.length, 4, 'All 4 fertilizers should be found');

    const result = await window.FertilizerCore.optimizeFormula(
      ratio, 10, fertObjects, 100, 'oxide', { targetEC: 2.2, pekacidMaxLimit: 0.05, useMilp: true }
    );

    assert(result.pekacidFixed, 'Should take the fixed-PeKacid-ratios path');
    assertApprox(result.formula.icl_pekacid_pk_acid, 0.5, 0.01, 'PeKacid should be fixed at its 0.05 g/L cap (0.5g/10L)');
    assertApprox(result.ecScaling.achievedEC, 2.2, 0.1, 'Achieved EC should be close to target');
    assertApprox(result.achieved.P2O5, 794.4, 15, 'Achieved P2O5 ppm');
    assertApprox(result.achieved.K2O, 810.0, 15, 'Achieved K2O ppm');
  });

  test('optimizeFormula: PeKacid capped with absolute targets stays at cap when EC scaling would drop it', async () => {
    // Real scenario: a grower dials in an absolute-PPM recipe (N:150 P2O5:250 K2O:250 Ca:150)
    // with a generous PeKacid cap for acidification, then also requests a lower target EC for
    // an early-veg dilution of the same recipe. Naively scaling everything down would also
    // scale PeKacid below its cap, undermining the acidification. Exercises
    // _rerunKeepingPekacidAtCapIfScalingWouldDropIt, which fixes PeKacid at its cap and
    // re-solves the rest of the fertilizers instead of letting it shrink.
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical')
    ].filter(Boolean);

    const targets = { N: 150, P: 250, K: 250, Ca: 150 };
    const result = await window.FertilizerCore.optimizeFormula(
      targets, 10, fertObjects, 100, 'oxide',
      { useAbsoluteTargets: true, pekacidMaxLimit: 0.15, targetEC: 0.969178696654033, useMilp: true }
    );

    assertApprox(result.formula.icl_pekacid_pk_acid, 1.5, 0.01, 'PeKacid should stay pinned at its 0.15 g/L cap (1.5g/10L)');
    assertApprox(result.ecScaling.achievedEC, 0.974, 0.05, 'Achieved EC should land near the lowered target');
    assert(result.ecScaling.scaleFactor < 0.99, 'EC scaling should have wanted to scale everything down');
  });

  test('optimizeFormula: absolute targets omitting N/P/Ca still solve correctly, in both oxide and elemental mode', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Every other useAbsoluteTargets test sets all of N/P/K/Ca. Exercises
    // _buildPpmTargetsFromAbsoluteTargets' `|| 0` fallbacks for N, K, and Ca, and the P/P2O5
    // ternary's `|| 0` fallback in BOTH its oxide and elemental branches (mode is only ever
    // 'oxide' elsewhere in the absolute-targets tests) - targeting only Ca leaves N, P, and K
    // all absent.
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid')
    ].filter(Boolean);

    const oxideResult = await window.FertilizerCore.optimizeFormula(
      { Ca: 150 }, 10, fertObjects, 100, 'oxide',
      { useAbsoluteTargets: true, pekacidMaxLimit: 0.15, targetEC: 1.2, useMilp: true }
    );
    assert(oxideResult.formula.calcium_nitrate_calcinit_typical > 0, 'Oxide mode should still solve for Ca alone');

    // Companion case: target only P, leaving Ca absent this time (`|| 0` fallback for Ca).
    const noCaResult = await window.FertilizerCore.optimizeFormula(
      { P: 100 }, 10,
      [window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'), window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid')],
      100, 'oxide', { useAbsoluteTargets: true, pekacidMaxLimit: 0.05, targetEC: 1.0, useMilp: true }
    );
    assert(noCaResult.formula.mkp_typical > 0, 'Should still solve for P alone with Ca absent');

    const elementalResult = await window.FertilizerCore.optimizeFormula(
      { Ca: 150 }, 10, fertObjects, 100, 'elemental',
      { useAbsoluteTargets: true, pekacidMaxLimit: 0.15, targetEC: 1.2, useMilp: true }
    );
    assert(elementalResult.formula.calcium_nitrate_calcinit_typical > 0, 'Elemental mode should still solve for Ca alone');
  });

  test('optimizeFormula: PeKacid capped in ratio mode, elemental mode, with P omitted from the ratio', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Every other PeKacid-capped ratio-mode test uses mode='oxide' and sets P explicitly.
    // Exercises _trySolveWithFixedPekacidRatios' solveForScale: the mode==='elemental' branches
    // of its P2O5/K2O ternaries, and the resulting NaN (targetRatios.P is undefined, so
    // normalizedRatios.P is NaN) falling back to 0 via `(targets.P2O5 || 0) - pekacidP2O5_ppm`.
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical')
    ].filter(Boolean);

    const result = await window.FertilizerCore.optimizeFormula(
      { N: 3, K: 20 }, 10, fertObjects, 100, 'elemental',
      { targetEC: 2.2, pekacidMaxLimit: 0.05, useMilp: true }
    );

    assert(result.pekacidFixed, 'Should take the fixed-PeKacid-ratios path');
    assertApprox(result.formula.icl_pekacid_pk_acid, 0.5, 0.01, 'PeKacid should be fixed at its 0.05 g/L cap');
  });

  test('optimizeFormula: PeKacid capped in ratio mode, with K omitted from the ratio', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Companion to the P-omitted case above: exercises solveForScale's K2O `|| 0` fallback
    // instead (targetRatios.K undefined here, rather than targetRatios.P).
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical')
    ].filter(Boolean);

    const result = await window.FertilizerCore.optimizeFormula(
      { N: 3, P: 20 }, 10, fertObjects, 100, 'oxide',
      { targetEC: 2.2, pekacidMaxLimit: 0.05, useMilp: true }
    );

    assert(result.pekacidFixed, 'Should take the fixed-PeKacid-ratios path');
    assertApprox(result.formula.icl_pekacid_pk_acid, 0.5, 0.01, 'PeKacid should be fixed at its 0.05 g/L cap');
  });

  test('optimizeFormula: a small EC reduction keeps PeKacid at cap without needing a full MILP re-run', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Same absolute-targets/PeKacid-cap setup as the "stays at cap" test above, but with a much
    // smaller EC reduction (~4%, vs. that test's much larger drop). Exercises
    // _rerunKeepingPekacidAtCapIfScalingWouldDropIt's "scaling barely touches PeKacid - not
    // worth a full re-run" early return (scaledPekacid still >= 95% of the cap), which falls
    // through to the general EC-scaling path (which independently keeps PeKacid pinned at cap).
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical')
    ].filter(Boolean);

    const targets = { N: 150, P: 250, K: 250, Ca: 150 };
    const result = await window.FertilizerCore.optimizeFormula(
      targets, 10, fertObjects, 100, 'oxide',
      { useAbsoluteTargets: true, pekacidMaxLimit: 0.15, targetEC: 1.55, useMilp: true }
    );

    assertApprox(result.formula.icl_pekacid_pk_acid, 1.5, 0.01, 'PeKacid should stay pinned at its cap');
    assertApprox(result.ecScaling.achievedEC, 1.55, 0.05, 'Achieved EC should land near the slightly-lowered target');
  });

  test('optimizeFormula: absolute targets omitting P still re-run correctly when EC scaling would drop PeKacid below cap', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Same large-EC-reduction rerun as the "stays at cap" test, but with P omitted from the
    // targets. Exercises _rerunKeepingPekacidAtCapIfScalingWouldDropIt's `ppmTargets.P2O5 || 0`
    // fallbacks (both in the adjusted-target calculation and its dev-log message) - every other
    // rerun-triggering test sets P explicitly.
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical')
    ].filter(Boolean);

    const targets = { N: 150, K: 250, Ca: 150 };
    const result = await window.FertilizerCore.optimizeFormula(
      targets, 10, fertObjects, 100, 'oxide',
      { useAbsoluteTargets: true, pekacidMaxLimit: 0.15, targetEC: 0.969178696654033, useMilp: true }
    );

    assertApprox(result.formula.icl_pekacid_pk_acid, 1.5, 0.01, 'PeKacid should stay pinned at its 0.15 g/L cap');
    assertApprox(result.ecScaling.achievedEC, 0.974, 0.05, 'Achieved EC should land near the lowered target');
  });

  test('optimizeFormula: absolute targets omitting N and K still re-run correctly when EC scaling would drop PeKacid below cap', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Companion to the P-omitted rerun test above: omits N and K instead, exercising the
    // rerun's `ppmTargets.K2O || 0` fallback and the dev-log message's `adjustedTargets.N_total
    // || 0` fallback (both always had a real value in every other rerun-triggering test).
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical')
    ].filter(Boolean);

    const targets = { P: 250, Ca: 150 };
    const result = await window.FertilizerCore.optimizeFormula(
      targets, 10, fertObjects, 100, 'oxide',
      { useAbsoluteTargets: true, pekacidMaxLimit: 0.15, targetEC: 0.6526341696444227, useMilp: true }
    );

    assertApprox(result.formula.icl_pekacid_pk_acid, 1.5, 0.01, 'PeKacid should stay pinned at its 0.15 g/L cap');
    assertApprox(result.ecScaling.achievedEC, 0.65, 0.05, 'Achieved EC should land near the lowered target');
  });

  test('optimizeFormula: Si target converges using Potassium Silicate', async () => {
    // Real scenario: a grower dosing Potassium Silicate (Pro-TeKt style, 12% Si/18% K2O) for
    // cell-wall strength alongside a standard 3:1:2 veg ratio, targeting 30ppm Si. Exercises
    // _convergeSiTarget, which iteratively re-solves the MILP with an adjusted Si target until
    // the achieved Si lands within 10% of what was requested.
    const ratio = { N: 3, P: 1, K: 2, Ca: 1, Mg: 0.4, Si: 30 };
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'magnesium_sulfate_heptahydrate_common'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_silicate_liquid_typical')
    ].filter(Boolean);
    assertEqual(fertObjects.length, 5, 'All 5 fertilizers should be found');

    const result = await window.FertilizerCore.optimizeFormula(
      ratio, 10, fertObjects, 100, 'oxide', { targetEC: 1.8, useMilp: true }
    );

    assert(result.formula.potassium_silicate_liquid_typical > 0, 'Should use Potassium Silicate');
    assertApprox(result.achieved.Si, 30, 3, 'Achieved Si should converge within 10% of target (±3ppm)');
    assertApprox(result.ecScaling.achievedEC, 1.8, 0.1, 'Achieved EC should be close to target');
  });

  test('optimizeFormula: a Si target with no Si-supplying fertilizer available stays at 0 without crashing', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Same ratio as the Si-convergence test above, but without Potassium Silicate in the
    // fertilizer set - achieved Si can never rise above 0. Exercises _convergeSiTarget's
    // `scaledAchieved.Si || 0` fallbacks (both the initial bestSiError computation and the
    // per-iteration achievedSi) and its "achievedSi > 0 ? ... : 2" adjustment-ratio fallback,
    // none of which fire when Si is actually being achieved.
    const ratio = { N: 3, P: 1, K: 2, Ca: 1, Mg: 0.4, Si: 30 };
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'magnesium_sulfate_heptahydrate_common')
    ].filter(Boolean);

    const result = await window.FertilizerCore.optimizeFormula(
      ratio, 10, fertObjects, 100, 'oxide', { targetEC: 1.8, useMilp: true }
    );

    assertEqual(result.achieved.Si, 0, 'Nothing in this fertilizer set can supply Si');
    assertApprox(result.ecScaling.achievedEC, 1.8, 0.1, 'EC scaling should still converge normally');
  });

  test('optimizeFormula: skips EC scaling entirely when the base MILP result has no EC to scale from', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // An all-zero ratio has nothing to solve for, so the MILP returns an empty formula with
    // zero achieved EC. Exercises _applyTargetEcScaling's early-out: with no baseline EC, there
    // is nothing to scale, so it returns the raw (empty) result untouched instead of scaling.
    const fertObjects = [window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical')];
    const result = await window.FertilizerCore.optimizeFormula(
      { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 }, 10, fertObjects, 100, 'oxide', { targetEC: 1.5, useMilp: true }
    );

    assertEqual(Object.keys(result.formula).length, 0, 'Nothing to dose for an all-zero ratio');
    assert(!result.ecScaling, 'Should skip EC scaling rather than dividing by a zero baseline EC');
  });

  test('optimizeFormula: an all-zero ratio still fills a capped PeKacid to its limit and skips ratio-based EC scaling', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Same all-zero ratio as above, but with PeKacid capped: the MILP's objective penalizes
    // NOT filling PeKacid to its cap (a 10000-weight "use the full limit" incentive) far more
    // than it penalizes the resulting untargeted P2O5/K2O overshoot, so PeKacid gets dosed to
    // its cap even though nothing was actually asked for. That gives _trySolveWithFixedPekacidRatios
    // a nonzero PeKacid to fix at cap, but nothing to build a ratio from (every ratio nutrient
    // is 0) - exercising its empty-ratioValues early return, which hands back the raw MILP
    // result untouched (no ecScaling, no pekacidFixed) instead of dividing by a zero minRatio.
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical')
    ].filter(Boolean);

    const result = await window.FertilizerCore.optimizeFormula(
      { N: 0, P: 0, K: 0, Ca: 0, Mg: 0, S: 0 }, 10, fertObjects, 100, 'oxide',
      { targetEC: 1.5, pekacidMaxLimit: 0.05, useMilp: true }
    );

    assertApprox(result.formula.icl_pekacid_pk_acid, 0.5, 0.01, 'PeKacid should still be filled to its 0.05 g/L cap (0.5g/10L)');
    assert(!result.ecScaling, 'Should skip ratio-based EC scaling with nothing in the ratio to scale');
    assert(!result.pekacidFixed, 'Should return the raw MILP result, not the fixed-PeKacid-ratios path');
  });

  test('optimizeFormula: EC search picks the closer endpoint when neither end of the widening search reaches target EC', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // With PeKacid capped and the fertilizer set maxed out, a high enough target EC (here 10
    // mS/cm at 10L) is unreachable however far the widening search doubles the scale - both
    // ends land below target. Exercises _trySolveWithFixedPekacidRatios picking whichever of
    // its two endpoints landed closer to target (the high end here) once widening gives up,
    // rather than only ever taking the low end.
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical')
    ].filter(Boolean);

    const result = await window.FertilizerCore.optimizeFormula(
      { N: 3, P: 20, K: 20 }, 1, fertObjects, 10, 'oxide', { targetEC: 10, pekacidMaxLimit: 0.05, useMilp: true }
    );

    assert(result.pekacidFixed, 'Should take the fixed-PeKacid-ratios path');
    assert(result.ecScaling.achievedEC < 10, 'Target EC should be unreachable given this fertilizer set');
  });

  // ==========================================================================
  // MILP Robustness / Dev-Log Tests
  // ==========================================================================

  test('solveMilpBrowser: dev-log hook receives messages and flushes ones queued before it existed', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // The UI's dev-log panel installs globalThis.addDevLog after the app boots; any solver
    // calls made before that (or when the panel is closed) queue into _pendingDevLogs and get
    // flushed the next time addDevLog is available. Real hook used by the calculator's debug
    // console, not test-only scaffolding.
    const kno3 = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical');
    delete globalThis.addDevLog;
    globalThis._pendingDevLogs = [];

    await window.FertilizerCore.solveMilpBrowser({
      fertilizers: [kno3], targets: { N_total: 150, K2O: 500 }, volume: 1
    });
    assert(globalThis._pendingDevLogs.length > 0, 'Logs should queue when addDevLog is not set');

    const captured = [];
    globalThis.addDevLog = (msg, type) => captured.push({ msg, type });
    try {
      await window.FertilizerCore.solveMilpBrowser({
        fertilizers: [kno3], targets: { N_total: 150, K2O: 500 }, volume: 1
      });
      assert(captured.length > 0, 'Queued + new logs should flush through addDevLog');
      assertEqual(globalThis._pendingDevLogs.length, 0, 'Pending queue should be drained after flush');
    } finally {
      delete globalThis.addDevLog;
      delete globalThis._pendingDevLogs;
    }
  });

  test('solveMilpBrowser: warns when a PeKacid cap is set but PeKacid is not among the selected fertilizers', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    const kno3 = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical');
    const captured = [];
    globalThis.addDevLog = (msg, type) => captured.push({ msg, type });
    try {
      await window.FertilizerCore.solveMilpBrowser({
        fertilizers: [kno3], targets: { N_total: 150, K2O: 500 }, volume: 1, pekacidMaxLimit: 5
      });
      assert(
        captured.some(l => l.msg.includes('PeKacid limit set but PeKacid not in selected fertilizers')),
        'Should warn that the PeKacid cap has no effect without PeKacid selected'
      );
    } finally {
      delete globalThis.addDevLog;
    }
  });

  test('solveMilpBrowser: a fertilizer object with no name falls back to its id in dev-log output', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // shortName() prefers fert.name, falling back to fert.id when name is absent - every real
    // FERTILIZERS entry has a name, so this only exercises with a fabricated fertilizer.
    const result = await window.FertilizerCore.solveMilpBrowser({
      fertilizers: [{ id: 'custom_no_name', pct: { N_total: 20 } }],
      targets: { N_total: 100 },
      volume: 10
    });
    assert(result.formula.custom_no_name > 0, 'Should still solve normally with an unnamed fertilizer');
  });

  test('solveMilpBrowser: nh4PctTarget is ignored when there is no N target to split', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Exercises addNh4FractionConstraint's `(targets.N_total || 0) > 0` check failing (N_total
    // absent here) even though nh4PctTarget itself is validly set - every other nh4PctTarget
    // test always targets some N.
    const mkp = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical');
    const result = await window.FertilizerCore.solveMilpBrowser({
      fertilizers: [mkp], targets: { P2O5: 200 }, volume: 10, nh4PctTarget: 50
    });
    assert(result.formula.mkp_typical > 0, 'Should solve normally, ignoring the NH4 split with no N target');
  });

  test('solveMilpBrowser: a PeKacid cap too small to round to a nonzero gram amount still logs cleanly', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // pekacidMaxLimit x volume is > 0 but the solved PeKacid grams round below the 1e-4g
    // inclusion threshold, so formula[PEKACID_ID] is never set. Exercises the
    // `formula[PEKACID_ID] || 0` fallback in the PeKacid result-logging block.
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid')
    ].filter(Boolean);
    const result = await window.FertilizerCore.solveMilpBrowser({
      fertilizers: fertObjects, targets: { N_total: 150, K2O: 200 }, volume: 1, pekacidMaxLimit: 0.00001
    });
    assert(!result.formula.icl_pekacid_pk_acid, 'PeKacid grams should round below the inclusion threshold');
  });

  test('solveMilpBrowser: throws when the solver returns no usable solution', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Exercises the `!solution || !model.variables` guard - real HiGHS solves always return a
    // usable solution object, so this simulates the solver itself failing outright.
    const kno3 = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical');
    const highs = await window.FertilizerCore.getHighsInstance();
    const originalSolve = highs.solve;
    highs.solve = () => null;
    try {
      let threw = false;
      try {
        await window.FertilizerCore.solveMilpBrowser({ fertilizers: [kno3], targets: { N_total: 100 }, volume: 1 });
      } catch (e) {
        threw = true;
        assert(e.message.includes('MILP solver failed'), 'Should report the solver failure');
      }
      assert(threw, 'Should throw when the solver returns nothing usable');
    } finally {
      highs.solve = originalSolve;
    }
  });

  test('solveMilpBrowser: falls back to a bare fertilizer id column and treats a non-numeric Primal as 0', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // Exercises solution.Columns[`x_${id}`] || solution.Columns[id] (HiGHS always names columns
    // with the x_ prefix in real solves, so the bare-id fallback is otherwise unreachable) and
    // the "column exists but has no numeric Primal" -> 0 grams fallback, via a stubbed solution.
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid')
    ].filter(Boolean);
    const highs = await window.FertilizerCore.getHighsInstance();
    const originalSolve = highs.solve;
    highs.solve = () => ({
      Columns: {
        potassium_nitrate_typical: { Primal: 3.2 },  // bare id, no x_ prefix
        icl_pekacid_pk_acid: {}                       // present but no Primal at all
      }
    });
    try {
      const result = await window.FertilizerCore.solveMilpBrowser({
        fertilizers: fertObjects, targets: { N_total: 100 }, volume: 1
      });
      assertEqual(result.formula.potassium_nitrate_typical, 3.2, 'Should fall back to the bare-id column');
      assert(!result.formula.icl_pekacid_pk_acid, 'A column with no numeric Primal should count as 0 grams');
    } finally {
      highs.solve = originalSolve;
    }
  });

  test('solveMilpBrowser: throws when the LPModel dependency is not loaded', async () => {
    const kno3 = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical');
    const savedLPModel = globalThis.LPModel;
    delete globalThis.LPModel;
    try {
      let threw = false;
      try {
        await window.FertilizerCore.solveMilpBrowser({
          fertilizers: [kno3], targets: { N_total: 150, K2O: 500 }, volume: 1
        });
      } catch (e) {
        threw = true;
        assert(e.message.includes('MILP dependencies not loaded'), 'Should identify the missing dependency');
      }
      assert(threw, 'Should throw without LPModel');
    } finally {
      globalThis.LPModel = savedLPModel;
    }
  });

  test('optimizeFormula: throws a clear error when solveMilpBrowser is unavailable', async () => {
    const savedSolveMilp = window.FertilizerCore.solveMilpBrowser;
    delete window.FertilizerCore.solveMilpBrowser;
    try {
      let threw = false;
      try {
        await window.FertilizerCore.optimizeFormula({ N: 1, P: 1, K: 1 }, 10, [window.FertilizerCore.FERTILIZERS[0]], 100, 'oxide', {});
      } catch (e) {
        threw = true;
        assert(e.message.includes('MILP solver'), 'Error should name the missing solver');
      }
      assert(threw, 'Should throw without solveMilpBrowser');
    } finally {
      window.FertilizerCore.solveMilpBrowser = savedSolveMilp;
    }
  });

  test('optimizeFormula: dev-log hook receives messages and flushes ones queued before it existed', async () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // optimizeFormula has its own devLog closure (separate from solveMilpBrowser's), which
    // queues into the same globalThis._pendingDevLogs when no UI hook is installed yet.
    const kno3 = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical');
    delete globalThis.addDevLog;
    globalThis._pendingDevLogs = [];

    await window.FertilizerCore.optimizeFormula({ N: 1, K: 2.8 }, 1, [kno3], 100, 'oxide', {});
    assert(globalThis._pendingDevLogs.length > 0, 'Logs should queue when addDevLog is not set');

    const captured = [];
    globalThis.addDevLog = (msg, type) => captured.push({ msg, type });
    try {
      await window.FertilizerCore.optimizeFormula({ N: 1, K: 2.8 }, 1, [kno3], 100, 'oxide', {});
      assert(captured.length > 0, 'Queued + new logs should flush through addDevLog');

      // optimizeFormula's OWN devLog closure (as opposed to solveMilpBrowser's, exercised
      // above) is only ever invoked from the targetEC-scaling helpers - specifically here,
      // _rerunKeepingPekacidAtCapIfScalingWouldDropIt, using the same real PeKacid-at-cap
      // scenario as the "stays at cap when EC scaling would drop it" test above.
      captured.length = 0;
      const fertObjects = [
        window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
        window.FertilizerCore.FERTILIZERS.find(f => f.id === 'icl_pekacid_pk_acid'),
        window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
        window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical')
      ].filter(Boolean);
      await window.FertilizerCore.optimizeFormula(
        { N: 150, P: 250, K: 250, Ca: 150 }, 10, fertObjects, 100, 'oxide',
        { useAbsoluteTargets: true, pekacidMaxLimit: 0.15, targetEC: 0.969178696654033, useMilp: true }
      );
      assert(
        captured.some(l => l.msg.includes('Re-running MILP with PeKacid fixed at cap')),
        'optimizeFormula devLog should report the PeKacid-at-cap re-run'
      );
    } finally {
      delete globalThis.addDevLog;
      delete globalThis._pendingDevLogs;
    }
  });

  test('FertilizerCore.isHighsLoaded: reports true once the WASM solver has been used', () => {
    if (!milpAvailable()) { console.log('  (skipped - MILP not available in Node)'); return; }
    // By this point in the suite, multiple MILP-backed tests above have already run, so the
    // HiGHS instance is cached (module-level cache, not reset between tests).
    assert(window.FertilizerCore.isHighsLoaded(), 'Solver should be cached after prior MILP calls');
  });

  // ==========================================================================
  // Regression Tests
  // ==========================================================================

  test('Regression: optimizeFormula still works for single ratio', async () => {
    const ratio = { N: 3, P: 1, K: 2, Ca: 2, Mg: 0.5 };
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'magnesium_sulfate_heptahydrate_common')
    ].filter(Boolean);

    const result = await window.FertilizerCore.optimizeFormula(
      ratio,
      1,
      fertObjects,
      150,
      'elemental'
    );

    assertHasKey(result, 'formula', 'Should have formula');
    assertHasKey(result, 'achieved', 'Should have achieved');
    assert(Object.keys(result.formula).length > 0, 'Should have fertilizers in formula');

    // These 4 fertilizers can't hit N:P:K:Ca:Mg = 3:1:2:2:0.5 exactly - Ca and N share a
    // single source (CaNO3), so hitting N=3 exactly forces Ca (and, via KNO3, K) above their
    // 2:1 target. The minimax objective spreads that error onto Ca and K equally (~47% over
    // each) while still hitting P and Mg exactly - verify that documented trade-off rather
    // than just checking the formula is non-empty.
    const a = result.achieved;
    assertApprox(a.P / a.N_total, 1 / 3, 0.05, 'P:N should match target closely (P has no conflicting source)');
    assertApprox(a.Mg / a.N_total, 0.5 / 3, 0.02, 'Mg:N should match target closely (Mg has no conflicting source)');
    assertApprox(a.Ca / a.N_total, 0.98, 0.15, 'Ca:N overshoots target 2/3 by ~47% since CaNO3 is the only Ca source');
    assertApprox(a.K / a.N_total, 0.98, 0.15, 'K:N overshoots target 2/3 in lockstep with Ca (shared KNO3/CaNO3 constraint)');

    // Absolute achieved PPM (ratios alone can't catch an overall-scale bug).
    assertApprox(a.N_total, 729.1, 20, 'Achieved N ppm');
    assertApprox(a.P, 243.0, 15, 'Achieved P ppm');
    assertApprox(a.K, 713.9, 40, 'Achieved K ppm');
    assertApprox(a.Ca, 713.9, 40, 'Achieved Ca ppm');
    assertApprox(a.Mg, 121.5, 10, 'Achieved Mg ppm');

    // Ion balance: Ca2+ + NH4+ + K+ + Mg2+ cations vs. NO3- + H2PO4- + SO4^2- anions.
    const ionBalance = window.FertilizerCore.calculateIonBalanceCore(result.formula, 1);
    assertApprox(ionBalance.totalCations, 66.7, 5, 'Total cations meq/L');
    assertApprox(ionBalance.totalAnions, 66.7, 5, 'Total anions meq/L');
    assertApprox(ionBalance.imbalance, 0, 0.01, 'Ion balance should be ~0');
  });

  test('Regression: getElementalContributionPerGram works correctly', () => {
    const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical');
    const contrib = window.FertilizerCore.getElementalContributionPerGram(fert);

    // 15.5% N = 155 ppm per g/L
    assertApprox(contrib.N, 155, 1, 'N contribution');
    // 19% Ca = 190 ppm per g/L
    assertApprox(contrib.Ca, 190, 1, 'Ca contribution');
    // No P, K, Mg, S in calcium nitrate
    assertEqual(contrib.P, 0, 'P contribution');
    assertEqual(contrib.K, 0, 'K contribution');
    assertEqual(contrib.Mg, 0, 'Mg contribution');
  });

  test('Regression: Oxide conversions in contribution calculation', () => {
    const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical');
    const contrib = window.FertilizerCore.getElementalContributionPerGram(fert);

    // MKP: 52% P2O5, 34% K2O
    // P: 52 × 10 × 0.43646 = 226.96 → ~227 ppm per g/L
    assertApprox(contrib.P, 227, 2, 'P contribution from P2O5');
    // K: 34 × 10 × 0.83013 = 282.24 → ~282 ppm per g/L
    assertApprox(contrib.K, 282, 2, 'K contribution from K2O');
  });

  test('getElementalContributionPerGram: MgO-form fertilizer (Kieserite-style Magnesium Sulfate)', () => {
    // Real product sold with Mg expressed as MgO rather than elemental Mg on the label.
    const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'magnesium_sulfate_16mgo');
    assert(fert, 'Fertilizer should exist');
    const contrib = window.FertilizerCore.getElementalContributionPerGram(fert);

    // 16% MgO × 10 × 0.60317 = 96.5 ppm per g/L
    assertApprox(contrib.Mg, 96.5, 1, 'Mg contribution from MgO');
    // 13% S × 10 = 130 ppm per g/L (this product's S is already elemental, not SO3)
    assertApprox(contrib.S, 130, 1, 'S contribution');
  });

  test('getElementalContributionPerGram: CaO-form NPK blend (ICL WSF 12:6:22+12CaO)', () => {
    // Real compound fertilizer that carries N, P2O5, K2O, and CaO all in one product.
    const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'wsf_12_6_22_12cao');
    assert(fert, 'Fertilizer should exist');
    const contrib = window.FertilizerCore.getElementalContributionPerGram(fert);

    assertApprox(contrib.N, 120, 1, 'N contribution (N_NO3 form)');
    assertApprox(contrib.P, 26.2, 1, 'P contribution from P2O5');
    assertApprox(contrib.K, 182.6, 1, 'K contribution from K2O');
    assertApprox(contrib.Ca, 85.8, 1, 'Ca contribution from CaO');
  });

  test('getElementalContributionPerGram: elemental-P fertilizer (Phosphoric Acid 49%)', () => {
    // Real product where P is labeled directly (18.6% P), not as P2O5.
    const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'phosphoric_acid_49');
    assert(fert, 'Fertilizer should exist');
    const contrib = window.FertilizerCore.getElementalContributionPerGram(fert);

    // 18.6% P × 10 = 186 ppm per g/L (elemental P branch, not the P2O5 conversion branch)
    assertApprox(contrib.P, 186, 0.5, 'P contribution from elemental P');
    assertEqual(contrib.N, 0, 'N contribution');
    assertEqual(contrib.K, 0, 'K contribution');
  });

  test('getElementalContributionPerGram: elemental-K fertilizer (Potassium Bicarbonate)', () => {
    // Real product where K is labeled directly (39% K), not as K2O.
    const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_bicarbonate');
    assert(fert, 'Fertilizer should exist');
    const contrib = window.FertilizerCore.getElementalContributionPerGram(fert);

    // 39% K × 10 = 390 ppm per g/L (elemental K branch, not the K2O conversion branch)
    assertApprox(contrib.K, 390, 0.5, 'K contribution from elemental K');
    assertEqual(contrib.P, 0, 'P contribution');
  });

  test('getElementalContributionPerGram: N_total-only and SO3-form branches (no current DB fertilizer exercises these)', () => {
    // No fertilizer in FERTILIZERS currently reports N with only N_total (all real entries also
    // set N_NO3/N_NH4/N_Urea), and none reports S as SO3 (all real S entries are elemental).
    // These branches are still part of the function's documented contract, so exercise them
    // directly against the function rather than against fabricated FERTILIZERS entries.
    const contrib = window.FertilizerCore.getElementalContributionPerGram({
      pct: { N_total: 20, SO3: 30 }
    });

    assertApprox(contrib.N, 200, 0.5, 'N contribution falls back to N_total when no N form is set');
    // 30% SO3 × 10 × 0.40059 = 120.18 ppm per g/L
    assertApprox(contrib.S, 120.18, 0.5, 'S contribution from SO3');
  });

  test('getElementalContributionPerGram: a fertilizer object with no pct at all contributes nothing', () => {
    // Exercises the `fert.pct || {}` defensive fallback.
    const contrib = window.FertilizerCore.getElementalContributionPerGram({});
    assertEqual(contrib.N, 0, 'N contribution');
    assertEqual(contrib.P, 0, 'P contribution');
    assertEqual(contrib.K, 0, 'K contribution');
  });

  test('getElementalContributionPerGram: Urea (N_Urea only, no N_NO3/N_NH4) still sums correctly', () => {
    // Exercises the N_NO3/N_NH4 `|| 0` fallbacks inside the "has some N form" branch - every
    // other N-fertilizer tested also carries N_NO3 or N_NH4 alongside its other N form.
    const urea = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'urea_common');
    assert(urea, 'Urea should exist in the database');
    const contrib = window.FertilizerCore.getElementalContributionPerGram(urea);
    assertApprox(contrib.N, 460, 1, 'N contribution from N_Urea alone (46% x 10)');
  });

  // ==========================================================================
  // Fertilizer Compatibility Helper Tests
  // ==========================================================================

  test('hasCaContent / hasSulfateContent / hasPhosphateContent / hasSilicateContent: real fertilizer IDs', () => {
    const FC = window.FertilizerCore;
    assert(FC.hasCaContent('calcium_nitrate_calcinit_typical'), 'Calcium Nitrate should have Ca');
    assert(!FC.hasCaContent('potassium_nitrate_typical'), 'Potassium Nitrate should not have Ca');

    assert(FC.hasSulfateContent('ammonium_sulfate_common'), 'Ammonium Sulfate should have S');
    assert(!FC.hasSulfateContent('potassium_nitrate_typical'), 'Potassium Nitrate should not have S');

    assert(FC.hasPhosphateContent('mkp_typical'), 'MKP should have phosphate');
    assert(!FC.hasPhosphateContent('potassium_nitrate_typical'), 'Potassium Nitrate should not have phosphate');

    assert(FC.hasSilicateContent('potassium_silicate_liquid_typical'), 'Potassium Silicate should have Si');
    assert(!FC.hasSilicateContent('potassium_nitrate_typical'), 'Potassium Nitrate should not have Si');
  });

  test('hasIncompatibleFertilizers: Ca + phosphate flags incompatible, Ca alone does not', () => {
    const FC = window.FertilizerCore;
    assert(
      FC.hasIncompatibleFertilizers({ calcium_nitrate_calcinit_typical: 100, mkp_typical: 50 }),
      'Calcium Nitrate + MKP should be flagged as incompatible (Ca + phosphate precipitation risk)'
    );
    assert(
      !FC.hasIncompatibleFertilizers({ calcium_nitrate_calcinit_typical: 100, potassium_nitrate_typical: 50 }),
      'Calcium Nitrate + Potassium Nitrate should not be flagged'
    );
    assert(
      !FC.hasIncompatibleFertilizers({ calcium_nitrate_calcinit_typical: 100 }),
      'A single fertilizer can never be "incompatible" with itself'
    );
    assert(
      FC.hasIncompatibleFertilizers({ calcium_nitrate_calcinit_typical: 100, magnesium_sulfate_heptahydrate_common: 50 }),
      'Calcium Nitrate + Magnesium Sulfate should be flagged (Ca + sulfate precipitation risk)'
    );
    assert(
      FC.hasIncompatibleFertilizers({ calcium_nitrate_calcinit_typical: 100, potassium_silicate_liquid_typical: 50 }),
      'Calcium Nitrate + Potassium Silicate should be flagged (Ca + silicate precipitation risk)'
    );
  });

  // ==========================================================================
  // Ion Balance Tests
  // ==========================================================================

  test('getIonBalanceStatus: caution and imbalanced thresholds', () => {
    const FC = window.FertilizerCore;
    assertEqual(FC.getIonBalanceStatus(15).statusLevel, 'caution', '15% imbalance should be caution');
    assertEqual(FC.getIonBalanceStatus(15).statusColor, '#ffc107', 'caution color');
    assertEqual(FC.getIonBalanceStatus(25).statusLevel, 'imbalanced', '25% imbalance should be imbalanced');
    assertEqual(FC.getIonBalanceStatus(25).statusColor, '#dc3545', 'imbalanced color');
  });

  test('calculateIonBalanceCore: includeBreakdown returns per-fertilizer ion detail', () => {
    // 100g Potassium Nitrate (KNO3, molar mass 101.1) in 1L: perfectly balanced 1:1 K+/NO3-.
    const result = window.FertilizerCore.calculateIonBalanceCore(
      { potassium_nitrate_typical: 100 },
      1,
      { includeBreakdown: true }
    );

    assertApprox(result.totalCations, 989.1, 0.5, 'total cations (K+)');
    assertApprox(result.totalAnions, 989.1, 0.5, 'total anions (NO3-)');
    assertEqual(result.statusLevel, 'balanced', 'KNO3 alone is perfectly ion-balanced');
    assertHasKey(result, 'fertilizerBreakdown', 'should include breakdown when requested');
    assertEqual(result.fertilizerBreakdown.length, 1, 'one fertilizer in the breakdown');

    const entry = result.fertilizerBreakdown[0];
    assertEqual(entry.fert.id, 'potassium_nitrate_typical', 'breakdown entry identifies the fertilizer');
    assertEqual(entry.ions.length, 2, 'KNO3 dissociates into 2 ion species (K+, NO3-)');
    const kIon = entry.ions.find(i => i.ion === 'K⁺');
    assertApprox(kIon.meq, 989.1, 0.5, 'K+ meq/L for this entry');
    assertApprox(kIon.calculation.moles, 0.9891, 0.001, 'moles of KNO3 dissolved');
  });

  test('calculateIonBalanceCore: accepts a plain array of {id, grams} objects, not just a formula map', () => {
    // Every other calculateIonBalanceCore test passes an object map ({fertId: grams}); this
    // exercises the Array.isArray branch that lets pre-resolved fertilizer+grams objects be
    // passed directly instead.
    const fert = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical');
    const result = window.FertilizerCore.calculateIonBalanceCore([{ ...fert, grams: 100 }], 1);
    assertApprox(result.totalCations, 989.1, 0.5, 'total cations (K+), same as the object-map form');
  });

  test('calculateIonBalanceCore: an unrecognized fertilizer id in the formula map contributes nothing', () => {
    // Exercises the object-map branch's "fertilizer not found in FERTILIZERS" fallback (builds
    // a bare {id, grams} instead of spreading a found fertilizer) and the ion-balance loop's own
    // "!ionData" guard (no ION_DATA entry exists for an unknown id, so it's skipped).
    const result = window.FertilizerCore.calculateIonBalanceCore({ not_a_real_fertilizer_id: 50 }, 1);
    assertEqual(result.totalCations, 0, 'unknown fertilizer contributes no cations');
    assertEqual(result.totalAnions, 0, 'unknown fertilizer contributes no anions');
  });

  test('calculateIonBalanceCore: zero fertilizers gives a zero imbalance rather than dividing by zero', () => {
    // Exercises the "average > 0" guard's false side (average of 0 cations + 0 anions is 0).
    const result = window.FertilizerCore.calculateIonBalanceCore({}, 1);
    assertEqual(result.imbalance, 0, 'no ions in solution means no imbalance to report');
  });

  // ==========================================================================
  // calculateNutrientRatios Tests
  // ==========================================================================

  test('calculateNutrientRatios: an empty results object yields no ratios', () => {
    // Exercises getRatio's "all values are zero/undefined" early return, and every
    // _pushRatioIfApplicable / _pushKCaMgMeqRatio condition's false (guard) side at once.
    const ratios = window.FertilizerCore.calculateNutrientRatios({});
    assertEqual(ratios.length, 0, 'nothing to report when every nutrient is absent');
  });

  test('calculateNutrientRatios: a zero value alongside positive ones still renders as 0 in the ratio', () => {
    // Exercises getRatio's per-value ternary alternate (v > 0 ? ... : 0) - P is present in the
    // results but explicitly 0, unlike the other two which are positive.
    const ratios = window.FertilizerCore.calculateNutrientRatios({ N_total: 100, P: 0, K: 50 });
    const npk = ratios.find(r => r.name === 'N : P : K');
    assertEqual(npk.ratio, '2 : 0 : 1', 'zero-valued nutrient renders as 0 in the ratio string');
  });

  test('calculateNutrientRatios: K:Ca:Mg meq/L ratio appears only when all three are present', () => {
    // Exercises _pushKCaMgMeqRatio's guard true side (never hit elsewhere - other tests only
    // ever provide a subset of K/Ca/Mg) and the meq/L conversions themselves.
    const withAllThree = window.FertilizerCore.calculateNutrientRatios({ K: 100, Ca: 50, Mg: 20 });
    const meqRatio = withAllThree.find(r => r.unit === 'meq/L');
    assert(meqRatio, 'K:Ca:Mg meq/L ratio should appear when all three are present');

    const missingCa = window.FertilizerCore.calculateNutrientRatios({ K: 100 });
    assert(!missingCa.find(r => r.unit === 'meq/L'), 'should not appear when Ca and Mg are both missing');

    const missingMg = window.FertilizerCore.calculateNutrientRatios({ K: 100, Ca: 50 });
    assert(!missingMg.find(r => r.unit === 'meq/L'), 'should not appear when only Mg is missing');
  });

  test('calculateNutrientRatios: N present but K missing means no N:K ratio', () => {
    // Every other calculateNutrientRatios test either provides both N and K or neither -
    // exercises the N:K condition's `(results.K || 0) > 0` fallback specifically (reached only
    // once N_total's own check has already passed).
    const ratios = window.FertilizerCore.calculateNutrientRatios({ N_total: 100 });
    assert(!ratios.find(r => r.name === 'N : K'), 'Should not report N:K when K is absent');
  });

  // ==========================================================================
  // checkRatioMatch Tests
  // ==========================================================================

  test('checkRatioMatch: no positive targets always matches', () => {
    const result = window.FertilizerCore.checkRatioMatch({ N: 100 }, {});
    assertEqual(result.matches, true, 'empty target ratio trivially matches');
  });

  test('checkRatioMatch: zero achieved nutrients fails with per-nutrient errors', () => {
    const result = window.FertilizerCore.checkRatioMatch({ N: 0, K: 0 }, { N: 2, K: 1 });
    assertEqual(result.matches, false, 'zero achieved cannot match a positive target ratio');
    assertEqual(result.errors.N.error, 1, 'N is 100% off target');
    assertEqual(result.errors.K.error, 1, 'K is 100% off target');
  });

  // ==========================================================================
  // parseRatio Edge Case Tests
  // ==========================================================================

  test('parseRatio: whitespace-only input is treated as empty', () => {
    const result = window.FertilizerCore.parseRatio('   ');
    assertHasKey(result, 'error', 'whitespace-only input should error');
    assertEqual(result.error, 'Empty ratio string', 'specific empty-string error message');
  });

  test('parseRatio: labeled format with malformed number', () => {
    const result = window.FertilizerCore.parseRatio('N.:P3');
    assertHasKey(result, 'error', 'a bare decimal point is not a valid number');
    assert(result.error.includes('Invalid number'), 'error should identify the bad number');
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  test('Error: No targets provided', async () => {
    const result = await window.FertilizerCore.calculateStockSolutions({
      targets: [],
      availableFertilizers: ['calcium_nitrate_calcinit_typical']
    });

    assert(!result.success, 'Should fail');
    assert(result.errors.some(e => e.code === 'NO_TARGETS'), 'Should have NO_TARGETS error');
  });

  test('Error: No fertilizers provided', async () => {
    const result = await window.FertilizerCore.calculateStockSolutions({
      targets: [{ id: 'test', ratio: { N: 1 }, targetEC: 1.5 }],
      availableFertilizers: []
    });

    assert(!result.success, 'Should fail');
    assert(result.errors.some(e => e.code === 'NO_FERTILIZERS'), 'Should have NO_FERTILIZERS error');
  });

  test('Error: Invalid fertilizer IDs ignored', async () => {
    // Potassium nitrate has N:K ≈ 13.7:38.2 ≈ 1:2.8
    // Use a ratio that matches what KNO3 can actually produce
    const result = await window.FertilizerCore.calculateStockSolutions({
      targets: [{ id: 'test', ratio: { N: 1, P: 0, K: 2.8, Ca: 0, Mg: 0 }, targetEC: 1.0 }],
      availableFertilizers: ['invalid_id_xyz', 'potassium_nitrate_typical']
    });

    // Should still work with valid fertilizer (invalid ID is filtered out)
    assert(result.success, 'Should succeed with valid fertilizer');

    // Confirm it actually solved with KNO3 (not just "success" with an empty/garbage formula) -
    // KNO3's own K:N is fixed at ~2.8, so this should match almost exactly.
    const dosing = result.dosing.find(d => d.targetId === 'test');
    const achieved = dosing.predicted.nutrients;
    assertApprox(achieved.K / achieved.N, 2.8, 0.1, 'K:N ratio should match KNO3s fixed composition (±0.1)');
    assertApprox(achieved.N, 196.5, 15, 'Achieved N ppm');
    assertApprox(achieved.K, 551.4, 30, 'Achieved K ppm');

    const tanks = {};
    const dosingML = {};
    for (const [tankId, tank] of Object.entries(result.tanks)) {
      tanks[tankId] = {};
      for (const [fertId, fertData] of Object.entries(tank.fertilizers)) {
        tanks[tankId][fertId] = fertData.grams_per_L;
      }
      dosingML[tankId] = dosing.tanks[tankId].mL_per_L;
    }
    const finalFormula = finalFormulaFromTanksDosing(tanks, dosingML);
    const ionBalance = window.FertilizerCore.calculateIonBalanceCore(finalFormula, 1);
    assertApprox(ionBalance.totalCations, 14.2, 1.5, 'Total cations meq/L (K+)');
    assertApprox(ionBalance.totalAnions, 14.2, 1.5, 'Total anions meq/L (NO3-)');
    assertApprox(ionBalance.imbalance, 0, 0.01, 'Ion balance should be ~0 (single N-only source)');
  });

  // ==========================================================================
  // Existing Calculator Regression Tests
  // ==========================================================================

  test('Regression: estimateECFromPPM basic calculation', () => {
    // Test with typical nutrient solution values
    const ppm = {
      N_NO3: 150,
      N_NH4: 10,
      K: 200,
      Ca: 120,
      Mg: 40,
      S: 30,
      P: 30
    };

    const ecResult = window.FertilizerCore.estimateECFromPPM(ppm);

    // Measured value for this exact ion mix via the sum-of-ionic-conductivities model.
    assertApprox(ecResult.ec_mS_cm, 1.78, 0.05, 'EC should match the ionic-conductivity model (±0.05)');
    assertHasKey(ecResult, 'contributions', 'Should have contributions');
    assertHasKey(ecResult.contributions, 'Ca2+', 'Contributions should break down by ion');
  });

  test('Regression: estimateECFromPPM scales with concentration', () => {
    const ppmLow = { N_NO3: 100, K: 100, Ca: 50 };
    const ppmHigh = { N_NO3: 200, K: 200, Ca: 100 };

    const ecLow = window.FertilizerCore.estimateECFromPPM(ppmLow);
    const ecHigh = window.FertilizerCore.estimateECFromPPM(ppmHigh);

    assert(ecHigh.ec_mS_cm > ecLow.ec_mS_cm, 'Higher concentration should give higher EC');
    // Roughly proportional (within 2x factor)
    const ratio = ecHigh.ec_mS_cm / ecLow.ec_mS_cm;
    assert(ratio > 1.5 && ratio < 2.5, 'EC should scale roughly with concentration');
  });

  test('Regression: calculateIonBalanceCore returns valid data', () => {
    // calculateIonBalanceCore expects fertilizers and volume, not raw PPM
    // Test with a simple fertilizer formula
    const formula = {
      'calcium_nitrate_calcinit_typical': 1.0,  // 1g
      'potassium_nitrate_typical': 0.5
    };

    const ionBalance = window.FertilizerCore.calculateIonBalanceCore(formula, 1);

    // 1g CaNO3 -> Ca2+ 9.26 meq/L, NH4+ 0.93 meq/L; 0.5g KNO3 -> K+ 4.95 meq/L; both -> NO3-.
    // Cations and anions must balance exactly since every N atom here is either NO3- (anion)
    // or NH4+ (cation) - there's no independent anion source, so imbalance should be ~0.
    assertApprox(ionBalance.totalCations, 15.13, 0.05, 'Total cations should match Ca2+ + NH4+ + K+ meq');
    assertApprox(ionBalance.totalAnions, 15.13, 0.05, 'Total anions should match NO3- meq (equals cations)');
    assertApprox(ionBalance.imbalance, 0, 0.01, 'Imbalance should be ~0 (all N is NO3-/NH4+, no external anion)');
  });

  test('Regression: optimizeFormula returns valid structure', async () => {
    if (!window.FertilizerCore.optimizeFormula) {
      console.log('  (skipped - optimizeFormula not available)');
      return;
    }

    const ratio = { N: 3, P: 1, K: 2, Ca: 2, Mg: 0.5, S: 0 };
    const fertObjects = [
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'mkp_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'potassium_nitrate_typical'),
      window.FertilizerCore.FERTILIZERS.find(f => f.id === 'magnesium_sulfate_heptahydrate_common')
    ].filter(Boolean);

    // optimizeFormula(targetRatios, volume, availableFertilizers, concentration, mode, options)
    const result = await window.FertilizerCore.optimizeFormula(
      ratio,
      1,
      fertObjects,
      150,
      'elemental'
    );

    assert(result !== null, 'Result should not be null');
    assertHasKey(result, 'formula', 'Should have formula');
    assertHasKey(result, 'achieved', 'Should have achieved');

    // Same scenario as "optimizeFormula still works for single ratio" above - see that test
    // for why Ca/K overshoot ~47% while P/Mg match exactly. Checked again here since this
    // test exists as its own regression guard against optimizeFormula returning malformed
    // results (e.g. NaNs) independent of that one.
    const a = result.achieved;
    assertApprox(a.N_total, 729.1, 20, 'Achieved N ppm');
    assertApprox(a.P, 243.0, 15, 'Achieved P ppm');
    assertApprox(a.K, 713.9, 40, 'Achieved K ppm');
    assertApprox(a.Ca, 713.9, 40, 'Achieved Ca ppm');
    assertApprox(a.Mg, 121.5, 10, 'Achieved Mg ppm');

    const ionBalance = window.FertilizerCore.calculateIonBalanceCore(result.formula, 1);
    assertApprox(ionBalance.totalCations, 66.7, 5, 'Total cations meq/L');
    assertApprox(ionBalance.totalAnions, 66.7, 5, 'Total anions meq/L');
    assertApprox(ionBalance.imbalance, 0, 0.01, 'Ion balance should be ~0');
  });

  test('Regression: OXIDE_CONVERSIONS are accurate', () => {
    const OC = window.FertilizerCore.OXIDE_CONVERSIONS;

    assertHasKey(OC, 'P2O5_to_P', 'Should have P2O5_to_P');
    assertHasKey(OC, 'K2O_to_K', 'Should have K2O_to_K');

    // P2O5 → P: 2*30.97 / 141.94 ≈ 0.4364
    assertApprox(OC.P2O5_to_P, 0.4364, 0.001, 'P2O5 to P conversion');
    // K2O → K: 2*39.1 / 94.2 ≈ 0.8301
    assertApprox(OC.K2O_to_K, 0.8301, 0.001, 'K2O to K conversion');
  });

  test('Regression: DEFAULT_SOLUBILITY_GL exists and is reasonable', () => {
    const defaultSol = window.FertilizerCore.DEFAULT_SOLUBILITY_GL;
    assert(typeof defaultSol === 'number', 'Should be a number');
    assert(defaultSol > 50 && defaultSol < 500, 'Should be reasonable default');
  });

  test('Regression: FERTILIZERS array is populated', () => {
    const FERTILIZERS = window.FertilizerCore.FERTILIZERS;
    assert(Array.isArray(FERTILIZERS), 'Should be an array');
    assert(FERTILIZERS.length > 10, 'Should have multiple fertilizers');

    // Check structure of first fertilizer
    const first = FERTILIZERS[0];
    assertHasKey(first, 'id', 'Fertilizer should have id');
    assertHasKey(first, 'name', 'Fertilizer should have name');
    assertHasKey(first, 'pct', 'Fertilizer should have pct');
  });

  test('Regression: Fertilizers have solubility data', () => {
    const FERTILIZERS = window.FertilizerCore.FERTILIZERS;
    const DEFAULT_SOL = window.FertilizerCore.DEFAULT_SOLUBILITY_GL;

    // Check that most fertilizers have solubility defined
    let withSolubility = 0;
    for (const fert of FERTILIZERS) {
      if (fert.solubility_gL && fert.solubility_gL !== DEFAULT_SOL) {
        withSolubility++;
      }
    }

    assert(withSolubility > FERTILIZERS.length * 0.5, 'At least 50% of fertilizers should have explicit solubility');
  });

  test('Regression: Common fertilizers exist', () => {
    const FERTILIZERS = window.FertilizerCore.FERTILIZERS;
    const commonIds = [
      'calcium_nitrate_calcinit_typical',
      'potassium_nitrate_typical',
      'mkp_typical',
      'magnesium_sulfate_heptahydrate_common'
    ];

    for (const id of commonIds) {
      const fert = FERTILIZERS.find(f => f.id === id);
      assert(fert !== undefined, `Common fertilizer ${id} should exist`);
    }
  });

  test('Regression: ppm-from-grams via calculateAchievedPPM', () => {
    // 1g of calcium nitrate (15.5% N, 19% Ca) dosed into 1L of final solution.
    // This exercises the real FertilizerCore code path (calculateAchievedPPM), rather than
    // recomputing the expected value from raw pct data and comparing it to itself.
    const tanks = { A: { 'calcium_nitrate_calcinit_typical': 1 } }; // 1 g/L "stock"
    const dosing = { A: 1000 }; // 1000 mL/L -> 1 g/L equivalent in final solution

    const achieved = window.FertilizerCore.calculateAchievedPPM(tanks, dosing);

    assertApprox(achieved.N, 155, 1, 'N ppm from 1 g/L calcium nitrate');
    assertApprox(achieved.Ca, 190, 1, 'Ca ppm from 1 g/L calcium nitrate');
  });

  test('Regression: checkWarnings flags real incompatibilities', () => {
    if (!window.FertilizerWarnings?.checkWarnings) {
      console.log('  (skipped - FertilizerWarnings not available)');
      return;
    }

    // This ppm mix has Ca alongside both S (sulfate) and P (phosphate) - both are classic
    // precipitation risks (CaSO4, Ca3(PO4)2), so the warnings engine should flag them by name,
    // not just return "an array" that could be empty and still pass.
    const ppm = {
      N_NO3: 150,
      N_NH4: 10,
      K: 200,
      Ca: 120,
      Mg: 40,
      S: 30,
      P: 30
    };

    const mockI18n = {
      t: (key) => key,
      formatNumber: (n) => n
    };

    const warnings = window.FertilizerWarnings.checkWarnings(
      ppm,
      [],
      null,
      { i18n: mockI18n, estimateECFromPPM: window.FertilizerCore.estimateECFromPPM }
    );

    assert(Array.isArray(warnings), 'Should return an array');
    assert(warnings.some(w => w.category === 'warningCategoryCaSulfate'), 'Should warn about Ca+Sulfate precipitation risk');
    assert(warnings.some(w => w.category === 'warningCategoryCaPhosphate'), 'Should warn about Ca+Phosphate precipitation risk');
  });

  // ==========================================================================
  // Run all tests
  // ==========================================================================

  // Export for browser
  if (typeof window !== 'undefined') {
    window.StockSolutionMakerTests = { runTests };
    // Note: Auto-run is handled by test-runner.html, not here
  }

  // Export for Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runTests };
  }

})();
