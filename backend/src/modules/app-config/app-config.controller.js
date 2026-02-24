const db = require('../../models');
const logger = require('../../config/logger');
const { loadAppSettingsIntoEnv } = require('../../config/loadAppSettings');

const { AppSettings } = db;
const ALLOWED_KEYS = AppSettings.ALLOWED_KEYS;

/** Schema for GUI: key, label, type, placeholder, secret. */
const KEY_SCHEMA = [
  { key: 'CORS_ORIGIN', label: 'CORS origin', type: 'text', placeholder: 'http://localhost:3020', secret: false },
  { key: 'RATE_LIMIT_WINDOW_MS', label: 'Rate limit window (ms)', type: 'number', placeholder: '900000', secret: false },
  { key: 'RATE_LIMIT_MAX_REQUESTS', label: 'Rate limit max requests', type: 'number', placeholder: '2000', secret: false },
  { key: 'RATE_LIMIT_AUTHENTICATED_MAX', label: 'Rate limit authenticated max', type: 'number', placeholder: '10000', secret: false },
  { key: 'LOG_LEVEL', label: 'Log level', type: 'text', placeholder: 'info', secret: false },
  { key: 'LETSENCRYPT_EMAIL', label: "Let's Encrypt email", type: 'email', placeholder: 'admin@example.com', secret: false },
  { key: 'EMAIL_ENABLED', label: 'Email enabled', type: 'boolean', placeholder: 'false', secret: false },
  { key: 'EMAIL_FROM_ADDRESS', label: 'Email from address', type: 'text', placeholder: 'noreply@dockerfleet.local', secret: false },
  { key: 'EMAIL_FROM_NAME', label: 'Email from name', type: 'text', placeholder: 'DockerFleet', secret: false },
  { key: 'SMTP_HOST', label: 'SMTP host', type: 'text', placeholder: 'localhost', secret: false },
  { key: 'SMTP_PORT', label: 'SMTP port', type: 'number', placeholder: '587', secret: false },
  { key: 'SMTP_SECURE', label: 'SMTP secure', type: 'boolean', placeholder: 'false', secret: false },
  { key: 'SMTP_USER', label: 'SMTP user', type: 'text', placeholder: '', secret: false },
  { key: 'SMTP_PASSWORD', label: 'SMTP password', type: 'password', placeholder: '', secret: true },
  { key: 'SMTP_REJECT_UNAUTHORIZED', label: 'SMTP reject unauthorized', type: 'boolean', placeholder: 'true', secret: false },
  { key: 'REACT_APP_API_URL', label: 'Frontend API URL', type: 'text', placeholder: '(empty = auto-detect)', secret: false },
];

/**
 * GET /api/v1/app-config
 * Returns schema and saved settings (admin only). Effective config comes from env + DB (env overrides).
 */
const getAppConfig = async (req, res, next) => {
  try {
    const rows = await AppSettings.findAll();
    const saved = {};
    rows.forEach((r) => {
      if (ALLOWED_KEYS.has(r.key)) saved[r.key] = r.value ?? '';
    });
    res.json({
      schema: KEY_SCHEMA,
      saved,
      note: 'Secrets (JWT, ENCRYPTION_KEY, DB_*) must be set in .env or environment. Save here applies to non-secret app settings.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/app-config
 * Body: { settings: { KEY: value, ... } }. Saves to DB and reloads into process.env (admin only).
 */
const putAppConfig = async (req, res, next) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Body must include settings object' });
    }
    for (const [key, value] of Object.entries(settings)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      const str = value == null ? '' : String(value);
      const [row] = await AppSettings.findOrCreate({
        where: { key: key },
        defaults: { key: key, value: str },
      });
      await row.update({ value: str });
    }
    await loadAppSettingsIntoEnv(db);
    logger.info('App config updated via GUI');
    const rows = await AppSettings.findAll();
    const saved = {};
    rows.forEach((r) => {
      if (ALLOWED_KEYS.has(r.key)) saved[r.key] = r.value ?? '';
    });
    res.json({ saved, message: 'Settings saved and applied.' });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/app-config/env-file
 * Returns generated .env content (saved settings + placeholders for secrets) for download (admin only).
 */
const getEnvFile = async (req, res, next) => {
  try {
    const rows = await AppSettings.findAll();
    const saved = {};
    rows.forEach((r) => {
      if (ALLOWED_KEYS.has(r.key)) saved[r.key] = r.value ?? '';
    });
    const lines = [
      '# Generated from App Configuration. Add secrets (JWT_SECRET, ENCRYPTION_KEY, DB_PASSWORD) manually.',
      '',
      'NODE_ENV=production',
      'API_VERSION=v1',
      '',
      'DB_NAME=dockerfleet',
      'DB_USER=dockerfleet_user',
      'DB_PASSWORD=change-me',
      '',
      'JWT_SECRET=change-this-in-production',
      'JWT_REFRESH_SECRET=change-this-in-production',
      'ENCRYPTION_KEY=change-this-32-character-key!!',
      '',
      `CORS_ORIGIN=${saved.CORS_ORIGIN ?? 'http://localhost:3020'}`,
      `RATE_LIMIT_WINDOW_MS=${saved.RATE_LIMIT_WINDOW_MS ?? '900000'}`,
      `RATE_LIMIT_MAX_REQUESTS=${saved.RATE_LIMIT_MAX_REQUESTS ?? '2000'}`,
      `RATE_LIMIT_AUTHENTICATED_MAX=${saved.RATE_LIMIT_AUTHENTICATED_MAX ?? '10000'}`,
      `LOG_LEVEL=${saved.LOG_LEVEL ?? 'info'}`,
      `LETSENCRYPT_EMAIL=${saved.LETSENCRYPT_EMAIL ?? ''}`,
      `EMAIL_ENABLED=${saved.EMAIL_ENABLED ?? 'false'}`,
      `EMAIL_FROM_ADDRESS=${saved.EMAIL_FROM_ADDRESS ?? 'noreply@dockerfleet.local'}`,
      `EMAIL_FROM_NAME=${saved.EMAIL_FROM_NAME ?? 'DockerFleet'}`,
      `SMTP_HOST=${saved.SMTP_HOST ?? 'localhost'}`,
      `SMTP_PORT=${saved.SMTP_PORT ?? '587'}`,
      `SMTP_SECURE=${saved.SMTP_SECURE ?? 'false'}`,
      `SMTP_USER=${saved.SMTP_USER ?? ''}`,
      `SMTP_PASSWORD=${saved.SMTP_PASSWORD ?? ''}`,
      `SMTP_REJECT_UNAUTHORIZED=${saved.SMTP_REJECT_UNAUTHORIZED ?? 'true'}`,
      `REACT_APP_API_URL=${saved.REACT_APP_API_URL ?? ''}`,
      '',
    ];
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=".env.generated"');
    res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAppConfig,
  putAppConfig,
  getEnvFile,
};
