/**
 * Internationalization (i18n) Module
 * Handles translations, number formatting, and language switching
 * Supports lazy loading of locale files - only loads English + selected language
 */

(function() {
  'use strict';

  // List of supported language codes
  const SUPPORTED_LANGUAGES = [
    'en', 'gu', 'hi', 'kn', 'te', 'mr', 'bn-sadhu', 'bn',
    'ta', 'ml', 'pa', 'or', 'as', 'bho', 'mai', 'awa'
  ];

  const i18n = {
    currentLanguage: 'en',
    isReady: false,
    _readyCallbacks: [],

    // Translations object - populated dynamically via lazy loading
    translations: {},

    // Track which locales are currently being loaded (to prevent duplicate loads)
    _loadingLocales: {},

    // Loading modal element reference
    _loadingModal: null,

    /**
     * Show loading modal when switching languages
     */
    showLoadingModal() {
      if (this._loadingModal) {
        this._loadingModal.style.display = 'flex';
        return;
      }

      // Create loading modal
      const modal = document.createElement('div');
      modal.id = 'i18n-loading-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(255, 255, 255, 0.95);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 99999;
        transition: opacity 0.2s ease;
      `;

      modal.innerHTML = `
        <div style="text-align: center;">
          <div style="
            width: 50px;
            height: 50px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #007bff;
            border-radius: 50%;
            animation: i18n-spin 1s linear infinite;
            margin: 0 auto 20px;
          "></div>
          <div style="font-size: 18px; color: #333; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            Loading language...
          </div>
          <div style="font-size: 14px; color: #666; margin-top: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            भाषा लोड हो रही है • ভাষা লোড হচ্ছে • ભાષા લોડ થઈ રહી છે
          </div>
        </div>
      `;

      // Add animation keyframes
      const style = document.createElement('style');
      style.textContent = `
        @keyframes i18n-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);

      document.body.appendChild(modal);
      this._loadingModal = modal;
    },

    /**
     * Hide loading modal
     */
    hideLoadingModal() {
      if (this._loadingModal) {
        this._loadingModal.style.opacity = '0';
        setTimeout(() => {
          if (this._loadingModal) {
            this._loadingModal.style.display = 'none';
            this._loadingModal.style.opacity = '1';
          }
        }, 200);
      }
    },

    /**
     * Load a locale file dynamically
     * @param {string} langCode - The language code to load
     * @returns {Promise} - Resolves when the locale is loaded
     */
    async loadLocale(langCode) {
      // Already loaded
      if (this.translations[langCode] && Object.keys(this.translations[langCode]).length > 0) {
        return Promise.resolve();
      }

      // Check if it's a supported language
      if (!SUPPORTED_LANGUAGES.includes(langCode)) {
        console.warn(`i18n: Unsupported language code: ${langCode}`);
        return Promise.resolve();
      }

      // Already loading - return existing promise
      if (this._loadingLocales[langCode]) {
        return this._loadingLocales[langCode];
      }

      // Create loading promise
      this._loadingLocales[langCode] = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `/scripts/locales/${langCode}.js`;
        script.async = true;

        script.onload = () => {
          // Copy from window.i18nLocales to our translations object
          if (window.i18nLocales && window.i18nLocales[langCode]) {
            this.translations[langCode] = window.i18nLocales[langCode];
          }
          delete this._loadingLocales[langCode];
          resolve();
        };

        script.onerror = () => {
          console.error(`i18n: Failed to load locale: ${langCode}`);
          delete this._loadingLocales[langCode];
          reject(new Error(`Failed to load locale: ${langCode}`));
        };

        document.head.appendChild(script);
      });

      return this._loadingLocales[langCode];
    },

    /**
     * Register a callback to be called when i18n is ready
     * @param {Function} callback - Function to call when ready
     */
    onReady(callback) {
      if (this.isReady) {
        callback();
      } else {
        this._readyCallbacks.push(callback);
      }
    },

    /**
     * Mark i18n as ready and call all registered callbacks
     */
    _setReady() {
      this.isReady = true;
      this._readyCallbacks.forEach(cb => cb());
      this._readyCallbacks = [];
    },

    // Format a number according to the current language
    formatNumber(num) {
      const numStr = String(num);

      // Native numeral mappings for each language
      const numeralMaps = {
        'gu': ['૦', '૧', '૨', '૩', '૪', '૫', '૬', '૭', '૮', '૯'],
        'hi': ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'],
        'kn': ['೦', '೧', '೨', '೩', '೪', '೫', '೬', '೭', '೮', '೯'],
        'te': ['౦', '౧', '౨', '౩', '౪', '౫', '౬', '౭', '౮', '౯'],
        'mr': ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'],
        'bn': ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'],
        'bn-sadhu': ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'],
        'ta': ['௦', '௧', '௨', '௩', '௪', '௫', '௬', '௭', '௮', '௯'],
        'ml': ['൦', '൧', '൨', '൩', '൪', '൫', '൬', '൭', '൮', '൯'],
        'pa': ['੦', '੧', '੨', '੩', '੪', '੫', '੬', '੭', '੮', '੯'],
        'or': ['୦', '୧', '୨', '୩', '୪', '୫', '୬', '୭', '୮', '୯'],
        'as': ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'],
        'bho': ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'],
        'mai': ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'],
        'awa': ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९']
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
      // Return key if translations not loaded yet
      if (!lang) return key;
      let text = lang[key] || (this.translations.en && this.translations.en[key]) || key;

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

    // Set the current language and update UI (async to support lazy loading)
    async setLanguage(langCode) {
      // Check if it's a supported language
      if (!SUPPORTED_LANGUAGES.includes(langCode)) {
        console.warn(`i18n: Unsupported language code: ${langCode}`);
        return;
      }

      // Load the locale if not already loaded
      const needsLoading = !this.translations[langCode] || Object.keys(this.translations[langCode]).length === 0;

      if (needsLoading) {
        // Show loading modal for new locale
        this.showLoadingModal();
        try {
          await this.loadLocale(langCode);
        } catch (error) {
          console.error(`i18n: Failed to load locale ${langCode}, falling back to English`);
          langCode = 'en';
        }
      }

      this.currentLanguage = langCode;
      localStorage.setItem('fertCalcLanguage', langCode);
      this.updateUI();
      this.refreshDynamicContent();

      // Sync with Vue state if available
      if (window.vueApp && window.vueApp.language !== langCode) {
        window.vueApp.language = langCode;
      }

      // Hide loading modal after everything is updated
      if (needsLoading) {
        this.hideLoadingModal();
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
      // Note: Vue 3's mount() returns a proxy that auto-unwraps refs, so we access directly without .value
      if (window.vueApp?.lastGramsToPPMCalculation) {
        const { activeFertilizers, volume, results, ecData, ionBalance, ratios, warnings } = window.vueApp.lastGramsToPPMCalculation;
        window.vueApp.setGramsToPpmResults(activeFertilizers, volume, results, ecData, ionBalance, ratios, warnings || []);
      }

      // Re-render PPM → Grams results (using Vue)
      if (window.vueApp?.lastFormulaCalculation) {
        const { result, targets, volume, mode } = window.vueApp.lastFormulaCalculation;
        window.vueApp.setFormulaResults(result, targets, volume, mode);
      }

      // Re-render NPK Ratio → Grams results (using Vue)
      if (window.vueApp?.lastReverseCalculation) {
        const { result, targets, volume, targetEC } = window.vueApp.lastReverseCalculation;
        window.vueApp.setReverseResults(result, targets, volume, targetEC);
      }

      // Re-render Two-Tank results (using Vue)
      if (window.vueApp?.currentTwoTankData) {
        const { tankA, tankB, volume, mode, sourceType, achieved, targets } = window.vueApp.currentTwoTankData;
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

    // Initialize language from localStorage or browser preference (async for lazy loading)
    async init() {
      // Determine the target language
      let targetLang = 'en';
      const savedLang = localStorage.getItem('fertCalcLanguage');

      if (savedLang && SUPPORTED_LANGUAGES.includes(savedLang)) {
        targetLang = savedLang;
      } else {
        // Try to detect browser language
        const browserLang = navigator.language?.split('-')[0];
        if (browserLang && SUPPORTED_LANGUAGES.includes(browserLang)) {
          targetLang = browserLang;
        }
      }

      try {
        // Always load English first (as fallback for missing translations)
        await this.loadLocale('en');

        // Load the target language if different from English
        if (targetLang !== 'en') {
          await this.loadLocale(targetLang);
        }

        this.currentLanguage = targetLang;
      } catch (error) {
        console.error('i18n: Error during initialization:', error);
        this.currentLanguage = 'en';
      }

      // Mark as ready and notify callbacks
      this._setReady();
    },

    // Get list of available languages
    getAvailableLanguages() {
      return SUPPORTED_LANGUAGES.map(code => ({
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
        gu: 'ગુજરાતી',
        kn: 'ಕನ್ನಡ',
        te: 'తెలుగు',
        mr: 'मराठी',
        'bn-sadhu': 'বাংলা (সাধু)',
        bn: 'বাংলা (চলিত)',
        ta: 'தமிழ்',
        ml: 'മലയാളം',
        pa: 'ਪੰਜਾਬੀ',
        or: 'ଓଡ଼ିଆ',
        as: 'অসমীয়া',
        bho: 'भोजपुरी',
        mai: 'मैथिली',
        awa: 'अवधी'
      };
      return names[code] || code.toUpperCase();
    }
  };

  // Initialize i18n
  i18n.init();

  // Export to window
  window.i18n = i18n;

})();
