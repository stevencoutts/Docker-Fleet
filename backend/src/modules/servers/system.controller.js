const { Server, ServerHostInfoCache } = require('../../models');

const getHostInfo = async (req, res, next) => {
  const logger = require('../../config/logger');

  try {
    const serverId = req.params.id || req.params.serverId;

    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    // Read from DB cache only (background poller keeps it updated)
    const row = await ServerHostInfoCache.findOne({
      where: { serverId },
      raw: true,
    });

    const hostInfo = row && row.hostInfo != null ? row.hostInfo : null;
    return res.json({ hostInfo: hostInfo || null });
  } catch (error) {
    logger.error('Host info controller error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message || 'Unknown error',
    });
  }
};

module.exports = {
  getHostInfo,
};
