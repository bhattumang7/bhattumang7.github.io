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
// FERTILIZER DATABASE
// =============================================================================

window.FertilizerCore.FERTILIZERS = [
  {
    id: "calcium_nitrate_calcinit_typical",
    name: "Calcium Nitrate - Calcinit type (15.5% N, 19% Ca)",
    aliases: ["YaraLiva Calcinit", "Calcium nitrate 15.5-0-0 + Ca", "Calcinit"],
    pct: { N_total: 15.5, N_NO3: 14.4, N_NH4: 1.1, Ca: 19.0 }
  },
  {
    id: "potassium_nitrate_typical",
    name: "Potassium Nitrate",
    aliases: ["KNO3", "13.7-0-46.3"],
    pct: { N_total: 13.7, N_NO3: 13.7, K2O: 46.3 }
  },
  {
    id: "map_typical",
    name: "Mono Ammonium Phosphate (MAP)",
    aliases: ["NH4H2PO4", "12-61-0", "12 61", "12:61" ],
    pct: { N_total: 12.0, N_NH4: 12.0, P2O5: 61.0 }
  },
  {
    id: "mkp_typical",
    name: "Mono Potassium Phosphate (MKP)",
    aliases: ["KH2PO4", "0-52-34", "0:52:34", "52 34"],
    pct: { P2O5: 52.0, K2O: 34.0 }
  },
  {
    id: "dap_common",
    name: "Di Ammonium Phosphate (DAP)",
    aliases: ["(NH4)2HPO4", "18-46-0"],
    pct: { N_total: 18.0, N_NH4: 18.0, P2O5: 46.0 }
  },
  {
    id: "ssp_common",
    name: "Single Super Phosphate (SSP)",
    aliases: ["SSP", "Superphosphate", "0-16-0", "Ca(H2PO4)2"],
    pct: { P2O5: 16.0, Ca: 20.0, S: 12.0 }
  },
  {
    id: "urea_common",
    name: "Urea",
    aliases: ["CO(NH2)2", "46-0-0"],
    pct: { N_total: 46.0, N_Urea: 46.0 }
  },
  {
    id: "ammonium_sulfate_common",
    name: "Ammonium Sulfate",
    aliases: ["(NH4)2SO4", "21-0-0 + 24S"],
    pct: { N_total: 21.0, N_NH4: 21.0, S: 24.0 }
  },
  {
    id: "ammonium_nitrate_common",
    name: "Ammonium Nitrate - Solid (34% N)",
    aliases: ["NH4NO3", "34-0-0 (typical)", "Ammonium Nitrate solid"],
    pct: { N_total: 34.0, N_NO3: 17.0, N_NH4: 17.0 }
  },
  {
    id: "magnesium_sulfate_heptahydrate_common",
    name: "Magnesium Sulfate - Heptahydrate / Epsom Salt (9.86% Mg)",
    aliases: ["MgSO4·7H2O", "Epsom Salt", "Magnesium Sulfate 7H2O"],
    pct: { Mg: 9.86, S: 13.0 }
  },
  {
    id: "magnesium_sulfate_16mgo",
    name: "Magnesium Sulfate (16% MgO) (~9.6% Mg, ~13% S)",
    aliases: ["MgSO4", "Magnesium Sulphate", "Epsom Salt", "MgSO4·7H2O (if heptahydrate)"],
    pct: { MgO: 16.0, Mg: 9.6, S: 13.0 }
  },
  {
    id: "magnesium_nitrate_hexahydrate_typical",
    name: "Magnesium Nitrate - Hexahydrate (10.9% N, 9.5% Mg)",
    aliases: ["Mg(NO3)2·6H2O", "Magnesium Nitrate 6H2O"],
    pct: { N_total: 10.9, N_NO3: 10.9, Mg: 9.5 }
  },
  {
    id: "potassium_sulfate_common",
    name: "Potassium Sulfate (SOP)",
    aliases: ["K2SO4", "0-0-50 + ~17S"],
    pct: { K2O: 50.0, S: 17.0 }
  },
  {
    id: "potassium_chloride_common",
    name: "Potassium Chloride (MOP)",
    aliases: ["KCl", "0-0-60"],
    pct: { K2O: 60.0, Cl: 47.6 }
  },
  {
    id: "calcium_chloride_dihydrate_common",
    name: "Calcium Chloride - Dihydrate (27.2% Ca)",
    aliases: ["CaCl2·2H2O", "Calcium Chloride 2H2O"],
    pct: { Ca: 27.2, Cl: 48.3 }
  },
  {
    id: "langbeinite_common",
    name: "Langbeinite / Sul-Po-Mag",
    aliases: ["K2SO4·2MgSO4", "0-0-22 + 11Mg + 22S"],
    pct: { K2O: 22.0, Mg: 11.0, S: 22.0 }
  },
  {
    id: "uan32_solution_typical",
    name: "UAN Solution (example: 32-0-0)",
    aliases: ["UAN-32"],
    pct: { N_total: 32.0, N_Urea: 16.0, N_NO3: 8.0, N_NH4: 8.0 }
  },
  {
    id: "ammonium_thiosulfate_common",
    name: "Ammonium Thiosulfate (ATS)",
    aliases: ["12-0-0-26S (common liquid)"],
    pct: { N_total: 12.0, N_NH4: 12.0, S: 26.0 }
  },
  {
    id: "potassium_thiosulfate_common",
    name: "Potassium Thiosulfate (KTS)",
    aliases: ["0-0-25-17S (common liquid)"],
    pct: { K2O: 25.0, S: 17.0 }
  },
  {
    id: "fe_edta_13",
    name: "Iron Chelate - EDTA (13% Fe)",
    aliases: ["Fe-EDTA 13", "Fe-EDTA 13%"],
    pct: { Fe: 13.0 }
  },
  {
    id: "boric_acid_common",
    name: "Boric Acid",
    aliases: ["H3BO3"],
    pct: { B: 17.5 }
  },
  {
    id: "zinc_sulfate_heptahydrate_common",
    name: "Zinc Sulfate - Heptahydrate (22.7% Zn)",
    aliases: ["ZnSO4·7H2O", "Zinc Sulfate 7H2O"],
    pct: { Zn: 22.7, S: 11.2 }
  },
  {
    id: "nitric_acid_38",
    name: "Nitric Acid 38%",
    aliases: ["HNO3 38%"],
    pct: { N_total: 8.4, N_NO3: 8.4 }
  },
  {
    id: "nitric_acid_60",
    name: "Nitric Acid 60%",
    aliases: ["HNO3 60%"],
    pct: { N_total: 13.3, N_NO3: 13.3 }
  },
  {
    id: "phosphoric_acid_49",
    name: "Phosphoric Acid 49%",
    aliases: ["H3PO4 49%"],
    pct: { P: 18.6 }
  },
  {
    id: "potassium_bicarbonate",
    name: "Potassium Bicarbonate",
    aliases: ["KHCO3"],
    pct: { K: 39.0 }
  },
  {
    id: "ammonium_nitrate_liquid",
    name: "Ammonium Nitrate - Liquid (18% N)",
    aliases: ["NH4NO3 liquid", "Ammonium Nitrate liquid"],
    pct: { N_total: 18.0, N_NO3: 9.0, N_NH4: 9.0 }
  },
  {
    id: "urea_phosphate",
    name: "Urea Phosphate",
    aliases: ["CO(NH2)2·H3PO4"],
    pct: { N_total: 17.5, N_Urea: 17.5, P: 19.6 }
  },
  {
    id: "calcium_nitrate_4h2o",
    name: "Calcium Nitrate - Tetrahydrate (11.5% N, 16.5% Ca)",
    aliases: ["Ca(NO3)2·4H2O", "Calcium Nitrate 4H2O"],
    pct: { N_total: 11.5, N_NO3: 11.5, Ca: 16.5 }
  },
  {
    id: "calcium_nitrate_anhydrous",
    name: "Calcium Nitrate - Anhydrous (15.5% N, 18.5% Ca)",
    aliases: ["Ca(NO3)2", "Calcium Nitrate anhydrous"],
    pct: { N_total: 15.5, N_NO3: 15.5, Ca: 18.5 }
  },
  {
    id: "calcium_nitrate_liquid",
    name: "Calcium Nitrate - Liquid (8.7% N, 12.5% Ca)",
    aliases: ["Ca(NO3)2 liquid", "Calcium Nitrate liquid"],
    pct: { N_total: 8.7, N_NO3: 8.7, Ca: 12.5 }
  },
  {
    id: "calcium_chloride_solid",
    name: "Calcium Chloride - Solid (36% Ca)",
    aliases: ["CaCl2 solid", "Calcium Chloride solid"],
    pct: { Ca: 36.0, Cl: 63.9 }
  },
  {
    id: "calcium_chloride_liquid",
    name: "Calcium Chloride - Liquid (11.8% Ca)",
    aliases: ["CaCl2 liquid", "Calcium Chloride liquid"],
    pct: { Ca: 11.8, Cl: 20.9 }
  },
  {
    id: "magnesium_sulfate_anhydrous",
    name: "Magnesium Sulfate - Anhydrous (19.6% Mg)",
    aliases: ["MgSO4", "Magnesium Sulfate anhydrous"],
    pct: { Mg: 19.6, S: 26.5 }
  },
  {
    id: "magnesium_nitrate_liquid",
    name: "Magnesium Nitrate - Liquid (7% N, 6.1% Mg)",
    aliases: ["Mg(NO3)2 liquid", "Magnesium Nitrate liquid"],
    pct: { N_total: 7.0, N_NO3: 7.0, Mg: 6.1 }
  },
  {
    id: "fe_dtpa_12",
    name: "Iron Chelate - DTPA solid (12% Fe)",
    aliases: ["Fe-DTPA 12%", "Fe-DTPA 12"],
    pct: { Fe: 12.0 }
  },
  {
    id: "fe_dtpa_liquid_3",
    name: "Iron Chelate - DTPA liquid (3% Fe)",
    aliases: ["Fe-DTPA 3%", "Fe-DTPA 3"],
    pct: { Fe: 3.0 }
  },
  {
    id: "fe_dtpa_liquid_6",
    name: "Iron Chelate - DTPA liquid (6% Fe)",
    aliases: ["Fe-DTPA 6%", "Fe-DTPA 6"],
    pct: { Fe: 6.0 }
  },
  {
    id: "fe_eddha_6",
    name: "Iron Chelate - EDDHA (6% Fe)",
    aliases: ["Fe-EDDHA 6%", "Fe-EDDHA 6"],
    pct: { Fe: 6.0 }
  },
  {
    id: "fe_hbed_6",
    name: "Iron Chelate - HBED (6% Fe)",
    aliases: ["Fe-HBED 6%", "Fe-HBED 6"],
    pct: { Fe: 6.0 }
  },
  {
    id: "mn_edta_13",
    name: "Manganese Chelate - EDTA (13% Mn)",
    aliases: ["Mn-EDTA 13%", "Mn-EDTA 13"],
    pct: { Mn: 13.0 }
  },
  {
    id: "zn_edta_15",
    name: "Zinc Chelate - EDTA (15% Zn)",
    aliases: ["Zn-EDTA 15%", "Zn-EDTA 15"],
    pct: { Zn: 15.0 }
  },
  {
    id: "cu_edta_15",
    name: "Copper Chelate - EDTA (15% Cu)",
    aliases: ["Cu-EDTA 15%", "Cu-EDTA 15"],
    pct: { Cu: 15.0 }
  },
  {
    id: "manganese_sulfate",
    name: "Manganese Sulfate",
    aliases: ["MnSO4·H2O"],
    pct: { Mn: 32.5, S: 18.9 }
  },
  {
    id: "zinc_sulfate_mono",
    name: "Zinc Sulfate - Monohydrate (36% Zn)",
    aliases: ["ZnSO4·H2O", "Zinc Sulfate H2O"],
    pct: { Zn: 36.0 }
  },
  {
    id: "borax",
    name: "Borax",
    aliases: ["Na2B4O7·10H2O"],
    pct: { B: 11.3 }
  },
  {
    id: "copper_sulfate",
    name: "Copper Sulfate",
    aliases: ["CuSO4·5H2O"],
    pct: { Cu: 25.5, S: 12.8 }
  },
  {
    id: "sodium_molybdate",
    name: "Sodium Molybdate",
    aliases: ["Na2MoO4·2H2O"],
    pct: { Mo: 39.6 }
  },
  {
    id: "ammonium_molybdate",
    name: "Ammonium Molybdate",
    aliases: ["(NH4)6Mo7O24·4H2O"],
    pct: { Mo: 52.0, N_total: 8.0, N_NH4: 8.0 }
  },
  {
    id: "potassium_silicate_liquid_typical",
    name: "Potassium Silicate (12% Si, 18% K2O)",
    aliases: ["Potassium Silicate", "Pro-TeKt", "Liquid Potassium Silicate", "K2SiO3 solution"],
    pct: { K2O: 18, Si: 12 }
  },
  {
    id: "rexolin_cxk",
    name: "Rexolin CXK (Chelated Micronutrient Mix)",
    aliases: ["Rexolin CXK", "CXK"],
    pct: { Fe: 3.4, Mn: 3.2, Zn: 4.2, B: 1.5, Mg: 1.2, Mo: 0.05 }
  },
  {
    id: "utkarsh_double_combi",
    name: "Utkarsh Double Combi (Micronutrient Mix)",
    aliases: ["Utkarsh Double Combi", "Double Combi"],
    pct: { Ca: 1.0, Mg: 2.5, Zn: 2.0, Fe: 2.0, Mn: 1.0, B: 1.0, Cu: 0.5, Mo: 0.05, Co: 0.005 }
  },
  {
    id: "haifa_17_10_27",
    name: "Haifa 17:10:27 (17% N, 10% P₂O₅, 27% K₂O)",
    aliases: ["Haifa 17:10:27", "17:10:27", "17-10-27"],
    pct: { N_total: 17, N_NO3: 11.3, N_NH4: 5.7, P2O5: 10, K2O: 27 }
  }
];

// =============================================================================
// CHEMICAL CONSTANTS
// =============================================================================

// Conversion factors for oxides to elements
window.FertilizerCore.OXIDE_CONVERSIONS = {
  P2O5_to_P: 0.43646,
  K2O_to_K: 0.83013,
  CaO_to_Ca: 0.71469,
  MgO_to_Mg: 0.60317,
  SO3_to_S: 0.40059,
  SiO2_to_Si: 0.46744,
  SiOH4_to_Si: 0.2922  // Si(OH)4 orthosilicic acid to elemental Si
};

// Molar masses for nutrients (g/mol) - for EC calculation
window.FertilizerCore.MOLAR_MASSES = {
  'N_NO3': 14.007,
  'N_NH4': 14.007,
  'P': 30.974,
  'K': 39.098,
  'Mg': 24.305,
  'Ca': 40.078,
  'S': 32.065,
  'Fe': 55.845,
  'Mn': 54.938,
  'Zn': 65.38,
  'B': 10.811,
  'Cu': 63.546,
  'Mo': 95.95,
  'Na': 22.99,
  'Cl': 35.453
};

// Ionic charges (absolute values) - legacy, for backward compatibility
window.FertilizerCore.IONIC_CHARGES = {
  'N_NO3': 1,
  'N_NH4': 1,
  'P': 1,      // H2PO4- form
  'K': 1,
  'Mg': 2,
  'Ca': 2,
  'S': 2,      // SO4 2- form
  'Fe': 2,
  'Mn': 2,
  'Zn': 2,
  'B': 1,      // typically present as borate
  'Cu': 2,
  'Mo': 2,
  'Na': 1,
  'Cl': 1
};

// EC contribution factors - LEGACY, kept for backward compatibility
// Units: S·cm²/mol (molar conductivity)
window.FertilizerCore.EC_CONTRIBUTIONS = {
  'N_NO3': 71.46,
  'N_NH4': 73.5,
  'P': 57,         // H2PO4-
  'K': 73,
  'Mg': 106,
  'Ca': 119,
  'S': 160,        // SO4 2-
  'Fe': 108.0,
  'Mn': 0,         // negligible
  'Zn': 0,         // negligible
  'B': 0,          // negligible
  'Cu': 0,         // negligible
  'Mo': 76.35,
  'Na': 50.01,
  'Cl': 0
};

// Ionic Molar Conductivity at Infinite Dilution (25°C)
// λ (lambda) values in S·cm²/mol at 25°C
// Formula: EC (mS/cm) = 0.001 × Σ(λᵢ × cᵢ) where cᵢ is in mmol/L
window.FertilizerCore.IONIC_MOLAR_CONDUCTIVITY = {
  // CATIONS
  'K+': 73.5,
  'Na+': 50.1,
  'NH4+': 73.5,
  'Ca2+': 119.0,
  'Mg2+': 106.0,
  'Fe2+': 108.0,
  'Fe3+': 204.0,
  'Mn2+': 107.0,
  'Zn2+': 105.6,
  'Cu2+': 107.2,
  // ANIONS
  'NO3-': 71.5,
  'Cl-': 76.3,
  'SO4^2-': 160.0,
  'H2PO4-': 33.5,
  'HPO4^2-': 114.0,
  'HCO3-': 44.5,
  'OH-': 198.0,
  'H+': 349.8
};

// Ionic charges for EC calculation
window.FertilizerCore.ION_CHARGES = {
  'K+': 1,
  'Na+': 1,
  'NH4+': 1,
  'Ca2+': 2,
  'Mg2+': 2,
  'Fe2+': 2,
  'Fe3+': 3,
  'Mn2+': 2,
  'Zn2+': 2,
  'Cu2+': 2,
  'NO3-': 1,
  'Cl-': 1,
  'SO4^2-': 2,
  'H2PO4-': 1,
  'HPO4^2-': 2,
  'HCO3-': 1,
  'OH-': 1,
  'H+': 1
};

// Ion balance data: molar mass and ions for each fertilizer
window.FertilizerCore.ION_DATA = {
  potassium_nitrate_typical: {
    formula: 'KNO₃',
    molarMass: 101.1,
    ions: [
      {ion: 'K⁺', charge: 1, count: 1, type: 'cation'},
      {ion: 'NO₃⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  map_typical: {
    formula: 'NH₄H₂PO₄',
    molarMass: 115,
    ions: [
      {ion: 'NH₄⁺', charge: 1, count: 1, type: 'cation'},
      {ion: 'H₂PO₄⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  mkp_typical: {
    formula: 'KH₂PO₄',
    molarMass: 136.1,
    ions: [
      {ion: 'K⁺', charge: 1, count: 1, type: 'cation'},
      {ion: 'H₂PO₄⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  dap_common: {
    formula: '(NH₄)₂HPO₄',
    molarMass: 132.1,
    ions: [
      {ion: 'NH₄⁺', charge: 1, count: 2, type: 'cation'},
      {ion: 'HPO₄²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  ammonium_sulfate_common: {
    formula: '(NH₄)₂SO₄',
    molarMass: 132.14,
    ions: [
      {ion: 'NH₄⁺', charge: 1, count: 2, type: 'cation'},
      {ion: 'SO₄²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  ammonium_nitrate_common: {
    formula: 'NH₄NO₃',
    molarMass: 80,
    ions: [
      {ion: 'NH₄⁺', charge: 1, count: 1, type: 'cation'},
      {ion: 'NO₃⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  ammonium_nitrate_liquid: {
    formula: 'NH₄NO₃',
    molarMass: 80,
    ions: [
      {ion: 'NH₄⁺', charge: 1, count: 1, type: 'cation'},
      {ion: 'NO₃⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  magnesium_sulfate_heptahydrate_common: {
    formula: 'MgSO₄·7H₂O',
    molarMass: 246.47,
    ions: [
      {ion: 'Mg²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'SO₄²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  magnesium_sulfate_anhydrous: {
    formula: 'MgSO₄',
    molarMass: 120.37,
    ions: [
      {ion: 'Mg²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'SO₄²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  magnesium_nitrate_hexahydrate_typical: {
    formula: 'Mg(NO₃)₂·6H₂O',
    molarMass: 256,
    ions: [
      {ion: 'Mg²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'NO₃⁻', charge: 1, count: 2, type: 'anion'}
    ]
  },
  magnesium_nitrate_liquid: {
    formula: 'Mg(NO₃)₂',
    molarMass: 148.3,
    ions: [
      {ion: 'Mg²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'NO₃⁻', charge: 1, count: 2, type: 'anion'}
    ]
  },
  potassium_sulfate_common: {
    formula: 'K₂SO₄',
    molarMass: 174.3,
    ions: [
      {ion: 'K⁺', charge: 1, count: 2, type: 'cation'},
      {ion: 'SO₄²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  potassium_chloride_common: {
    formula: 'KCl',
    molarMass: 74.6,
    ions: [
      {ion: 'K⁺', charge: 1, count: 1, type: 'cation'},
      {ion: 'Cl⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  calcium_nitrate_calcinit_typical: {
    formula: '5Ca(NO₃)₂·NH₄NO₃·10H₂O',
    molarMass: 1080,
    ions: [
      {ion: 'Ca²⁺', charge: 2, count: 5, type: 'cation'},
      {ion: 'NH₄⁺', charge: 1, count: 1, type: 'cation'},
      {ion: 'NO₃⁻', charge: 1, count: 11, type: 'anion'}
    ]
  },
  calcium_nitrate_4h2o: {
    formula: 'Ca(NO₃)₂·4H₂O',
    molarMass: 236.18,
    ions: [
      {ion: 'Ca²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'NO₃⁻', charge: 1, count: 2, type: 'anion'}
    ]
  },
  calcium_nitrate_anhydrous: {
    formula: 'Ca(NO₃)₂',
    molarMass: 164.1,
    ions: [
      {ion: 'Ca²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'NO₃⁻', charge: 1, count: 2, type: 'anion'}
    ]
  },
  calcium_chloride_dihydrate_common: {
    formula: 'CaCl₂·2H₂O',
    molarMass: 147,
    ions: [
      {ion: 'Ca²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'Cl⁻', charge: 1, count: 2, type: 'anion'}
    ]
  },
  calcium_chloride_solid: {
    formula: 'CaCl₂',
    molarMass: 111,
    ions: [
      {ion: 'Ca²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'Cl⁻', charge: 1, count: 2, type: 'anion'}
    ]
  },
  nitric_acid_38: {
    formula: 'HNO₃',
    molarMass: 167,
    ions: [
      {ion: 'NO₃⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  nitric_acid_60: {
    formula: 'HNO₃',
    molarMass: 105,
    ions: [
      {ion: 'NO₃⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  phosphoric_acid_49: {
    formula: 'H₃PO₄',
    molarMass: 167,
    ions: [
      {ion: 'H₂PO₄⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  calcium_nitrate_liquid: {
    formula: 'Ca(NO₃)₂',
    molarMass: 164.1,
    ions: [
      {ion: 'Ca²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'NO₃⁻', charge: 1, count: 2, type: 'anion'}
    ]
  },
  calcium_chloride_liquid: {
    formula: 'CaCl₂',
    molarMass: 111,
    ions: [
      {ion: 'Ca²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'Cl⁻', charge: 1, count: 2, type: 'anion'}
    ]
  },
  langbeinite_common: {
    formula: 'K₂Mg₂(SO₄)₃',
    molarMass: 415,
    ions: [
      {ion: 'K⁺', charge: 1, count: 2, type: 'cation'},
      {ion: 'Mg²⁺', charge: 2, count: 2, type: 'cation'},
      {ion: 'SO₄²⁻', charge: 2, count: 3, type: 'anion'}
    ]
  },
  ammonium_thiosulfate_common: {
    formula: '(NH₄)₂S₂O₃',
    molarMass: 148.2,
    ions: [
      {ion: 'NH₄⁺', charge: 1, count: 2, type: 'cation'},
      {ion: 'S₂O₃²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  potassium_thiosulfate_common: {
    formula: 'K₂S₂O₃',
    molarMass: 190.3,
    ions: [
      {ion: 'K⁺', charge: 1, count: 2, type: 'cation'},
      {ion: 'S₂O₃²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  potassium_bicarbonate: {
    formula: 'KHCO₃',
    molarMass: 100.1,
    ions: [
      {ion: 'K⁺', charge: 1, count: 1, type: 'cation'},
      {ion: 'HCO₃⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  urea_phosphate: {
    formula: 'CO(NH₂)₂·H₃PO₄',
    molarMass: 158.1,
    ions: [
      {ion: 'H₂PO₄⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  manganese_sulfate: {
    formula: 'MnSO₄',
    molarMass: 169,
    ions: [
      {ion: 'Mn²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'SO₄²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  zinc_sulfate_heptahydrate_common: {
    formula: 'ZnSO₄·7H₂O',
    molarMass: 287.6,
    ions: [
      {ion: 'Zn²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'SO₄²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  zinc_sulfate_mono: {
    molarMass: 179.5,
    ions: [
      {ion: 'Zn²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'SO₄²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  copper_sulfate: {
    molarMass: 249.7,
    ions: [
      {ion: 'Cu²⁺', charge: 2, count: 1, type: 'cation'},
      {ion: 'SO₄²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  sodium_molybdate: {
    molarMass: 241.9,
    ions: [
      {ion: 'Na⁺', charge: 1, count: 2, type: 'cation'},
      {ion: 'MoO₄²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  ammonium_molybdate: {
    molarMass: 1235.9,
    ions: [
      {ion: 'NH₄⁺', charge: 1, count: 6, type: 'cation'},
      {ion: 'Mo₇O₂₄⁶⁻', charge: 6, count: 1, type: 'anion'}
    ]
  },
  uan32_solution_typical: {
    molarMass: 160,
    ions: [
      {ion: 'NH₄⁺', charge: 1, count: 1, type: 'cation'},
      {ion: 'NO₃⁻', charge: 1, count: 1, type: 'anion'}
    ]
  },
  borax: {
    molarMass: 381.4,
    ions: [
      {ion: 'Na⁺', charge: 1, count: 2, type: 'cation'},
      {ion: 'B₄O₇²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  },
  potassium_silicate_liquid_typical: {
    molarMass: 154.3,
    ions: [
      {ion: 'K⁺', charge: 1, count: 2, type: 'cation'},
      {ion: 'SiO₃²⁻', charge: 2, count: 1, type: 'anion'}
    ]
  }
};

// Common fertilizers (most frequently used)
window.FertilizerCore.COMMON_FERTILIZERS = [
  'calcium_nitrate_calcinit_typical',
  'potassium_nitrate_typical',
  'map_typical',
  'mkp_typical',
  'magnesium_sulfate_heptahydrate_common'
];

// Fertilizer compatibility groups for two-tank system
window.FertilizerCore.FERTILIZER_COMPATIBILITY = {
  calcium_sources: [
    'calcium_nitrate_calcinit_typical',
    'calcium_nitrate_4h2o',
    'calcium_nitrate_anhydrous',
    'calcium_nitrate_liquid',
    'calcium_chloride_dihydrate_common',
    'calcium_chloride_solid',
    'calcium_chloride_liquid'
  ],
  sulfate_sources: [
    'magnesium_sulfate_heptahydrate_common',
    'magnesium_sulfate_anhydrous',
    'potassium_sulfate_common',
    'ammonium_sulfate_common',
    'langbeinite_common',
    'ammonium_thiosulfate_common',
    'potassium_thiosulfate_common',
    'manganese_sulfate',
    'zinc_sulfate_heptahydrate_common',
    'zinc_sulfate_mono',
    'copper_sulfate'
  ],
  phosphate_sources: [
    'map_typical',
    'mkp_typical',
    'dap_common',
    'ssp_typical',
    'phosphoric_acid_49',
    'urea_phosphate'
  ],
  silicate_sources: [
    'potassium_silicate_liquid_typical'
  ],
  neutral: [
    'potassium_nitrate_typical',
    'magnesium_nitrate_hexahydrate_typical',
    'magnesium_nitrate_liquid',
    'ammonium_nitrate_common',
    'ammonium_nitrate_liquid',
    'potassium_chloride_common',
    'nitric_acid_38',
    'nitric_acid_60',
    'urea_common',
    'urea_liquid',
    'uan32_solution_typical',
    'potassium_bicarbonate',
    'boric_acid_common',
    'borax',
    'sodium_molybdate',
    'ammonium_molybdate'
  ]
};

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
 * Convert PPM results to ion concentrations in mmol/L for EC estimation.
 * @param {Object} ppmResults - PPM values from the calculator
 * @returns {Object} Ion concentrations in mmol/L
 */
window.FertilizerCore.ppmToIonsForEC = function(ppmResults) {
  const ions_mmolL = {};

  if (ppmResults.N_NO3 > 0) ions_mmolL['NO3-'] = ppmResults.N_NO3 / 14.007;
  if (ppmResults.N_NH4 > 0) ions_mmolL['NH4+'] = ppmResults.N_NH4 / 14.007;
  if (ppmResults.P > 0) ions_mmolL['H2PO4-'] = ppmResults.P / 30.974;
  if (ppmResults.K > 0) ions_mmolL['K+'] = ppmResults.K / 39.098;
  if (ppmResults.Ca > 0) ions_mmolL['Ca2+'] = ppmResults.Ca / 40.078;
  if (ppmResults.Mg > 0) ions_mmolL['Mg2+'] = ppmResults.Mg / 24.305;
  if (ppmResults.S > 0) ions_mmolL['SO4^2-'] = ppmResults.S / 32.065;
  if (ppmResults.Na > 0) ions_mmolL['Na+'] = ppmResults.Na / 22.99;
  if (ppmResults.Cl > 0) ions_mmolL['Cl-'] = ppmResults.Cl / 35.453;
  if (ppmResults.Fe > 0) ions_mmolL['Fe2+'] = ppmResults.Fe / 55.845;
  if (ppmResults.Mn > 0) ions_mmolL['Mn2+'] = ppmResults.Mn / 54.938;
  if (ppmResults.Zn > 0) ions_mmolL['Zn2+'] = ppmResults.Zn / 65.38;
  if (ppmResults.Cu > 0) ions_mmolL['Cu2+'] = ppmResults.Cu / 63.546;

  return ions_mmolL;
};

/**
 * Estimate EC from PPM results (convenience wrapper)
 * @param {Object} ppmResults - PPM values from the calculator
 * @param {Object} options - Options passed to estimateEC
 * @returns {Object} EC estimation results
 */
window.FertilizerCore.estimateECFromPPM = function(ppmResults, options = {}) {
  const ions_mmolL = window.FertilizerCore.ppmToIonsForEC(ppmResults);
  return window.FertilizerCore.estimateEC(ions_mmolL, options);
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
