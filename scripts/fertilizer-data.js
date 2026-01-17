// =============================================================================
// FERTILIZER CALCULATOR - DATA MODULE
// =============================================================================
// Contains fertilizer database, chemical constants, and compatibility data.
// This is pure data with no logic - used by fertilizer-core.js
//
// Usage: Include this script before fertilizer-core.js
// =============================================================================

(function() {
  'use strict';

  // Initialize FertilizerCore namespace
  if (typeof window.FertilizerCore === 'undefined') {
    window.FertilizerCore = {};
  }

  // =============================================================================
  // FERTILIZER DATABASE
  // =============================================================================

  // Default solubility for fertilizers without explicit data (conservative, g/L at 20°C)
  window.FertilizerCore.DEFAULT_SOLUBILITY_GL = 200;

  window.FertilizerCore.FERTILIZERS = [
    {
      id: "calcium_nitrate_calcinit_typical",
      name: "Calcium Nitrate - Calcinit type (15.5% N, 19% Ca)",
      aliases: ["YaraLiva Calcinit", "Calcium nitrate 15.5-0-0 + Ca", "Calcinit"],
      pct: { N_total: 15.5, N_NO3: 14.4, N_NH4: 1.1, Ca: 19.0 },
      solubility_gL: 1290
    },
    {
      id: "hydrospeed_cab_max",
      name: "HydroSpeed CaB Max (15% N, 19.3% Ca, 0.2% B)",
      aliases: ["HydroSpeed CaB Max", "15-0-0 + 19.3Ca + 0.2B"],
      pct: { N_total: 15.0, N_NO3: 14.3, N_NH4: 0.7, Ca: 19.3, B: 0.2 },
      solubility_gL: 1290
    },
    {
      id: "potassium_nitrate_typical",
      name: "Potassium Nitrate",
      aliases: ["KNO3", "13.7-0-46.3"],
      pct: { N_total: 13.7, N_NO3: 13.7, K2O: 46.3 },
      solubility_gL: 320
    },
    {
      id: "map_typical",
      name: "Mono Ammonium Phosphate (MAP)",
      aliases: ["NH4H2PO4", "12-61-0", "12 61", "12:61" ],
      pct: { N_total: 12.0, N_NH4: 12.0, P2O5: 61.0 },
      solubility_gL: 370
    },
    {
      id: "mkp_typical",
      name: "Mono Potassium Phosphate (MKP)",
      aliases: ["KH2PO4", "0-52-34", "0:52:34", "52 34"],
      pct: { P2O5: 52.0, K2O: 34.0 },
      solubility_gL: 230
    },
    {
      id: "dap_common",
      name: "Di Ammonium Phosphate (DAP)",
      aliases: ["(NH4)2HPO4", "18-46-0"],
      pct: { N_total: 18.0, N_NH4: 18.0, P2O5: 46.0 },
      solubility_gL: 580
    },
    {
      id: "ssp_common",
      name: "Single Super Phosphate (SSP)",
      aliases: ["SSP", "Superphosphate", "0-16-0", "Ca(H2PO4)2"],
      pct: { P2O5: 16.0, Ca: 20.0, S: 12.0 },
      solubility_gL: 20  // Very low - calcium phosphate
    },
    {
      id: "urea_common",
      name: "Urea",
      aliases: ["CO(NH2)2", "46-0-0"],
      pct: { N_total: 46.0, N_Urea: 46.0 },
      solubility_gL: 1080
    },
    {
      id: "ammonium_sulfate_common",
      name: "Ammonium Sulfate",
      aliases: ["(NH4)2SO4", "21-0-0 + 24S"],
      pct: { N_total: 21.0, N_NH4: 21.0, S: 24.0 },
      solubility_gL: 750
    },
    {
      id: "ammonium_nitrate_common",
      name: "Ammonium Nitrate - Solid (34% N)",
      aliases: ["NH4NO3", "34-0-0 (typical)", "Ammonium Nitrate solid"],
      pct: { N_total: 34.0, N_NO3: 17.0, N_NH4: 17.0 },
      solubility_gL: 1900
    },
    {
      id: "magnesium_sulfate_heptahydrate_common",
      name: "Magnesium Sulfate - Heptahydrate / Epsom Salt (9.86% Mg)",
      aliases: ["MgSO4·7H2O", "Epsom Salt", "Magnesium Sulfate 7H2O"],
      pct: { Mg: 9.86, S: 13.0 },
      solubility_gL: 710
    },
    {
      id: "magnesium_sulfate_16mgo",
      name: "Magnesium Sulfate (16% MgO) (~9.6% Mg, ~13% S)",
      aliases: ["MgSO4", "Magnesium Sulphate", "Epsom Salt", "MgSO4·7H2O (if heptahydrate)"],
      pct: { MgO: 16.0, Mg: 9.6, S: 13.0 },
      solubility_gL: 710
    },
    {
      id: "magnesium_nitrate_hexahydrate_typical",
      name: "Magnesium Nitrate - Hexahydrate (10.9% N, 9.5% Mg)",
      aliases: ["Mg(NO3)2·6H2O", "Magnesium Nitrate 6H2O"],
      pct: { N_total: 10.9, N_NO3: 10.9, Mg: 9.5 },
      solubility_gL: 420
    },
    {
      id: "potassium_sulfate_common",
      name: "Potassium Sulfate (SOP)",
      aliases: ["K2SO4", "0-0-50 + ~17S"],
      pct: { K2O: 50.0, S: 17.0 },
      solubility_gL: 120  // Low - often limiting factor
    },
    {
      id: "potassium_chloride_common",
      name: "Potassium Chloride (MOP)",
      aliases: ["KCl", "0-0-60"],
      pct: { K2O: 60.0, Cl: 47.6 },
      solubility_gL: 340
    },
    {
      id: "calcium_chloride_dihydrate_common",
      name: "Calcium Chloride - Dihydrate (27.2% Ca)",
      aliases: ["CaCl2·2H2O", "Calcium Chloride 2H2O"],
      pct: { Ca: 27.2, Cl: 48.3 },
      solubility_gL: 745
    },
    {
      id: "langbeinite_common",
      name: "Langbeinite / Sul-Po-Mag",
      aliases: ["K2SO4·2MgSO4", "0-0-22 + 11Mg + 22S"],
      pct: { K2O: 22.0, Mg: 11.0, S: 22.0 },
      solubility_gL: 240
    },
    {
      id: "potassium_schoenite",
      name: "Potassium Schoenite / SOPM (23% K2O, 11% MgO)",
      aliases: ["Schoenite", "Potassium Magnesium Sulfate", "SOPM", "K2SO4·MgSO4·6H2O"],
      pct: { K2O: 23.0, MgO: 11.0, S: 15.9 },
      solubility_gL: 220
    },
    {
      id: "uan32_solution_typical",
      name: "UAN Solution (example: 32-0-0)",
      aliases: ["UAN-32"],
      pct: { N_total: 32.0, N_Urea: 16.0, N_NO3: 8.0, N_NH4: 8.0 },
      solubility_gL: 1000  // Already liquid
    },
    {
      id: "ammonium_thiosulfate_common",
      name: "Ammonium Thiosulfate (ATS)",
      aliases: ["12-0-0-26S (common liquid)"],
      pct: { N_total: 12.0, N_NH4: 12.0, S: 26.0 },
      solubility_gL: 1000  // Typically liquid
    },
    {
      id: "potassium_thiosulfate_common",
      name: "Potassium Thiosulfate (KTS)",
      aliases: ["0-0-25-17S (common liquid)"],
      pct: { K2O: 25.0, S: 17.0 },
      solubility_gL: 1000  // Typically liquid
    },
    {
      id: "fe_edta_13",
      name: "Iron Chelate - EDTA (13% Fe)",
      aliases: ["Fe-EDTA 13", "Fe-EDTA 13%"],
      pct: { Fe: 13.0 },
      solubility_gL: 100
    },
    {
      id: "boric_acid_common",
      name: "Boric Acid",
      aliases: ["H3BO3"],
      pct: { B: 17.5 },
      solubility_gL: 50  // Low solubility
    },
    {
      id: "zinc_sulfate_heptahydrate_common",
      name: "Zinc Sulfate - Heptahydrate (22.7% Zn)",
      aliases: ["ZnSO4·7H2O", "Zinc Sulfate 7H2O"],
      pct: { Zn: 22.7, S: 11.2 },
      solubility_gL: 580
    },
    {
      id: "nitric_acid_38",
      name: "Nitric Acid 38%",
      aliases: ["HNO3 38%"],
      pct: { N_total: 8.4, N_NO3: 8.4 },
      solubility_gL: 1000  // Liquid
    },
    {
      id: "nitric_acid_60",
      name: "Nitric Acid 60%",
      aliases: ["HNO3 60%"],
      pct: { N_total: 13.3, N_NO3: 13.3 },
      solubility_gL: 1000  // Liquid
    },
    {
      id: "phosphoric_acid_49",
      name: "Phosphoric Acid 49%",
      aliases: ["H3PO4 49%"],
      pct: { P: 18.6 },
      solubility_gL: 1000  // Liquid
    },
    {
      id: "potassium_bicarbonate",
      name: "Potassium Bicarbonate",
      aliases: ["KHCO3"],
      pct: { K: 39.0 },
      solubility_gL: 330
    },
    {
      id: "ammonium_nitrate_liquid",
      name: "Ammonium Nitrate - Liquid (18% N)",
      aliases: ["NH4NO3 liquid", "Ammonium Nitrate liquid"],
      pct: { N_total: 18.0, N_NO3: 9.0, N_NH4: 9.0 },
      solubility_gL: 1000  // Liquid
    },
    {
      id: "urea_phosphate",
      name: "Urea Phosphate",
      aliases: ["CO(NH2)2·H3PO4"],
      pct: { N_total: 17.5, N_Urea: 17.5, P: 19.6 },
      solubility_gL: 440
    },
    {
      id: "calcium_nitrate_4h2o",
      name: "Calcium Nitrate - Tetrahydrate (11.5% N, 16.5% Ca)",
      aliases: ["Ca(NO3)2·4H2O", "Calcium Nitrate 4H2O"],
      pct: { N_total: 11.5, N_NO3: 11.5, Ca: 16.5 },
      solubility_gL: 1290
    },
    {
      id: "calcium_nitrate_anhydrous",
      name: "Calcium Nitrate - Anhydrous (15.5% N, 18.5% Ca)",
      aliases: ["Ca(NO3)2", "Calcium Nitrate anhydrous"],
      pct: { N_total: 15.5, N_NO3: 15.5, Ca: 18.5 },
      solubility_gL: 1290
    },
    {
      id: "calcium_nitrate_liquid",
      name: "Calcium Nitrate - Liquid (8.7% N, 12.5% Ca)",
      aliases: ["Ca(NO3)2 liquid", "Calcium Nitrate liquid"],
      pct: { N_total: 8.7, N_NO3: 8.7, Ca: 12.5 },
      solubility_gL: 1000  // Liquid
    },
    {
      id: "calcium_chloride_solid",
      name: "Calcium Chloride - Solid (36% Ca)",
      aliases: ["CaCl2 solid", "Calcium Chloride solid"],
      pct: { Ca: 36.0, Cl: 63.9 },
      solubility_gL: 745
    },
    {
      id: "calcium_chloride_liquid",
      name: "Calcium Chloride - Liquid (11.8% Ca)",
      aliases: ["CaCl2 liquid", "Calcium Chloride liquid"],
      pct: { Ca: 11.8, Cl: 20.9 },
      solubility_gL: 1000  // Liquid
    },
    {
      id: "magnesium_sulfate_anhydrous",
      name: "Magnesium Sulfate - Anhydrous (19.6% Mg)",
      aliases: ["MgSO4", "Magnesium Sulfate anhydrous"],
      pct: { Mg: 19.6, S: 26.5 },
      solubility_gL: 350
    },
    {
      id: "magnesium_nitrate_liquid",
      name: "Magnesium Nitrate - Liquid (7% N, 6.1% Mg)",
      aliases: ["Mg(NO3)2 liquid", "Magnesium Nitrate liquid"],
      pct: { N_total: 7.0, N_NO3: 7.0, Mg: 6.1 },
      solubility_gL: 1000  // Liquid
    },
    {
      id: "fe_dtpa_12",
      name: "Iron Chelate - DTPA solid (12% Fe)",
      aliases: ["Fe-DTPA 12%", "Fe-DTPA 12"],
      pct: { Fe: 12.0 },
      solubility_gL: 80
    },
    {
      id: "fe_dtpa_liquid_3",
      name: "Iron Chelate - DTPA liquid (3% Fe)",
      aliases: ["Fe-DTPA 3%", "Fe-DTPA 3"],
      pct: { Fe: 3.0 },
      solubility_gL: 1000  // Liquid
    },
    {
      id: "fe_dtpa_liquid_6",
      name: "Iron Chelate - DTPA liquid (6% Fe)",
      aliases: ["Fe-DTPA 6%", "Fe-DTPA 6"],
      pct: { Fe: 6.0 },
      solubility_gL: 1000  // Liquid
    },
    {
      id: "fe_eddha_6",
      name: "Iron Chelate - EDDHA (6% Fe)",
      aliases: ["Fe-EDDHA 6%", "Fe-EDDHA 6"],
      pct: { Fe: 6.0 },
      solubility_gL: 60
    },
    {
      id: "fe_hbed_6",
      name: "Iron Chelate - HBED (6% Fe)",
      aliases: ["Fe-HBED 6%", "Fe-HBED 6"],
      pct: { Fe: 6.0 },
      solubility_gL: 60
    },
    {
      id: "mn_edta_13",
      name: "Manganese Chelate - EDTA (13% Mn)",
      aliases: ["Mn-EDTA 13%", "Mn-EDTA 13"],
      pct: { Mn: 13.0 },
      solubility_gL: 100
    },
    {
      id: "zn_edta_15",
      name: "Zinc Chelate - EDTA (15% Zn)",
      aliases: ["Zn-EDTA 15%", "Zn-EDTA 15"],
      pct: { Zn: 15.0 },
      solubility_gL: 100
    },
    {
      id: "cu_edta_15",
      name: "Copper Chelate - EDTA (15% Cu)",
      aliases: ["Cu-EDTA 15%", "Cu-EDTA 15"],
      pct: { Cu: 15.0 },
      solubility_gL: 100
    },
    {
      id: "manganese_sulfate",
      name: "Manganese Sulfate",
      aliases: ["MnSO4·H2O"],
      pct: { Mn: 32.5, S: 18.9 },
      solubility_gL: 620
    },
    {
      id: "zinc_sulfate_mono",
      name: "Zinc Sulfate - Monohydrate (36% Zn)",
      aliases: ["ZnSO4·H2O", "Zinc Sulfate H2O"],
      pct: { Zn: 36.0 },
      solubility_gL: 580
    },
    {
      id: "borax",
      name: "Borax",
      aliases: ["Na2B4O7·10H2O"],
      pct: { B: 11.3 },
      solubility_gL: 50
    },
    {
      id: "copper_sulfate",
      name: "Copper Sulfate",
      aliases: ["CuSO4·5H2O"],
      pct: { Cu: 25.5, S: 12.8 },
      solubility_gL: 320
    },
    {
      id: "sodium_molybdate",
      name: "Sodium Molybdate",
      aliases: ["Na2MoO4·2H2O"],
      pct: { Mo: 39.6 },
      solubility_gL: 560
    },
    {
      id: "ammonium_molybdate",
      name: "Ammonium Molybdate",
      aliases: ["(NH4)6Mo7O24·4H2O"],
      pct: { Mo: 52.0, N_total: 8.0, N_NH4: 8.0 },
      solubility_gL: 400
    },
    {
      id: "potassium_silicate_liquid_typical",
      name: "Potassium Silicate (12% Si, 18% K2O)",
      aliases: ["Potassium Silicate", "Pro-TeKt", "Liquid Potassium Silicate", "K2SiO3 solution"],
      pct: { K2O: 18, Si: 12 },
      solubility_gL: 1000  // Liquid
    },
    {
      id: "rexolin_cxk",
      name: "Rexolin CXK (Chelated Micronutrient Mix)",
      aliases: ["Rexolin CXK", "CXK"],
      pct: { Fe: 3.4, Mn: 3.2, Zn: 4.2, B: 1.5, Mg: 1.2, Mo: 0.05 },
      solubility_gL: 80
    },
    {
      id: "utkarsh_double_combi",
      name: "Utkarsh Double Combi (Micronutrient Mix)",
      aliases: ["Utkarsh Double Combi", "Double Combi"],
      pct: { Ca: 1.0, Mg: 2.5, Zn: 2.0, Fe: 2.0, Mn: 1.0, B: 1.0, Cu: 0.5, Mo: 0.05, Co: 0.005 },
      solubility_gL: 80
    },
    {
      id: "haifa_17_10_27",
      name: "Haifa 17:10:27 (17% N, 10% P₂O₅, 27% K₂O)",
      aliases: ["Haifa 17:10:27", "17:10:27", "17-10-27"],
      pct: { N_total: 17, N_NO3: 11.3, N_NH4: 5.7, P2O5: 10, K2O: 27 },
      solubility_gL: 250
    },
    {
      id: "wsf_13_40_13",
      name: "WSF 13:40:13 (13% N, 40% P₂O₅, 13% K₂O)",
      aliases: ["WSF 13:40:13", "13:40:13", "13-40-13", "WSF 13-40-13"],
      pct: { N_total: 13.0, N_NO3: 4.4, N_NH4: 8.6, P2O5: 40.0, K2O: 13.0 },
      solubility_gL: 300
    },
    {
      id: "wsf_12_6_22_12cao",
      name: "WSF 12:6:22 + 12CaO (12% N, 6% P₂O₅, 22% K₂O, 12% CaO)",
      aliases: [
        "ICL 12:6:22+12CaO",
        "ICL 12-6-22+12CaO",
        "Fertiflow 12:6:22+12CaO",
        "Fertiflow 12-6-22+12CaO",
        "WSF 12:6:22+12CaO",
        "12:6:22+12CaO",
        "12-6-22+12CaO"
      ],
      pct: {
        N_total: 12.0,
        N_NO3: 12.0,
        N_NH4: 0.0,
        P2O5: 6.0,
        K2O: 22.0,
        CaO: 12.0,
        P: 2.62,
        K: 18.26,
        Ca: 8.58
      },
      solubility_gL: 180
    },
    {
      id: "disodium_octaborate_tetrahydrate_20b",
      name: "Disodium Octaborate Tetrahydrate (Boron 20% as B)",
      aliases: [
        "Disodium Octaborate Tetrahydrate",
        "Disodium octaborate tetrahydrate",
        "DOT",
        "Sodium octaborate tetrahydrate",
        "Na2B8O13·4H2O"
      ],
      pct: { B: 20.0 },
      solubility_gL: 100
    },
    {
      id: "icl_pekacid_pk_acid",
      name: "ICL PeKacid (0-60-20) - Acidifying PK Fertilizer",
      aliases: ["PeKacid", "Peakacid", "ICL PeKacid", "PeaK PeKacid", "0-60-20"],
      pct: { P2O5: 60.0, K2O: 20.0 },
      solubility_gL: 650
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

  // =============================================================================
  // ION BALANCE DATA
  // =============================================================================
  // Molar mass and ions for each fertilizer

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
    hydrospeed_cab_max: {
      formula: '5Ca(NO₃)₂·NH₄NO₃·10H₂O',
      molarMass: 1080.64,
      ions: [
        {ion: 'Ca²⁺', charge: 2, count: 5, type: 'cation'},
        {ion: 'NH₄⁺', charge: 1, count: 1, type: 'cation'},
        {ion: 'NO₃⁻', charge: 1, count: 11, type: 'anion'}
      ],
      // Boron as boric acid - mostly neutral at fertigation pH, not included in charge balance
      micronutrients: { B: 0.2 }
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
    potassium_schoenite: {
      formula: 'K₂SO₄·MgSO₄·6H₂O',
      molarMass: 402.71,
      ions: [
        {ion: 'K⁺', charge: 1, count: 2, type: 'cation'},
        {ion: 'Mg²⁺', charge: 2, count: 1, type: 'cation'},
        {ion: 'SO₄²⁻', charge: 2, count: 2, type: 'anion'}
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
    },
    disodium_octaborate_tetrahydrate_20b: {
      formula: 'Na₂B₈O₁₃·4H₂O',
      molarMass: 412.52,
      ions: [
        {ion: 'Na⁺', charge: 1, count: 2, type: 'cation'},
        {ion: 'B₈O₁₃²⁻', charge: 2, count: 1, type: 'anion'}
      ]
    },
    icl_pekacid_pk_acid: {
      formula: 'KH₂PO₄ (acidified)',
      molarMass: 136.1,
      ions: [
        {ion: 'K⁺', charge: 1, count: 1, type: 'cation'},
        {ion: 'H₂PO₄⁻', charge: 1, count: 1, type: 'anion'}
      ]
    }
  };

  // =============================================================================
  // COMMON FERTILIZERS & COMPATIBILITY
  // =============================================================================

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
      'hydrospeed_cab_max',
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
      'potassium_schoenite',
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
      'urea_phosphate',
      'icl_pekacid_pk_acid'
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

})();
