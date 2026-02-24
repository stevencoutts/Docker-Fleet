const logger = require('./logger');

/**
 * Load AppSettings from DB into process.env so config getters pick them up.
 * Env values take precedence (only set process.env when current value is undefined or empty).
 * @param {object} db - models object with AppSettings
 */
async function loadAppSettingsIntoEnv(db) {
  try {
    const { AppSettings } = db;
    const rows = await AppSettings.findAll();
    rows.forEach((r) => {
      if (r.key && AppSettings.ALLOWED_KEYS.has(r.key)) {
        if (process.env[r.key] === undefined || process.env[r.key] === '') {
          process.env[r.key] = r.value ?? '';
        }
      }
    });
  } catch (err) {
    logger.warn('Could not load app settings from DB (table may not exist yet):', err.message);
  }
}

module.exports = { loadAppSettingsIntoEnv };
