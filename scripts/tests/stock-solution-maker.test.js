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
 * - Progressive-K: Tank addition when needed
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
  });

  test('calculateAchievedPPM: Two tanks', () => {
    const tanks = {
      A: { 'calcium_nitrate_calcinit_typical': 100 },
      B: { 'mkp_typical': 50 }
    };
    const dosing = { A: 10, B: 10 };

    const achieved = window.FertilizerCore.calculateAchievedPPM(tanks, dosing);

    assert(achieved.Ca > 0, 'Has Ca from Tank A');
    assert(achieved.P > 0, 'Has P from Tank B');
    assert(achieved.K > 0, 'Has K from Tank B');
  });

  // ==========================================================================
  // solveDosing Tests
  // ==========================================================================

  test('solveDosing: Achieves target EC', async () => {
    const tanks = {
      A: { 'calcium_nitrate_calcinit_typical': 150 },
      B: { 'potassium_nitrate_typical': 100 }
    };
    const target = {
      ratio: { N: 2, P: 0, K: 1, Ca: 1, Mg: 0 },
      targetEC: 1.5,
      baselineEC: 0
    };

    const result = window.FertilizerCore.solveDosing(tanks, target, { maxDosing: 50 });

    assert(result.feasible, 'Should be feasible');
    assertApprox(result.predictedEC, 1.5, 0.2, 'EC should be close to target');
    assert(result.dosing.A > 0, 'Tank A dosing > 0');
    assert(result.dosing.B > 0, 'Tank B dosing > 0');
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

  test('calculateStockSolutions: Single target success', async () => {
    const options = {
      targets: [
        {
          id: 'veg',
          ratio: { N: 3, P: 1, K: 2, Ca: 2, Mg: 0.5 },
          targetEC: 1.8
        }
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

    assert(result.success, 'Should succeed');
    assertHasKey(result, 'tanks', 'Should have tanks');
    assertHasKey(result, 'dosing', 'Should have dosing');
    assertEqual(result.dosing.length, 1, 'Should have 1 dosing instruction');
    assertEqual(result.dosing[0].targetId, 'veg', 'Target ID matches');
  });

  test('calculateStockSolutions: Multiple targets with different ECs', async () => {
    const options = {
      targets: [
        {
          id: 'seedling',
          ratio: { N: 2, P: 1, K: 2, Ca: 1.5 },
          targetEC: 0.8
        },
        {
          id: 'veg',
          ratio: { N: 3, P: 1, K: 2, Ca: 2 },
          targetEC: 1.6
        },
        {
          id: 'flower',
          ratio: { N: 2, P: 1.5, K: 3, Ca: 2 },
          targetEC: 2.0
        }
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

    assert(result.success, 'Should succeed');
    assertEqual(result.dosing.length, 3, 'Should have 3 dosing instructions');

    // Verify dosing scales with EC
    const seedlingDose = result.dosing.find(d => d.targetId === 'seedling').totalDosing_mL_per_L;
    const vegDose = result.dosing.find(d => d.targetId === 'veg').totalDosing_mL_per_L;
    const flowerDose = result.dosing.find(d => d.targetId === 'flower').totalDosing_mL_per_L;

    assert(seedlingDose < vegDose, 'Seedling dose < veg dose');
    assert(vegDose < flowerDose, 'Veg dose < flower dose');
  });

  test('calculateStockSolutions: Tank separation', async () => {
    const options = {
      targets: [
        {
          id: 'test',
          ratio: { N: 2, P: 1, K: 2, Ca: 1 },
          targetEC: 1.5
        }
      ],
      availableFertilizers: [
        'calcium_nitrate_calcinit_typical',
        'mkp_typical'
      ],
      stockConcentration: 100,
      stockTankVolumeL: 20
    };

    const result = await window.FertilizerCore.calculateStockSolutions(options);

    assert(result.success, 'Should succeed');

    // Verify Ca is in Tank A, P is in Tank B
    if (result.tanks.A) {
      for (const fertId of Object.keys(result.tanks.A.fertilizers)) {
        const tag = window.FertilizerCore.getCompatibilityTag(fertId);
        assert(tag === 'calcium' || tag === 'neutral', `Tank A should have Ca or neutral, got ${fertId}`);
      }
    }

    if (result.tanks.B) {
      for (const fertId of Object.keys(result.tanks.B.fertilizers)) {
        const tag = window.FertilizerCore.getCompatibilityTag(fertId);
        assert(tag !== 'calcium', `Tank B should not have Ca, got ${fertId}`);
      }
    }
  });

  test('calculateStockSolutions: Includes solubility percentage', async () => {
    const options = {
      targets: [
        {
          id: 'test',
          ratio: { N: 1, K: 1 },
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
  });

  // ==========================================================================
  // Progressive-K Tests
  // ==========================================================================

  test('Progressive-K: Uses 2 tanks when possible', async () => {
    const options = {
      targets: [
        {
          id: 'simple',
          ratio: { N: 2, P: 1, K: 2, Ca: 1 },
          targetEC: 1.5
        }
      ],
      availableFertilizers: [
        'calcium_nitrate_calcinit_typical',
        'mkp_typical',
        'potassium_nitrate_typical'
      ],
      stockConcentration: 100,
      stockTankVolumeL: 20
    };

    const result = await window.FertilizerCore.calculateStockSolutions(options);

    assert(result.success, 'Should succeed');
    assertEqual(result.meta.numTanks, 2, 'Should use 2 tanks');
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
    const result = await window.FertilizerCore.calculateStockSolutions({
      targets: [{ id: 'test', ratio: { N: 1, K: 1 }, targetEC: 1.0 }],
      availableFertilizers: ['invalid_id_xyz', 'potassium_nitrate_typical']
    });

    // Should still work with valid fertilizer
    assert(result.success, 'Should succeed with valid fertilizer');
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

    assert(ecResult.ec_mS_cm > 0, 'EC should be positive');
    assert(ecResult.ec_mS_cm < 5, 'EC should be reasonable (< 5 mS/cm)');
    assertHasKey(ecResult, 'ec_mS_cm', 'Should have ec_mS_cm');
    assertHasKey(ecResult, 'tds_500', 'Should have tds_500');
    assertHasKey(ecResult, 'tds_700', 'Should have tds_700');
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

  test('Regression: calculateIonBalance returns valid data', () => {
    const ppm = {
      N_NO3: 150,
      N_NH4: 10,
      K: 200,
      Ca: 120,
      Mg: 40,
      S: 30,
      P: 30
    };

    const ionBalance = window.FertilizerCore.calculateIonBalance(ppm);

    assertHasKey(ionBalance, 'totalCations', 'Should have totalCations');
    assertHasKey(ionBalance, 'totalAnions', 'Should have totalAnions');
    assertHasKey(ionBalance, 'imbalance', 'Should have imbalance');
    assert(ionBalance.totalCations > 0, 'Cations should be positive');
    assert(ionBalance.totalAnions > 0, 'Anions should be positive');
    assert(ionBalance.imbalance >= 0, 'Imbalance should be non-negative');
  });

  test('Regression: optimizeFormula returns valid structure', async () => {
    if (!window.FertilizerCore.optimizeFormula) {
      console.log('  (skipped - optimizeFormula not available)');
      return;
    }

    const targets = { N: 150, P: 40, K: 200, Ca: 100, Mg: 40, S: 40 };
    const fertIds = [
      'calcium_nitrate_calcinit_typical',
      'monopotassium_phosphate_pure',
      'potassium_nitrate_pure',
      'magnesium_sulfate_typical'
    ];

    const result = await window.FertilizerCore.optimizeFormula({
      targets,
      volume: 10,
      availableFertilizers: fertIds,
      targetEC: 1.5,
      calcMode: 'elemental'
    });

    assert(result !== null, 'Result should not be null');
    assertHasKey(result, 'formula', 'Should have formula');
    assertHasKey(result, 'ppm', 'Should have ppm');
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
      'potassium_nitrate_pure',
      'monopotassium_phosphate_pure',
      'magnesium_sulfate_typical'
    ];

    for (const id of commonIds) {
      const fert = FERTILIZERS.find(f => f.id === id);
      assert(fert !== undefined, `Common fertilizer ${id} should exist`);
    }
  });

  test('Regression: ppmFromGrams calculation', () => {
    // 1g of calcium nitrate (15.5% N, 19% Ca) in 1L water
    const calciumNitrate = window.FertilizerCore.FERTILIZERS.find(f => f.id === 'calcium_nitrate_calcinit_typical');

    // N: 15.5% means 0.155g N per gram of fertilizer
    // 0.155g in 1L = 155 ppm (mg/L)
    const expectedN = calciumNitrate.pct.N_total * 10; // × 10 for g/L → ppm
    const expectedCa = calciumNitrate.pct.Ca * 10;

    assertApprox(expectedN, 155, 5, 'N calculation from calcium nitrate');
    assertApprox(expectedCa, 190, 5, 'Ca calculation from calcium nitrate');
  });

  test('Regression: checkWarnings returns array', () => {
    if (!window.FertilizerWarnings?.checkWarnings) {
      console.log('  (skipped - FertilizerWarnings not available)');
      return;
    }

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
  });

  // ==========================================================================
  // Run all tests
  // ==========================================================================

  // Export for browser
  if (typeof window !== 'undefined') {
    window.StockSolutionMakerTests = { runTests };

    // Auto-run if DOM ready
    if (document.readyState === 'complete') {
      runTests();
    } else {
      window.addEventListener('load', runTests);
    }
  }

  // Export for Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runTests };
  }

})();
