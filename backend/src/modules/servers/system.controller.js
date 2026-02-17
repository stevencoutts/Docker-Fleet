const { Server } = require('../../models');
const dockerService = require('../../services/docker.service');

const getHostInfo = async (req, res, next) => {
  const logger = require('../../config/logger');
  
  try {
    // Try both id and serverId in case route param name differs
    const serverId = req.params.id || req.params.serverId;
    logger.info(`Fetching host info - params:`, req.params);
    logger.info(`Fetching host info for server: ${serverId}, user: ${req.user?.id}`);

    if (!req.user || !req.user.id) {
      logger.error('No user in request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      logger.warn(`Server not found: ${serverId} for user: ${req.user.id}`);
      return res.status(404).json({ error: 'Server not found' });
    }

    logger.info(`Server found: ${server.name} (${server.host}), fetching host info...`);
    
    try {
      const hostInfo = await dockerService.getHostInfo(server);
      logger.info('Host info retrieved successfully', { keys: Object.keys(hostInfo) });
      return res.json({ hostInfo });
    } catch (error) {
      logger.error('Failed to get host info:', error);
      logger.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      // Return 200 with error info so frontend can still display other data
      return res.status(200).json({ 
        hostInfo: {
          error: 'Some information unavailable',
          details: error.message || 'Unknown error',
        }
      });
    }
  } catch (error) {
    logger.error('Host info controller error:', error);
    logger.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message || 'Unknown error'
    });
  }
};

module.exports = {
  getHostInfo,
};
