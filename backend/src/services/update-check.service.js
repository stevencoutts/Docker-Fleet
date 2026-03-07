const { Server, UpdateOverviewCache, User } = require('../models');
const dockerService = require('./docker.service');
const emailService = require('./email.service');
const config = require('../config/config');
const logger = require('../config/logger');

function getContainerName(container) {
  const names = container.Names || '';
  const str = typeof names === 'string' ? names : (names[0] || '');
  return (str || '').replace(/^\//, '') || container.ID?.substring(0, 12) || 'unknown';
}

/**
 * Run update check for a user: check all their containers, save result to cache, return payload.
 * @param {string} userId
 * @returns {Promise<{ ranOnce: boolean, containers: array, totalChecked: number, errors: array, lastCheckedAt: string }>}
 */
async function runCheckForUser(userId) {
  const servers = await Server.findAll({
    where: { userId },
    order: [['name', 'ASC']],
  });

  const containersWithUpdates = [];
  const errors = [];
  let totalChecked = 0;

  for (const server of servers) {
    let containers = [];
    try {
      containers = await dockerService.listContainers(server, true);
    } catch (e) {
      logger.warn(`Update check: listContainers failed for server ${server.id}:`, e.message);
      continue;
    }

    if (!Array.isArray(containers) || containers.length === 0) continue;

    for (const container of containers) {
      if (container.SkipUpdate) continue;
      const containerId = container.ID || container.Id || '';
      if (!containerId) continue;

      totalChecked += 1;
      try {
        const status = await dockerService.getContainerUpdateStatus(server, containerId);
        if (status.updateAvailable) {
          containersWithUpdates.push({
            serverId: server.id,
            serverName: server.name || 'Unknown',
            serverHost: server.host || 'Unknown',
            containerId,
            containerName: getContainerName(container),
            imageRef: status.imageRef,
            currentDigestShort: status.currentDigestShort,
            availableDigestShort: status.availableDigestShort,
            pinned: status.pinned,
            reason: status.reason,
          });
        }
      } catch (e) {
        errors.push({
          serverId: server.id,
          containerId,
          containerName: getContainerName(container),
          error: e.message || 'Update check failed',
        });
      }
    }
  }

  const payload = {
    ranOnce: true,
    containers: containersWithUpdates,
    totalChecked,
    errors,
    lastCheckedAt: new Date().toISOString(),
  };

  const [row] = await UpdateOverviewCache.findOrCreate({
    where: { userId },
    defaults: { userId, payload, updatedAt: new Date() },
  });
  await row.update({ payload, updatedAt: new Date() });

  return payload;
}

let intervalId = null;

function start() {
  if (intervalId) {
    logger.warn('Update check service already running');
    return;
  }

  const ms = config.updateCheck?.intervalMs ?? 4 * 3600 * 1000;
  logger.info(`Starting scheduled update check (interval: ${Math.round(ms / 3600000)}h)`);

  const runScheduledCheck = async () => {
    if (!config.email.enabled) {
      logger.debug('Update check skip: email disabled');
      return;
    }
    if (!emailService.initialized) {
      await emailService.initialize();
    }
    if (!emailService.initialized) {
      logger.debug('Update check skip: email not configured');
      return;
    }
    try {
      const servers = await Server.findAll({ attributes: ['userId'] });
      const userIds = [...new Set(servers.map((s) => s.userId).filter(Boolean))];
      for (const userId of userIds) {
        try {
          const payload = await runCheckForUser(userId);
          if (payload.containers && payload.containers.length > 0) {
            const user = await User.findByPk(userId);
            if (user && user.email) {
              const result = await emailService.sendImageUpdatesAlert(user.email, payload.containers);
              if (result.success) {
                logger.info(`Image updates alert sent to ${user.email} (${payload.containers.length} containers)`);
              }
            }
          }
        } catch (e) {
          logger.error(`Update check for user ${userId}:`, e.message);
        }
      }
    } catch (e) {
      logger.error('Scheduled update check failed:', e);
    }
  };

  intervalId = setInterval(runScheduledCheck, ms);
  runScheduledCheck();
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Scheduled update check stopped');
  }
}

module.exports = {
  runCheckForUser,
  start,
  stop,
};
