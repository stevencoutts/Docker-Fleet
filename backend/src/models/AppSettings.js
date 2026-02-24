const { DataTypes } = require('sequelize');

/** Keys allowed to be stored in AppSettings (non-secret app config). Secrets (JWT, ENCRYPTION_KEY, DB_*) stay in env only. */
const ALLOWED_KEYS = new Set([
  'CORS_ORIGIN',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
  'RATE_LIMIT_AUTHENTICATED_MAX',
  'LOG_LEVEL',
  'LETSENCRYPT_EMAIL',
  'EMAIL_ENABLED',
  'EMAIL_FROM_ADDRESS',
  'EMAIL_FROM_NAME',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_REJECT_UNAUTHORIZED',
  'REACT_APP_API_URL',
]);

module.exports = (sequelize) => {
  const AppSettings = sequelize.define(
    'AppSettings',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      key: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        field: 'key',
      },
      value: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'value',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    {
      tableName: 'app_settings',
      timestamps: true,
    }
  );

  AppSettings.ALLOWED_KEYS = ALLOWED_KEYS;
  return AppSettings;
};
