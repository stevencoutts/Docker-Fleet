const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config/config');
const logger = require('./config/logger');
const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');
const routes = require('./routes');
const setupSocketIO = require('./websocket/socket.handler');
const db = require('./models');

const app = express();
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:3020',
      'http://127.0.0.1:3020',
      config.cors.origin,
    ],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

setupSocketIO(io);

// Middleware
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:3020',
      'http://127.0.0.1:3020',
      config.cors.origin,
    ];
    
    // Check if origin is allowed
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // For development, allow localhost and 127.0.0.1 with any port
      if (config.env === 'development' && (
        origin.startsWith('http://localhost:') || 
        origin.startsWith('http://127.0.0.1:')
      )) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
  if (isDevelopment || isLocalhost(req)) {
    // Mark request as bypassed so rate limiters know to skip
    req._rateLimitBypass = true;
    return next();
  }
  // For non-localhost, continue to rate limiter
  next();
};

// Very lenient rate limiter for auth endpoints - but we'll bypass it for localhost
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Reasonable limit for production
  message: 'Too many login attempts from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) => {
    // Always skip for localhost/development or if bypassed by middleware
    const shouldSkip = req._rateLimitBypass || isDevelopment || isLocalhost(req);
    if (shouldSkip) {
      logger.debug('Skipping rate limit for localhost request');
    }
    return shouldSkip;
  },
});

// General rate limiter - bypassed for localhost
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Always skip for localhost/development or if bypassed by middleware
    const shouldSkip = req._rateLimitBypass || isDevelopment || isLocalhost(req);
    if (shouldSkip) {
      logger.debug('Skipping rate limit for localhost request');
    }
    return shouldSkip;
  },
});

// Apply bypass middleware first, then rate limiters
// For auth routes, bypass check happens in the limiter's skip function
app.use('/api/v1/auth/login', bypassRateLimit, authLimiter);
app.use('/api/v1/auth/register', bypassRateLimit, authLimiter);
app.use('/api/v1/auth/setup', bypassRateLimit, authLimiter);
app.use('/api/v1/auth/me', bypassRateLimit, authLimiter);

// Apply general limiter to all other API routes
app.use('/api/', bypassRateLimit, limiter);

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
});

module.exports = { app, io };
