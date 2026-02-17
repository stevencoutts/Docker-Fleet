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

// Rate limiting - Skip entirely for localhost/development
const isDevelopment = config.env === 'development' || config.env !== 'production';

// Helper to check if request is from localhost
const isLocalhost = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
  const checkIp = forwarded ? forwarded.split(',')[0].trim() : ip;
  return checkIp.includes('127.0.0.1') || 
         checkIp.includes('::1') || 
         checkIp.includes('localhost') || 
         checkIp === '::ffff:127.0.0.1' ||
         checkIp.startsWith('172.') || // Docker network
         checkIp.startsWith('192.168.') || // Local network
         checkIp.startsWith('10.'); // Private network
};

// Very lenient rate limiter for auth endpoints - disabled for localhost
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 10000, // Extremely high limit
  message: 'Too many login attempts from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) => isDevelopment || isLocalhost(req), // Skip rate limiting for localhost
  keyGenerator: (req) => {
    if (isDevelopment || isLocalhost(req)) {
      return 'localhost-dev';
    }
    const forwarded = req.headers['x-forwarded-for'];
    const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
    return forwarded ? forwarded.split(',')[0].trim() : ip;
  },
});

// General rate limiter - disabled for localhost
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: 10000, // Extremely high limit
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isDevelopment || isLocalhost(req), // Skip rate limiting for localhost
  keyGenerator: (req) => {
    if (isDevelopment || isLocalhost(req)) {
      return 'localhost-dev';
    }
    const forwarded = req.headers['x-forwarded-for'];
    const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
    return forwarded ? forwarded.split(',')[0].trim() : ip;
  },
});

// Apply auth limiter to auth routes BEFORE general limiter
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/setup', authLimiter);
app.use('/api/v1/auth/me', authLimiter);

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
