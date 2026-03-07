const logger = require('./logger');

/**
 * Load AppSettings from DB into process.env so config getters pick them up.
 * @param {object} db - models object with AppSettings
 * @param {boolean} [overwrite=false] - if true, DB values overwrite process.env (use when user saves from UI); if false, only set when env key is undefined or empty (use at startup so env/.env takes precedence)
 */
async function loadAppSettingsIntoEnv(db, overwrite = false) {
  try {
    const { AppSettings } = db;
    const rows = await AppSettings.findAll();
    rows.forEach((r) => {
      if (r.key && AppSettings.ALLOWED_KEYS.has(r.key)) {
        if (overwrite || process.env[r.key] === undefined || process.env[r.key] === '') {
          process.env[r.key] = r.value ?? '';
        }
      }
    });
  } catch (err) {
    logger.warn('Could not load app settings from DB (table may not exist yet):', err.message);
  }
}

module.exports = { loadAppSettingsIntoEnv };
