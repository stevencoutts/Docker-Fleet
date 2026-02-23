// Only load .env file in development - in production, use environment variables from Docker
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 5000,
  apiVersion: process.env.API_VERSION || 'v1',
  
  database: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  
  encryption: {
    key: process.env.ENCRYPTION_KEY,
    algorithm: 'aes-256-gcm',
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3020',
  },
  
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 2000,
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  
  email: {
    enabled: process.env.EMAIL_ENABLED === 'true',
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@dockerfleet.local',
    fromName: process.env.EMAIL_FROM_NAME || 'DockerFleet Manager',
    smtp: {
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      user: process.env.SMTP_USER || '',
      password: process.env.SMTP_PASSWORD || '',
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
    },
  },
  
  monitoring: {
    checkIntervalMs: parseInt(process.env.MONITORING_CHECK_INTERVAL_MS) || 60000, // Default: 1 minute
    alertCooldownMs: parseInt(process.env.MONITORING_ALERT_COOLDOWN_MS) || 43200000, // Default: 12 hours
    noAutoRestartCooldownMs: parseInt(process.env.MONITORING_NO_AUTO_RESTART_COOLDOWN_MS) || 43200000, // Default: 12 hours
    // Alert type toggles
    alertOnContainerDown: process.env.MONITORING_ALERT_ON_CONTAINER_DOWN !== 'false', // Default: true
    alertOnContainerRecovery: process.env.MONITORING_ALERT_ON_CONTAINER_RECOVERY !== 'false', // Default: true
    alertOnNoAutoRestart: process.env.MONITORING_ALERT_ON_NO_AUTO_RESTART !== 'false', // Default: true
    // Thresholds
    minDownTimeBeforeAlertMs: parseInt(process.env.MONITORING_MIN_DOWN_TIME_MS) || 0, // Default: 0 (alert immediately)
  },
};
