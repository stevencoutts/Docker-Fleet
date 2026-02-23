const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config/config');
const logger = require('./config/logger');

if (config.env === 'production') {
  if (!config.jwt.secret || !config.jwt.refreshSecret) {
    logger.warn('SECURITY: JWT_SECRET and/or JWT_REFRESH_SECRET are not set in production. Set strong secrets via environment variables.');
  }
  if (!config.encryption.key) {
    logger.warn('SECURITY: ENCRYPTION_KEY is not set in production. Set a strong key via environment variables.');
  }
}

const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');
const routes = require('./routes');
const setupSocketIO = require('./websocket/socket.handler');
const monitoringService = require('./services/monitoring.service');
const backupSchedulerService = require('./services/backup-scheduler.service');
const pollingService = require('./services/polling.service');
const db = require('./models');
const socketConfig = require('./config/socket');

const app = express();
const server = http.createServer(app);

// Trust proxy to get correct IP addresses (important for rate limiting)
app.set('trust proxy', true);

// Socket.IO setup - use same CORS logic as Express
const getCorsOrigins = () => {
  const origins = [
    'http://localhost:3020',
    'http://127.0.0.1:3020',
  ];
  
  // Add configured origin
  if (config.cors.origin) {
    origins.push(config.cors.origin);
  }
  
  // Parse hostname from configured origin to allow same hostname with different ports
  const corsOrigin = config.cors.origin || 'http://localhost:3020';
  try {
    const corsUrl = new URL(corsOrigin);
    const corsHostname = corsUrl.hostname;
    // Allow same hostname with common ports
    origins.push(`http://${corsHostname}:3020`);
    origins.push(`https://${corsHostname}:3020`);
  } catch (e) {
    // Invalid URL, skip
  }
  
  return origins;
};

const io = new Server(server, {
  cors: {
    origin: getCorsOrigins(),
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Make io instance available to controllers
socketConfig.setIO(io);

setupSocketIO(io);

// Middleware
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Parse the configured CORS origin to extract hostname
    const corsOrigin = config.cors.origin || 'http://localhost:3020';
    let corsUrl;
    try {
      corsUrl = new URL(corsOrigin);
    } catch (e) {
      corsUrl = new URL('http://localhost:3020');
    }
    const corsHostname = corsUrl.hostname;
    const corsProtocol = corsUrl.protocol;
    
    // List of explicitly allowed origins
    const allowedOrigins = [
      'http://localhost:3020',
      'http://127.0.0.1:3020',
      config.cors.origin,
    ];
    
    // Check if origin is explicitly allowed
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    
    // Parse the request origin
    let requestUrl;
    try {
      requestUrl = new URL(origin);
    } catch (e) {
      callback(new Error('Invalid origin'));
      return;
    }
    
    const requestHostname = requestUrl.hostname;
    const requestProtocol = requestUrl.protocol;
    
    // Allow if hostname matches and protocol matches (http or https)
    // This allows the same hostname with different ports
    if (requestHostname === corsHostname && (requestProtocol === 'http:' || requestProtocol === 'https:')) {
      callback(null, true);
      return;
    }
    
    // For development, allow localhost and 127.0.0.1 with any port
    if (config.env === 'development' && (
      origin.startsWith('http://localhost:') || 
      origin.startsWith('http://127.0.0.1:')
    )) {
      callback(null, true);
      return;
    }
    
    // Allow private network IPs (192.168.x.x, 10.x.x.x) in production for internal deployments
    if (requestHostname.match(/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/)) {
      callback(null, true);
      return;
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting - Completely disabled for development/localhost
const isDevelopment = config.env === 'development' || config.env !== 'production';

// Helper to check if request is from localhost (more comprehensive)
const isLocalhost = (req) => {
  // Check origin header first (most reliable for web requests)
  const origin = req.headers.origin || req.headers.referer || '';
  if (origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('192.168.') || origin.includes('10.100.')) {
    return true;
  }
  
  // Check various ways the IP might be represented
  const forwarded = req.headers['x-forwarded-for'];
  const ip = req.ip || 
             req.connection?.remoteAddress || 
             req.socket?.remoteAddress || 
             req.headers['x-real-ip'] ||
             '127.0.0.1';
  
  let checkIp = forwarded ? forwarded.split(',')[0].trim() : ip;
  
  // Normalize the IP
  if (checkIp === '::1' || checkIp === '::ffff:127.0.0.1') {
    checkIp = '127.0.0.1';
  }
  
  // Check if it's localhost in any form
  const isLocal = checkIp === '127.0.0.1' || 
                  checkIp === '::1' || 
                  checkIp.includes('localhost') ||
                  checkIp.startsWith('172.') || // Docker network
                  checkIp.startsWith('192.168.') || // Local network
                  checkIp.startsWith('10.') || // Private network
                  checkIp === '::ffff:127.0.0.1';
  
  return isLocal;
};

// Create a middleware that completely bypasses rate limiting for localhost
// This middleware will be applied BEFORE the rate limiters
const bypassRateLimit = (req, res, next) => {
  // Always allow localhost/development requests - skip rate limiting entirely
  // Check both development mode and localhost (even in production, localhost should be allowed)
  const shouldBypass = isDevelopment || isLocalhost(req);
  
  if (shouldBypass) {
    // Mark request as bypassed so rate limiters know to skip
    req._rateLimitBypass = true;
    logger.debug(`Bypassing rate limit for ${req.method} ${req.path} from ${req.ip || 'unknown'}`);
    return next();
  }
  // For non-localhost, continue to rate limiter
  next();
};

// Very lenient rate limiter for auth endpoints - but we'll bypass it for localhost
const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: Math.max(1000, config.rateLimit.max * 10),
  message: 'Too many login attempts from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  validate: { trustProxy: false }, // We use trust proxy behind our own reverse proxy; disable strict check
  skip: (req) => {
    // Always skip for localhost/development or if bypassed by middleware
    const shouldSkip = req._rateLimitBypass || isDevelopment || isLocalhost(req);
    if (shouldSkip) {
      logger.debug(`Skipping auth rate limit for ${req.method} ${req.path} from ${req.ip || 'unknown'}`);
    }
    return shouldSkip;
  },
});

// Very lenient rate limiter for console/execute endpoints (interactive use)
const consoleLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // Allow many rapid commands for console usage
  message: 'Too many console commands, please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }, // We use trust proxy behind our own reverse proxy; disable strict check
  skip: (req) => {
    // Always skip for localhost/development or if bypassed by middleware
    const shouldSkip = req._rateLimitBypass || isDevelopment || isLocalhost(req);
    if (shouldSkip) {
      logger.debug('Skipping rate limit for localhost request');
    }
    return shouldSkip;
  },
});

// General rate limiter - bypassed for localhost; uses config for production
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }, // We use trust proxy behind our own reverse proxy; disable strict check
  skip: (req) => {
    // Always skip for localhost/development or if bypassed by middleware
    const shouldSkip = req._rateLimitBypass || isDevelopment || isLocalhost(req);
    if (shouldSkip) {
      logger.debug(`Skipping general rate limit for ${req.method} ${req.path} from ${req.ip || 'unknown'}`);
    }
    return shouldSkip;
  },
});

// Apply bypass middleware globally FIRST - this must be before any rate limiters
// This ensures localhost requests are always bypassed
app.use('/api/', bypassRateLimit);

// Apply rate limiters AFTER bypass middleware
// The skip functions in each limiter will check for bypass flag
// For auth routes, bypass check happens in the limiter's skip function
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/setup', authLimiter);
app.use('/api/v1/auth/me', authLimiter);

// Apply lenient limiter to console/execute endpoints (before general limiter)
app.use('/api/v1/servers/:serverId/containers/:containerId/execute', consoleLimiter);

// Apply general limiter to all other API routes
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use(`/api/${config.apiVersion}`, routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = () => {
  logger.info('Shutting down gracefully...');
  
  // Stop monitoring service
  monitoringService.stop();
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    db.sequelize.close().then(() => {
      logger.info('Database connection closed');
      process.exit(0);
    });
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const PORT = config.port;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${config.env} mode`);
  
  setTimeout(async () => {
    if (config.email && config.email.enabled) {
      await monitoringService.start();
    }
    backupSchedulerService.start();
    pollingService.start();
  }, 5000);
});

module.exports = { app, io };
