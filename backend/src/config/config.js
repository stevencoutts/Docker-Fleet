// Only load .env file in development - in production, use environment variables from Docker
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Getters so config reflects process.env at read time (allows AppSettings to merge in after DB load).
module.exports = {
  get env() {
    return process.env.NODE_ENV || 'development';
  },
  get port() {
    return parseInt(process.env.PORT) || 5000;
  },
  get apiVersion() {
    return process.env.API_VERSION || 'v1';
  },

  get database() {
    return {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      name: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };
  },

  get jwt() {
    return {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
      refreshSecret: process.env.JWT_REFRESH_SECRET,
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    };
  },

  get encryption() {
    return {
      key: process.env.ENCRYPTION_KEY,
      algorithm: 'aes-256-gcm',
    };
  },

  get cors() {
    return {
      origin: process.env.CORS_ORIGIN || 'http://localhost:3020',
    };
  },

  get rateLimit() {
    return {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 2000,
      authenticatedMax: parseInt(process.env.RATE_LIMIT_AUTHENTICATED_MAX) || 10000,
    };
  },

  get logging() {
    return {
      level: process.env.LOG_LEVEL || 'info',
    };
  },

  get email() {
    return {
      enabled: process.env.EMAIL_ENABLED === 'true',
      fromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@dockerfleet.local',
      fromName: process.env.EMAIL_FROM_NAME || 'DockerFleet Manager',
      smtp: {
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || '',
        password: process.env.SMTP_PASSWORD || '',
        rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
      },
    };
  },

  get monitoring() {
    return {
      checkIntervalMs: parseInt(process.env.MONITORING_CHECK_INTERVAL_MS) || 60000,
      alertCooldownMs: parseInt(process.env.MONITORING_ALERT_COOLDOWN_MS) || 43200000,
      noAutoRestartCooldownMs: parseInt(process.env.MONITORING_NO_AUTO_RESTART_COOLDOWN_MS) || 43200000,
      alertOnContainerDown: process.env.MONITORING_ALERT_ON_CONTAINER_DOWN !== 'false',
      alertOnContainerRecovery: process.env.MONITORING_ALERT_ON_CONTAINER_RECOVERY !== 'false',
      alertOnNoAutoRestart: process.env.MONITORING_ALERT_ON_NO_AUTO_RESTART !== 'false',
      minDownTimeBeforeAlertMs: parseInt(process.env.MONITORING_MIN_DOWN_TIME_MS) || 0,
    };
  },
};
