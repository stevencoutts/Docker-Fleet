const jwt = require('jsonwebtoken');
const { Server } = require('../models');
const dockerService = require('../services/docker.service');
const config = require('../config/config');
const logger = require('../config/logger');

function setupSocketIO(io) {
  // Authentication middleware for Socket.IO
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, config.jwt.secret);
      socket.userId = decoded.userId;
      socket.userRole = decoded.role;
      next();
    } catch (error) {
      logger.error('Socket authentication error:', error);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} (User: ${socket.userId})`);

    // Stream container logs
    socket.on('stream:logs', async ({ serverId, containerId, tail = 100 }) => {
      try {
        const server = await Server.findOne({
          where: { id: serverId, userId: socket.userId },
        });

        if (!server) {
          socket.emit('error', { message: 'Server not found' });
          return;
        }

        const logsResult = await dockerService.getContainerLogs(server, containerId, {
          tail: parseInt(tail),
          follow: true,
        });

        if (logsResult.stream) {
          logsResult.execute(
            (data) => {
              socket.emit('logs:data', { containerId, data });
            },
            (error) => {
              socket.emit('logs:error', { containerId, error });
            }
          );
        }
      } catch (error) {
        logger.error('Log streaming error:', error);
        socket.emit('error', { message: error.message });
      }
    });

    // Stop log streaming
    socket.on('stream:logs:stop', () => {
      // Implementation depends on how we handle stream cancellation
      socket.emit('logs:stopped');
    });

    // Get real-time container stats
    socket.on('stream:stats', async ({ serverId, containerId }) => {
      const interval = setInterval(async () => {
        try {
          const server = await Server.findOne({
            where: { id: serverId, userId: socket.userId },
          });

          if (!server) {
            clearInterval(interval);
            socket.emit('error', { message: 'Server not found' });
            return;
          }

          const stats = await dockerService.getContainerStats(server, containerId);
          socket.emit('stats:data', { containerId, stats });
        } catch (error) {
          clearInterval(interval);
          logger.error('Stats streaming error:', error);
          socket.emit('error', { message: error.message });
        }
      }, 2000); // Update every 2 seconds

      socket.on('disconnect', () => {
        clearInterval(interval);
      });
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });
}

module.exports = setupSocketIO;
