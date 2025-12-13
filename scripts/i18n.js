/**
 * Internationalization (i18n) Module
 * Handles translations, number formatting, and language switching
 */

(function() {
  'use strict';

  const i18n = {
    currentLanguage: 'en',

    translations: {
      // English translations - loaded from /scripts/locales/en.js
      en: window.i18nLocales?.en || {},

      // Gujarati translations - loaded from /scripts/locales/gu.js
      gu: window.i18nLocales?.gu || {}
    },

    // Format a number according to the current language
    formatNumber(num) {
      const numStr = String(num);

      // Native numeral mappings for each language
      const numeralMaps = {
        'gu': ['૦', '૧', '૨', '૩', '૪', '૫', '૬', '૭', '૮', '૯']
      };

      const numerals = numeralMaps[this.currentLanguage];
      if (!numerals) {
        return numStr; // Return as-is for languages without custom numerals
      }

      // Replace each digit with its localized equivalent
      return numStr.replace(/[0-9]/g, digit => numerals[parseInt(digit)]);
    },

    // Get localized fertilizer name
    getFertilizerName(fert) {
      if (!fert) return '';
      const key = 'fert_' + fert.id;
      const translated = this.t(key);
      // If translation exists (not returning the key itself), use it
      if (translated !== key) {
        return translated;
      }
      // Fallback to original name
      return fert.name;
    },

    // Get localized fertilizer aliases (with localized numerals)
    getFertilizerAliases(fert) {
      if (!fert || !fert.aliases || fert.aliases.length === 0) return '';
      // Localize numbers in each alias
      return fert.aliases.map(alias => this.formatNumber(alias)).join(', ');
    },

    // Format nutrient key into display-friendly label with proper subscripts
    formatNutrientLabel(nutrientKey) {
      const labelMap = {
        'N_total': 'N',
        'N_NO3': 'NO₃-N',
        'N_NH4': 'NH₄-N',
        'N_Urea': 'Urea-N',
        'P': 'P',
        'P2O5': 'P₂O₅',
        'K': 'K',
        'K2O': 'K₂O',
        'Ca': 'Ca',
        'Mg': 'Mg',
        'S': 'S',
        'Si': 'Si',
        'Fe': 'Fe',
        'Mn': 'Mn',
        'Zn': 'Zn',
        'Cu': 'Cu',
        'B': 'B',
        'Mo': 'Mo',
        'Cl': 'Cl',
        'Na': 'Na',
        'Co': 'Co',
        'Ni': 'Ni'
      };
      return labelMap[nutrientKey] || nutrientKey;
    },

    // Get translation for a key
    t(key, replacements = {}) {
      const lang = this.translations[this.currentLanguage] || this.translations.en;
      let text = lang[key] || this.translations.en[key] || key;

      // Handle replacements like {current} and {total}
      // Numbers are automatically formatted to localized numerals
      Object.keys(replacements).forEach(placeholder => {
        let value = replacements[placeholder];
        // Format numbers using localized numerals
        if (typeof value === 'number') {
          value = this.formatNumber(value);
        }
        text = text.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), value);
      });

      return text;
    },

    // Set the current language and update UI
    setLanguage(langCode) {
      if (this.translations[langCode]) {
        this.currentLanguage = langCode;
        localStorage.setItem('fertCalcLanguage', langCode);
        this.updateUI();
        this.refreshDynamicContent();

        // Sync with Vue state if available
        if (window.vueApp && window.vueApp.language !== langCode) {
          window.vueApp.language = langCode;
        }
      }
    },

    // Update all elements with data-i18n attribute
    updateUI() {
      // Update elements with data-i18n attribute
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) {
          el.textContent = this.t(key);
        }
      });

      // Update elements with data-i18n-placeholder attribute
      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
          el.placeholder = this.t(key);
        }
      });

      // Update elements with data-i18n-title attribute
      document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (key) {
          el.title = this.t(key);
        }
      });

      // Update elements with data-i18n-html attribute (for HTML content)
      document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        if (key) {
          el.innerHTML = this.t(key);
        }
      });
    },

    // Refresh dynamically generated content (results, tables) after language change
    refreshDynamicContent() {
      // Re-render Grams → PPM results (using Vue)
      if (typeof lastGramsToPPMCalculation !== 'undefined' && lastGramsToPPMCalculation && window.vueApp) {
        const { activeFertilizers, volume, results, ecData, ionBalance, ratios, warnings } = lastGramsToPPMCalculation;
        window.vueApp.setGramsToPpmResults(activeFertilizers, volume, results, ecData, ionBalance, ratios, warnings || []);
      }

      // Re-render PPM → Grams results (using Vue)
      if (typeof lastFormulaCalculation !== 'undefined' && lastFormulaCalculation && window.vueApp) {
        const { result, targets, volume, mode } = lastFormulaCalculation;
        window.vueApp.setFormulaResults(result, targets, volume, mode);
      }

      // Re-render NPK Ratio → Grams results (using Vue)
      if (typeof lastReverseCalculation !== 'undefined' && lastReverseCalculation && window.vueApp) {
        const { result, targets, volume, targetEC } = lastReverseCalculation;
        window.vueApp.setReverseResults(result, targets, volume, targetEC);
      }

      // Re-render Two-Tank results (using Vue)
      if (typeof currentTwoTankData !== 'undefined' && currentTwoTankData && window.vueApp) {
        const { tankA, tankB, volume, mode, sourceType, achieved, targets } = currentTwoTankData;
        window.vueApp.setTwoTankResults(tankA, tankB, volume, mode, sourceType, achieved, targets);
      }

      // After Vue re-renders, refresh wizard results container (which uses copied HTML)
      // Use setTimeout to ensure Vue has finished rendering
      setTimeout(() => {
        if (typeof window.refreshWizardResults === 'function') {
          window.refreshWizardResults();
        }
      }, 100);
    },

    // Initialize language from localStorage or browser preference
    init() {
      const savedLang = localStorage.getItem('fertCalcLanguage');
      if (savedLang && this.translations[savedLang]) {
        this.currentLanguage = savedLang;
      } else {
        // Try to detect browser language
        const browserLang = navigator.language?.split('-')[0];
        if (browserLang && this.translations[browserLang]) {
          this.currentLanguage = browserLang;
        }
      }
      // Initial UI update will happen after DOM is ready
    },

    // Get list of available languages
    getAvailableLanguages() {
      return Object.keys(this.translations).map(code => ({
        code,
        name: this.getLanguageName(code)
      }));
    },

    // Get display name for a language code
    getLanguageName(code) {
      const names = {
        en: 'English',
        es: 'Español',
        fr: 'Français',
        de: 'Deutsch',
        pt: 'Português',
        it: 'Italiano',
        zh: '中文',
        ja: '日本語',
        ko: '한국어',
        hi: 'हिन्दी',
        gu: 'ગુજરાતી'
      };
      return names[code] || code.toUpperCase();
    }
  };

  // Initialize i18n
  i18n.init();

  // Export to window
  window.i18n = i18n;

})();
