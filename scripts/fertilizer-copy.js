// =============================================================================
// FERTILIZER CALCULATOR - COPY TEXT BUILDERS
// =============================================================================
// Pure text generation functions for clipboard copy functionality.
// These accept data and a formatter object, returning plain text strings.
// Formatter object should have: t(key, params), formatNumber(num), formatNutrientLabel(key)
//
// Usage: Include this script after fertilizer-core.js
// =============================================================================

(function() {
  'use strict';

  // Ensure FertilizerCore namespace exists
  if (typeof window.FertilizerCore === 'undefined') {
    window.FertilizerCore = {};
  }

  /**
   * Build copy text for a single tank in two-tank system
   * @param {Object} tank - Tank data with fertilizers, nutrients, ionBalance
   * @param {string} letter - 'A' or 'B'
   * @param {string} mode - 'elemental' or 'oxide'
   * @param {Array} fertilizers - Fertilizer database array
   * @param {Object} fmt - Formatter with t(), formatNumber()
   * @returns {string} Formatted text for this tank
   */
  window.FertilizerCore.buildTankCopyText = function(tank, letter, mode, fertilizers, fmt) {
    const pLabel = mode === 'elemental' ? 'P' : 'P₂O₅';
    const kLabel = mode === 'elemental' ? 'K' : 'K₂O';

    let text = '';
    text += `───────────────────────────────────────────\n`;
    text += `  TANK ${letter}: ${tank.name.replace('Tank ' + letter + ' ', '').toUpperCase()}\n`;
    text += `───────────────────────────────────────────\n`;
    text += `${tank.description}\n\n`;

    const fertEntries = Object.entries(tank.fertilizers);
    if (fertEntries.length === 0) {
      text += 'No fertilizers in this tank\n\n';
      return text;
    }

    text += 'Fertilizers:\n';
    fertEntries.forEach(([fertId, grams]) => {
      const fert = fertilizers.find(f => f.id === fertId);
      if (fert) {
        text += `  • ${fert.name}: ${fmt.formatNumber(grams.toFixed(2))} ${fmt.t('gramsShort')}\n`;
      }
    });
    text += '\n';

    // PPM values
    const nutrients = tank.nutrients;
    const pVal = mode === 'elemental' ? nutrients.P : nutrients.P2O5;
    const kVal = mode === 'elemental' ? nutrients.K : nutrients.K2O;

    text += 'PPM Values:\n';
    if (nutrients.N_total > 0.01) text += `  ${fmt.t('nitrogen').padEnd(16)} ${fmt.formatNumber(nutrients.N_total.toFixed(2))} ppm\n`;
    if (pVal > 0.01) text += `  ${pLabel.padEnd(16)} ${fmt.formatNumber(pVal.toFixed(2))} ppm\n`;
    if (kVal > 0.01) text += `  ${kLabel.padEnd(16)} ${fmt.formatNumber(kVal.toFixed(2))} ppm\n`;
    if (nutrients.Ca > 0.01) text += `  ${fmt.t('calcium').padEnd(16)} ${fmt.formatNumber(nutrients.Ca.toFixed(2))} ppm\n`;
    if (nutrients.Mg > 0.01) text += `  ${fmt.t('magnesium').padEnd(16)} ${fmt.formatNumber(nutrients.Mg.toFixed(2))} ppm\n`;
    if (nutrients.S > 0.01) text += `  ${fmt.t('sulfur').padEnd(16)} ${fmt.formatNumber(nutrients.S.toFixed(2))} ppm\n`;
    text += '\n';

    // Nitrogen forms
    if (nutrients.N_total > 0.1) {
      const nh4Pct = (nutrients.N_NH4 / nutrients.N_total * 100) || 0;
      const no3Pct = (nutrients.N_NO3 / nutrients.N_total * 100) || 0;
      text += 'Nitrogen Forms:\n';
      text += `  NH₄-N: ${nutrients.N_NH4.toFixed(2)} ppm (${nh4Pct.toFixed(1)}%)\n`;
      text += `  NO₃-N: ${nutrients.N_NO3.toFixed(2)} ppm (${no3Pct.toFixed(1)}%)\n\n`;
    }

    // Ratios
    const npkValues = [nutrients.N_total, pVal, kVal].filter(v => v > 0.1);
    if (npkValues.length > 0 || (nutrients.Ca > 0.1 && nutrients.Mg > 0.1)) {
      text += 'Ratios:\n';
      if (npkValues.length > 0) {
        const minNPK = Math.min(...npkValues);
        text += `  N:${pLabel}:${kLabel} = ${(nutrients.N_total/minNPK).toFixed(1)} : ${(pVal/minNPK).toFixed(1)} : ${(kVal/minNPK).toFixed(1)}\n`;
      }
      if (nutrients.Ca > 0.1 && nutrients.Mg > 0.1) {
        text += `  Ca:Mg = ${(nutrients.Ca/nutrients.Mg).toFixed(2)} : 1\n`;
      }
      if (nutrients.N_total > 0.1 && nutrients.Ca > 0.1) {
        text += `  N:Ca = ${(nutrients.N_total/nutrients.Ca).toFixed(2)} : 1\n`;
      }
      text += '\n';
    }

    // Ion balance
    text += 'Ion Balance:\n';
    text += `  Cations: ${tank.ionBalance.totalCations.toFixed(2)} meq/L\n`;
    text += `  Anions:  ${tank.ionBalance.totalAnions.toFixed(2)} meq/L\n`;
    text += `  Balance: ${tank.ionBalance.imbalance.toFixed(1)}% (${tank.ionBalance.statusText})\n\n`;

    return text;
  };

  /**
   * Build copy text for two-tank results
   * @param {Object} data - { tankA, tankB, volume, mode, achieved }
   * @param {Array} fertilizers - Fertilizer database array
   * @param {Object} fmt - Formatter with t(), formatNumber()
   * @returns {string} Formatted text for clipboard
   */
  window.FertilizerCore.buildTwoTankCopyText = function(data, fertilizers, fmt) {
    const { tankA, tankB, volume, mode } = data;
    const pLabel = mode === 'elemental' ? 'P' : 'P₂O₅';
    const kLabel = mode === 'elemental' ? 'K' : 'K₂O';

    let text = '═══════════════════════════════════════════\n';
    text += '       TWO-TANK STOCK SOLUTION SYSTEM\n';
    text += '═══════════════════════════════════════════\n';
    text += `Volume: ${volume}L per tank\n\n`;

    // Tank A
    text += this.buildTankCopyText(tankA, 'A', mode, fertilizers, fmt);

    // Tank B
    text += this.buildTankCopyText(tankB, 'B', mode, fertilizers, fmt);

    // Combined solution
    const combinedNutrients = {
      N_total: tankA.nutrients.N_total + tankB.nutrients.N_total,
      N_NH4: tankA.nutrients.N_NH4 + tankB.nutrients.N_NH4,
      N_NO3: tankA.nutrients.N_NO3 + tankB.nutrients.N_NO3,
      P2O5: tankA.nutrients.P2O5 + tankB.nutrients.P2O5,
      P: tankA.nutrients.P + tankB.nutrients.P,
      K2O: tankA.nutrients.K2O + tankB.nutrients.K2O,
      K: tankA.nutrients.K + tankB.nutrients.K,
      Ca: tankA.nutrients.Ca + tankB.nutrients.Ca,
      Mg: tankA.nutrients.Mg + tankB.nutrients.Mg,
      S: tankA.nutrients.S + tankB.nutrients.S
    };

    text += '═══════════════════════════════════════════\n';
    text += '         COMBINED SOLUTION (Final Mix)\n';
    text += '═══════════════════════════════════════════\n\n';

    text += 'PPM Values:\n';
    text += '───────────────────────────────────────────\n';
    text += `  ${fmt.t('nitrogen').padEnd(16)} ${fmt.formatNumber(combinedNutrients.N_total.toFixed(2))} ppm\n`;
    const pVal = mode === 'elemental' ? combinedNutrients.P : combinedNutrients.P2O5;
    const kVal = mode === 'elemental' ? combinedNutrients.K : combinedNutrients.K2O;
    text += `  ${pLabel.padEnd(16)} ${fmt.formatNumber(pVal.toFixed(2))} ppm\n`;
    text += `  ${kLabel.padEnd(16)} ${fmt.formatNumber(kVal.toFixed(2))} ppm\n`;
    text += `  ${fmt.t('calcium').padEnd(16)} ${fmt.formatNumber(combinedNutrients.Ca.toFixed(2))} ppm\n`;
    text += `  ${fmt.t('magnesium').padEnd(16)} ${fmt.formatNumber(combinedNutrients.Mg.toFixed(2))} ppm\n`;
    text += `  ${fmt.t('sulfur').padEnd(16)} ${fmt.formatNumber(combinedNutrients.S.toFixed(2))} ppm\n\n`;

    // Nitrogen forms
    if (combinedNutrients.N_total > 0.1) {
      const nh4Pct = (combinedNutrients.N_NH4 / combinedNutrients.N_total * 100) || 0;
      const no3Pct = (combinedNutrients.N_NO3 / combinedNutrients.N_total * 100) || 0;
      text += 'Nitrogen Forms:\n';
      text += `  NH₄-N: ${combinedNutrients.N_NH4.toFixed(2)} ppm (${nh4Pct.toFixed(1)}%)\n`;
      text += `  NO₃-N: ${combinedNutrients.N_NO3.toFixed(2)} ppm (${no3Pct.toFixed(1)}%)\n\n`;
    }

    // Combined ratios
    const npkValues = [combinedNutrients.N_total, pVal, kVal].filter(v => v > 0.1);
    if (npkValues.length > 0) {
      const minNPK = Math.min(...npkValues);
      text += 'Nutrient Ratios:\n';
      text += '───────────────────────────────────────────\n';
      text += `  N:${pLabel}:${kLabel} = ${(combinedNutrients.N_total/minNPK).toFixed(1)} : ${(pVal/minNPK).toFixed(1)} : ${(kVal/minNPK).toFixed(1)}\n`;
      if (combinedNutrients.Ca > 0.1 && combinedNutrients.Mg > 0.1) {
        text += `  Ca:Mg = ${(combinedNutrients.Ca/combinedNutrients.Mg).toFixed(2)} : 1\n`;
      }
    }

    text += '\n═══════════════════════════════════════════\n';
    text += 'Generated by Fertilizer Calculator\n';
    text += 'https://bhattumang7.github.io/pages/fertilizer-calculator.html\n';
    text += '═══════════════════════════════════════════\n';

    return text;
  };

  /**
   * Build copy text for Grams to PPM results (Tab 1)
   * @param {Object} data - { activeFertilizers, volume, results, ecData, ionBalance, ratios }
   * @param {Object} fmt - Formatter with t(), formatNumber(), formatNutrientLabel()
   * @returns {string} Formatted text for clipboard
   */
  window.FertilizerCore.buildGramsToPpmCopyText = function(data, fmt) {
    const { activeFertilizers, volume, results, ecData, ionBalance, ratios } = data;

    let text = `*${fmt.t('shareTitle')}*\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Fertilizers used
    text += `*${fmt.t('shareFertilizersUsed')}* ${fmt.t('shareSolutionVolume', {volume: fmt.formatNumber(volume)})}\n`;
    activeFertilizers.forEach(fert => {
      text += `• ${fert.name}: *${fmt.formatNumber(fert.grams.toFixed(2))}g*\n`;
    });
    text += `\n`;

    // PPM Results
    text += `*${fmt.t('shareNutrientConcentrations')}*\n`;

    const displayOrder = [
      { key: 'N_total', labelKey: 'N_total' },
      { key: 'N_NO3', labelKey: 'N_NO3' },
      { key: 'N_NH4', labelKey: 'N_NH4' },
      { key: 'P', labelKey: 'P' },
      { key: 'K', labelKey: 'K' },
      { key: 'Ca', labelKey: 'Ca' },
      { key: 'Mg', labelKey: 'Mg' },
      { key: 'S', labelKey: 'S' },
      { key: 'Fe', labelKey: 'Fe' },
      { key: 'Mn', labelKey: 'Mn' },
      { key: 'Zn', labelKey: 'Zn' },
      { key: 'B', labelKey: 'B' },
      { key: 'Cu', labelKey: 'Cu' },
      { key: 'Mo', labelKey: 'Mo' }
    ];

    displayOrder.forEach(item => {
      if (results[item.key] !== undefined && results[item.key] > 0.01) {
        const label = fmt.formatNutrientLabel(item.labelKey);
        text += `• ${label}: *${fmt.formatNumber(results[item.key].toFixed(2))} ppm*\n`;
      }
    });
    text += `\n`;

    // Ion Balance
    if (ionBalance) {
      text += `*⚖️ ${fmt.t('ionBalance')}*\n`;
      text += `• ${fmt.t('cations')}: *${fmt.formatNumber(ionBalance.totalCations.toFixed(2))} ${fmt.t('meqPerLiter')}*\n`;
      text += `• ${fmt.t('anions')}: *${fmt.formatNumber(ionBalance.totalAnions.toFixed(2))} ${fmt.t('meqPerLiter')}*\n`;
      text += `• ${fmt.t('imbalance')}: *${fmt.formatNumber(ionBalance.imbalance.toFixed(1))}%* (${ionBalance.statusText})\n`;
      text += `\n`;
    }

    // EC Prediction
    if (ecData && ecData.ec) {
      text += `*⚡ ${fmt.t('ecPrediction')}*\n`;
      text += `• ${fmt.t('ecLabel')} *${fmt.formatNumber(ecData.ec.toFixed(2))} ${fmt.t('mScmUnit')}*\n`;
      text += `\n`;
    }

    // Key Ratios
    if (ratios && ratios.length > 0) {
      text += `*${fmt.t('shareKeyRatios')}*\n`;
      ratios.slice(0, 4).forEach(ratio => {
        text += `• ${ratio.name}: *${ratio.ratio}*\n`;
      });
      text += `\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `_${fmt.t('shareGeneratedBy')}_`;

    return text;
  };

  /**
   * Build copy text for Formula Builder results (Tab 2)
   * @param {Object} data - { result, targets, volume, mode }
   * @param {Array} fertilizers - Fertilizer database array
   * @param {Object} ionBalance - Pre-calculated ion balance or null
   * @param {Object} fmt - Formatter with t(), formatNumber()
   * @returns {string} Formatted text for clipboard
   */
  window.FertilizerCore.buildFormulaCopyText = function(data, fertilizers, ionBalance, fmt) {
    const { result, targets, volume, mode } = data;

    let text = `*${fmt.t('shareFormulaBuilderTitle')}*\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Target values
    text += `*${fmt.t('shareTargetPpmValues')}*\n`;
    const targetLabels = mode === 'elemental'
      ? { N: 'N', P: 'P', K: 'K', Ca: 'Ca', Mg: 'Mg', S: 'S' }
      : { N: 'N', P: 'P₂O₅', K: 'K₂O', Ca: 'Ca', Mg: 'Mg', S: 'S' };

    Object.entries(targets).forEach(([key, value]) => {
      if (value > 0) {
        const label = targetLabels[key] || key;
        text += `${fmt.t('shareLabelValuePpm', {label: label, value: fmt.formatNumber(value)})}\n`;
      }
    });
    text += `\n`;

    // Fertilizers to add
    text += `*${fmt.t('shareFertilizersToAddVolume', {volume: fmt.formatNumber(volume)})}*\n`;
    const activeFertilizers = Object.entries(result.formula)
      .filter(([, grams]) => grams > 0.01)
      .map(([id, grams]) => {
        const fert = fertilizers.find(f => f.id === id);
        return { name: fert ? fert.name : id, grams };
      });

    if (activeFertilizers.length === 0) {
      text += `_${fmt.t('shareNoSuitableFormula')}_\n`;
    } else {
      activeFertilizers.forEach(fert => {
        text += `${fmt.t('shareFertilizerGrams', {name: fert.name, grams: fmt.formatNumber(fert.grams.toFixed(2))})}\n`;
      });
    }
    text += `\n`;

    // Achieved values
    text += `*${fmt.t('shareAchievedPpm')}*\n`;
    const achievedOrder = mode === 'elemental'
      ? [
          { key: 'N_total', label: 'N' },
          { key: 'P', label: 'P' },
          { key: 'K', label: 'K' },
          { key: 'Ca', label: 'Ca' },
          { key: 'Mg', label: 'Mg' },
          { key: 'S', label: 'S' }
        ]
      : [
          { key: 'N_total', label: 'N' },
          { key: 'P2O5', label: 'P₂O₅' },
          { key: 'K2O', label: 'K₂O' },
          { key: 'Ca', label: 'Ca' },
          { key: 'Mg', label: 'Mg' },
          { key: 'S', label: 'S' }
        ];

    achievedOrder.forEach(item => {
      const value = result.achieved[item.key];
      if (value !== undefined && value > 0.01) {
        text += `${fmt.t('shareLabelValuePpm', {label: item.label, value: fmt.formatNumber(value.toFixed(1))})}\n`;
      }
    });
    text += `\n`;

    // Ion Balance
    if (ionBalance) {
      text += `*${fmt.t('shareIonBalance')}*\n`;
      text += `${fmt.t('shareCationsValue', {value: fmt.formatNumber(ionBalance.totalCations.toFixed(2))})}\n`;
      text += `${fmt.t('shareAnionsValue', {value: fmt.formatNumber(ionBalance.totalAnions.toFixed(2))})}\n`;
      text += `${fmt.t('shareImbalanceValue', {value: fmt.formatNumber(ionBalance.imbalance.toFixed(1)), status: ionBalance.statusText})}\n`;
      text += `\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `_${fmt.t('shareGeneratedBy')}_`;

    return text;
  };

  /**
   * Build copy text for Reverse Calculator results (Tab 3)
   * @param {Object} data - { result, targets, volume, calculationMode }
   * @param {Array} fertilizers - Fertilizer database array
   * @param {Object} ionBalance - Pre-calculated ion balance or null
   * @param {Object} fmt - Formatter with t(), formatNumber()
   * @returns {string} Formatted text for clipboard
   */
  window.FertilizerCore.buildReverseCopyText = function(data, fertilizers, ionBalance, fmt) {
    const { result, targets, volume, calculationMode } = data;

    let text = `*${fmt.t('shareNpkRatioTitle')}*\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Target ratios
    text += `*${fmt.t('shareTargetRatios')}*\n`;
    const targetLabels = calculationMode === 'elemental'
      ? { N: 'N', P: 'P', K: 'K', Ca: 'Ca', Mg: 'Mg', S: 'S' }
      : { N: 'N', P: 'P₂O₅', K: 'K₂O', Ca: 'Ca', Mg: 'Mg', S: 'S' };

    const targetParts = [];
    ['N', 'P', 'K', 'Ca', 'Mg', 'S'].forEach(key => {
      if (targets[key] > 0) {
        const label = targetLabels[key] || key;
        targetParts.push(`${label}:${fmt.formatNumber(targets[key])}`);
      }
    });
    text += `${fmt.t('shareRatioValue', {ratio: targetParts.join(' : ')})}\n\n`;

    // Fertilizers to add
    text += `*${fmt.t('shareFertilizersToAddVolume', {volume: fmt.formatNumber(volume)})}*\n`;
    const activeFertilizers = Object.entries(result.formula)
      .filter(([, grams]) => grams > 0.01)
      .map(([id, grams]) => {
        const fert = fertilizers.find(f => f.id === id);
        return { name: fert ? fert.name : id, grams };
      });

    if (activeFertilizers.length === 0) {
      text += `_${fmt.t('shareNoSuitableFormula')}_\n`;
    } else {
      activeFertilizers.forEach(fert => {
        text += `${fmt.t('shareFertilizerGrams', {name: fert.name, grams: fmt.formatNumber(fert.grams.toFixed(2))})}\n`;
      });
    }
    text += `\n`;

    // Achieved PPM values
    text += `*${fmt.t('shareAchievedPpm')}*\n`;
    const achievedOrder = calculationMode === 'elemental'
      ? [
          { key: 'N_total', label: 'N' },
          { key: 'P', label: 'P' },
          { key: 'K', label: 'K' },
          { key: 'Ca', label: 'Ca' },
          { key: 'Mg', label: 'Mg' },
          { key: 'S', label: 'S' }
        ]
      : [
          { key: 'N_total', label: 'N' },
          { key: 'P2O5', label: 'P₂O₅' },
          { key: 'K2O', label: 'K₂O' },
          { key: 'Ca', label: 'Ca' },
          { key: 'Mg', label: 'Mg' },
          { key: 'S', label: 'S' }
        ];

    achievedOrder.forEach(item => {
      const value = result.achieved[item.key];
      if (value !== undefined && value > 0.01) {
        text += `${fmt.t('shareLabelValuePpm', {label: item.label, value: fmt.formatNumber(value.toFixed(1))})}\n`;
      }
    });
    text += `\n`;

    // Nitrogen breakdown
    if (result.achieved.N_NO3 > 0 || result.achieved.N_NH4 > 0) {
      text += `*${fmt.t('shareNitrogenForms')}*\n`;
      text += `${fmt.t('shareNo3N', {value: fmt.formatNumber(result.achieved.N_NO3.toFixed(1))})}\n`;
      text += `${fmt.t('shareNh4N', {value: fmt.formatNumber(result.achieved.N_NH4.toFixed(1))})}\n`;
      const nh4Percent = result.achieved.N_total > 0 ? (result.achieved.N_NH4 / result.achieved.N_total * 100) : 0;
      text += `${fmt.t('shareNh4Ratio', {value: fmt.formatNumber(nh4Percent.toFixed(0))})}\n`;
      text += `\n`;
    }

    // Ion Balance
    if (ionBalance) {
      text += `*${fmt.t('shareIonBalance')}*\n`;
      text += `${fmt.t('shareCationsValue', {value: fmt.formatNumber(ionBalance.totalCations.toFixed(2))})}\n`;
      text += `${fmt.t('shareAnionsValue', {value: fmt.formatNumber(ionBalance.totalAnions.toFixed(2))})}\n`;
      text += `${fmt.t('shareImbalanceValue', {value: fmt.formatNumber(ionBalance.imbalance.toFixed(1)), status: ionBalance.statusText})}\n`;
      text += `\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `_${fmt.t('shareGeneratedBy')}_`;

    return text;
  };

})();
