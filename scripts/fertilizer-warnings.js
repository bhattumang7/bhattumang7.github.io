/**
 * Fertilizer Warnings Module
 * Analyzes nutrient solution results and generates warnings for potential issues
 */

(function() {
  'use strict';

  // Create namespace
  window.FertilizerWarnings = window.FertilizerWarnings || {};

  /**
   * Check nutrient solution for potential issues and generate warnings
   * @param {Object} results - PPM results for each nutrient
   * @param {Array} activeFertilizers - Array of fertilizer objects with pct and name properties
   * @param {Object} ionBalance - Optional ion balance data
   * @param {Object} deps - Dependencies: { i18n, estimateECFromPPM }
   * @returns {Array} Array of warning objects with level, category, and message
   */
  function checkWarnings(results, activeFertilizers, ionBalance, deps) {
    const { i18n, estimateECFromPPM } = deps;
    const warnings = [];

    // Extract common values
    const ca = results.Ca || 0;
    const mg = results.Mg || 0;
    const k = results.K || 0;
    const p = results.P || 0;
    const s = results.S || 0;
    const si = results.Si || 0;
    const cl = results.Cl || 0;
    const na = results.Na || 0;
    const fe = results.Fe || 0;
    const mn = results.Mn || 0;
    const zn = results.Zn || 0;
    const cu = results.Cu || 0;
    const b = results.B || 0;
    const mo = results.Mo || 0;
    const nh4 = results.N_NH4 || 0;
    const no3 = results.N_NO3 || 0;
    const totalN = nh4 + no3;

    // ============================================================================
    // SECTION A: STOCK SOLUTION / MIXING COMPATIBILITY (HARD warnings)
    // ============================================================================

    // 1. Calcium + Sulfate incompatibility (in stock solutions)
    if (ca > 10 && s > 10) {
      const caFertilizers = activeFertilizers.filter(f => f.pct && f.pct.Ca).map(f => f.name).join(', ');
      const sFertilizers = activeFertilizers.filter(f => f.pct && f.pct.S).map(f => f.name).join(', ');
      warnings.push({
        level: 'warning',
        category: i18n.t('warningCategoryCaSulfate'),
        message: i18n.t('warningMsgCaSulfate', { caFertilizers: caFertilizers || i18n.t('calciumFertilizers'), sFertilizers: sFertilizers || i18n.t('sulfateFertilizers') })
      });
    }

    // 8. Calcium + Phosphate incompatibility (Ca-P precipitate)
    if (ca > 10 && p > 10) {
      const caFertilizers = activeFertilizers.filter(f => f.pct && f.pct.Ca).map(f => f.name).join(', ');
      const pFertilizers = activeFertilizers.filter(f => f.pct && (f.pct.P || f.pct.P2O5)).map(f => f.name).join(', ');
      warnings.push({
        level: 'warning',
        category: i18n.t('warningCategoryCaPhosphate'),
        message: i18n.t('warningMsgCaPhosphate', { ca: i18n.formatNumber(ca.toFixed(1)), p: i18n.formatNumber(p.toFixed(1)), caFertilizers: caFertilizers || i18n.t('calciumFertilizers'), pFertilizers: pFertilizers || i18n.t('phosphateFertilizers') })
      });
    }

    // 9. Calcium + Silicate incompatibility (Ca-silicate gel/scale)
    if (ca > 10 && si > 10) {
      warnings.push({
        level: 'warning',
        category: i18n.t('warningCategoryCaSilicate'),
        message: i18n.t('warningMsgCaSilicate', { ca: i18n.formatNumber(ca.toFixed(1)), si: i18n.formatNumber(si.toFixed(1)) })
      });
    }

    // ============================================================================
    // SECTION B: NITROGEN / AMMONIUM BALANCE
    // ============================================================================

    // 2. High NH4 ratio (>30% - HARD warning)
    if (totalN > 0) {
      const nh4Ratio = (nh4 / totalN) * 100;
      if (nh4Ratio > 30) {
        warnings.push({
          level: 'warning',
          category: i18n.t('warningCategoryHighAmmonium'),
          message: i18n.t('warningMsgHighAmmonium', { ratio: i18n.formatNumber(nh4Ratio.toFixed(1)) })
        });
      }
    }

    // 12. Zero Ammonium (SOFT warning - optional guidance)
    if (totalN > 0 && nh4 === 0) {
      warnings.push({
        level: 'info',
        category: i18n.t('warningCategoryZeroAmmonium'),
        message: i18n.t('warningMsgZeroAmmonium')
      });
    }

    // 13. Very Low Ammonium (<3% - SOFT warning)
    if (totalN > 0 && nh4 > 0) {
      const nh4Ratio = (nh4 / totalN) * 100;
      if (nh4Ratio < 3) {
        warnings.push({
          level: 'info',
          category: i18n.t('warningCategoryVeryLowAmmonium'),
          message: i18n.t('warningMsgVeryLowAmmonium', { ratio: i18n.formatNumber(nh4Ratio.toFixed(1)) })
        });
      }
    }

    // ============================================================================
    // SECTION C: NUTRIENT PRESENCE CHECKS (important for RO water)
    // ============================================================================

    // 14. Missing Calcium baseline
    if (ca < 20 && totalN > 0) {
      warnings.push({
        level: 'info',
        category: i18n.t('warningCategoryLowCalcium'),
        message: i18n.t('warningMsgLowCalcium', { ca: i18n.formatNumber(ca.toFixed(1)) })
      });
    }

    // 15. Missing Magnesium baseline
    if (mg < 10 && totalN > 0) {
      warnings.push({
        level: 'info',
        category: i18n.t('warningCategoryLowMagnesium'),
        message: i18n.t('warningMsgLowMagnesium', { mg: i18n.formatNumber(mg.toFixed(1)) })
      });
    }

    // 16. Micronutrients missing (sanity check for complete feeds)
    if (totalN > 0) {
      const missingMicros = [];
      if (fe === 0) missingMicros.push('Fe');
      if (b === 0) missingMicros.push('B');
      if (mn === 0) missingMicros.push('Mn');
      if (zn === 0) missingMicros.push('Zn');
      if (cu === 0) missingMicros.push('Cu');
      if (mo === 0) missingMicros.push('Mo');

      if (missingMicros.length > 0) {
        warnings.push({
          level: 'info',
          category: i18n.t('warningCategoryMissingMicronutrients'),
          message: i18n.t('warningMsgMissingMicronutrients', { micros: missingMicros.join(', ') })
        });
      }
    }

    // ============================================================================
    // SECTION D: RATIO / ANTAGONISM RULES (SOFT warnings)
    // ============================================================================

    // 3. Ca:Mg ratio (optimal is 3:1 to 5:1)
    if (ca > 10 && mg > 5) {
      const ratio = ca / mg;
      if (ratio < 2) {
        warnings.push({
          level: 'info',
          category: i18n.t('warningCategoryCaMgRatio'),
          message: i18n.t('warningMsgCaMgRatioLow', { ratio: i18n.formatNumber(ratio.toFixed(2)), ca: i18n.formatNumber(ca.toFixed(1)), mg: i18n.formatNumber(mg.toFixed(1)) })
        });
      } else if (ratio > 7) {
        warnings.push({
          level: 'info',
          category: i18n.t('warningCategoryCaMgRatio'),
          message: i18n.t('warningMsgCaMgRatioHigh', { ratio: i18n.formatNumber(ratio.toFixed(2)), ca: i18n.formatNumber(ca.toFixed(1)), mg: i18n.formatNumber(mg.toFixed(1)) })
        });
      }
    }

    // 4. K:Ca ratio (should be reasonably balanced)
    if (k > 10 && ca > 10) {
      const kCaRatio = k / ca;
      if (kCaRatio > 3) {
        warnings.push({
          level: 'info',
          category: i18n.t('warningCategoryKCaRatio'),
          message: i18n.t('warningMsgKCaRatioHigh', { ratio: i18n.formatNumber(kCaRatio.toFixed(2)) })
        });
      } else if (kCaRatio < 0.5) {
        // Very low K:Ca ratio (Ca-heavy) - may slow growth and reduce flowering
        warnings.push({
          level: 'info',
          category: i18n.t('warningCategoryKCaRatio'),
          message: i18n.t('warningMsgKCaRatioLow', { ratio: i18n.formatNumber(kCaRatio.toFixed(2)) })
        });
      }
    }

    // 17. K:Mg antagonism risk
    if (k > 10 && mg > 5) {
      const kMgRatio = k / mg;
      if (kMgRatio > 6) {
        warnings.push({
          level: 'info',
          category: i18n.t('warningCategoryKMgRatio'),
          message: i18n.t('warningMsgKMgRatioHigh', { ratio: i18n.formatNumber(kMgRatio.toFixed(2)), k: i18n.formatNumber(k.toFixed(1)), mg: i18n.formatNumber(mg.toFixed(1)) })
        });
      } else if (kMgRatio < 1.5) {
        warnings.push({
          level: 'info',
          category: i18n.t('warningCategoryKMgRatio'),
          message: i18n.t('warningMsgKMgRatioLow', { ratio: i18n.formatNumber(kMgRatio.toFixed(2)), k: i18n.formatNumber(k.toFixed(1)), mg: i18n.formatNumber(mg.toFixed(1)) })
        });
      }
    }

    // 18. (Ca + Mg):K balance
    if (k > 10 && (ca + mg) > 10) {
      const caMgSum = ca + mg;
      if (k > caMgSum * 1.5) {
        warnings.push({
          level: 'info',
          category: i18n.t('warningCategoryCaMgKBalance'),
          message: i18n.t('warningMsgCaMgKBalance', { k: i18n.formatNumber(k.toFixed(1)), caMgSum: i18n.formatNumber(caMgSum.toFixed(1)) })
        });
      }
    }

    // 19. N:K ratio (vegetative vs generative style)
    if (totalN > 0 && k > 0) {
      const nkRatio = totalN / k;
      warnings.push({
        level: 'info',
        category: i18n.t('warningCategoryNKRatio'),
        message: i18n.t('warningMsgNKRatio', { nkRatio: i18n.formatNumber((k/totalN).toFixed(2)), n: i18n.formatNumber(totalN.toFixed(1)), k: i18n.formatNumber(k.toFixed(1)) })
      });
    }

    // ============================================================================
    // SECTION E: TOXICITY / UNDESIRABLE IONS
    // ============================================================================

    // 5. EC levels (high and low) - using unified estimateECFromPPM
    const ecData = estimateECFromPPM(results);
    if (ecData.ec_mS_cm > 3.5) {
      warnings.push({
        level: 'warning',
        category: i18n.t('warningCategoryHighEC'),
        message: i18n.t('warningMsgHighEC', { ec: i18n.formatNumber(ecData.ec_mS_cm.toFixed(2)) })
      });
    } else if (ecData.ec_mS_cm < 0.5 && totalN > 0) {
      warnings.push({
        level: 'info',
        category: i18n.t('warningCategoryLowEC'),
        message: i18n.t('warningMsgLowEC', { ec: i18n.formatNumber(ecData.ec_mS_cm.toFixed(2)) })
      });
    }

    // 6. High Chloride
    if (cl > 100) {
      warnings.push({
        level: 'warning',
        category: i18n.t('warningCategoryHighChloride'),
        message: i18n.t('warningMsgHighChlorideLevel', { cl: i18n.formatNumber(cl.toFixed(1)) })
      });
    }

    // 20. High Sodium
    if (na > 50) {
      const severity = na > 100 ? 'warning' : 'info';
      warnings.push({
        level: severity,
        category: i18n.t('warningCategoryHighSodium'),
        message: i18n.t('warningMsgHighSodiumLevel', { na: i18n.formatNumber(na.toFixed(1)), severity: na > 100 ? i18n.t('warningMsgThisIsVeryHigh') : '' })
      });
    }

    // 21. High Boron (narrow safe window)
    if (b > 0.5) {
      const severity = b > 1.0 ? 'warning' : 'info';
      warnings.push({
        level: severity,
        category: i18n.t('warningCategoryHighBoron'),
        message: i18n.t('warningMsgHighBoron', { b: i18n.formatNumber(b.toFixed(2)), severity: b > 1.0 ? i18n.t('warningMsgThisMayCauseToxicity') : i18n.t('warningMsgThisIsOnTheHighEnd') })
      });
    }

    // 22. High Cu/Zn/Mn (micros can go toxic fast)
    if (cu > 0.1) {
      warnings.push({
        level: cu > 0.2 ? 'warning' : 'info',
        category: i18n.t('warningCategoryHighCopper'),
        message: i18n.t('warningMsgHighCopper', { cu: i18n.formatNumber(cu.toFixed(2)), severity: cu > 0.2 ? i18n.t('warningMsgThisMayCauseToxicity') : i18n.t('warningMsgThisIsOnTheHighEnd') })
      });
    }

    if (zn > 0.5) {
      warnings.push({
        level: zn > 1.0 ? 'warning' : 'info',
        category: i18n.t('warningCategoryHighZinc'),
        message: i18n.t('warningMsgHighZinc', { zn: i18n.formatNumber(zn.toFixed(2)), severity: zn > 1.0 ? i18n.t('warningMsgThisMayCauseToxicity') : i18n.t('warningMsgThisIsOnTheHighEnd') })
      });
    }

    if (mn > 2) {
      warnings.push({
        level: mn > 3 ? 'warning' : 'info',
        category: i18n.t('warningCategoryHighManganese'),
        message: i18n.t('warningMsgHighManganese', { mn: i18n.formatNumber(mn.toFixed(2)), severity: mn > 3 ? i18n.t('warningMsgThisMayCauseToxicity') : i18n.t('warningMsgThisIsOnTheHighEnd') })
      });
    }

    // ============================================================================
    // SECTION F: CALCULATOR SANITY CHECK
    // ============================================================================

    // 23. Charge balance (electroneutrality) - use data from ion balance section if available
    if (ionBalance && ionBalance.totalCations > 0.1) {
      // Use the properly calculated ion balance data
      if (ionBalance.imbalance > 15) {
        warnings.push({
          level: 'info',
          category: i18n.t('warningCategoryChargeBalance'),
          message: i18n.t('warningMsgChargeBalance', { imbalance: i18n.formatNumber(ionBalance.imbalance.toFixed(1)), cations: i18n.formatNumber(ionBalance.totalCations.toFixed(2)), anions: i18n.formatNumber(ionBalance.totalAnions.toFixed(2)) })
        });
      }
    }

    return warnings;
  }

  // Export
  window.FertilizerWarnings.checkWarnings = checkWarnings;

})();
