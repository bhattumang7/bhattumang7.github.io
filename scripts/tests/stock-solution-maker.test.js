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
