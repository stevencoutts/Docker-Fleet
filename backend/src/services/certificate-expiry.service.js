/**
 * Certificate expiry check: runs periodically for servers with publicWwwEnabled.
 * When any cert has validDays < 30: sends email alert and runs certbot renew.
 * Cooldown prevents alert spam (default 7 days per server).
 */
const { Server, User } = require('../models');
const publicWwwService = require('./public-www.service');
const emailService = require('./email.service');
const config = require('../config/config');
const logger = require('../config/logger');

const EXPIRY_THRESHOLD_DAYS = 30;

/** serverId -> lastAlertAt (ms) */
const lastAlertByServer = new Map();

let intervalId = null;

function getCooldownMs() {
  return config.certExpiryCheck?.alertCooldownMs ?? 7 * 24 * 3600 * 1000;
}

function canSendAlert(serverId) {
  const last = lastAlertByServer.get(serverId);
  if (!last) return true;
  return Date.now() - last >= getCooldownMs();
}

async function runCheckForServer(server, user) {
  if (!user || !user.email) return;

  let certs;
  try {
    const result = await publicWwwService.listCertificates(server.id, server.userId);
    certs = result?.certificates || [];
  } catch (e) {
    logger.warn(`Certificate expiry check: listCertificates failed for server ${server.id}:`, e.message);
    return;
  }

  const expiring = (certs || []).filter((c) => {
    const days = c.validDays;
    return days != null && days < EXPIRY_THRESHOLD_DAYS;
  });

  if (expiring.length === 0) return;

  let renewSuccess = false;
  let renewError = null;
  try {
    await publicWwwService.renewCertificates(server.id, server.userId);
    renewSuccess = true;
  } catch (e) {
    renewError = e.message || 'Unknown error';
    logger.warn(`Certificate expiry check: renew failed for server ${server.id}:`, renewError);
  }

  if (!canSendAlert(server.id)) {
    logger.debug(`Certificate expiry: skipping alert for server ${server.id} (cooldown)`);
    return;
  }

  const result = await emailService.sendCertificateExpiryAlert(user.email, server, expiring, {
    renewed: renewSuccess,
    renewError,
  });
  if (result.success) {
    lastAlertByServer.set(server.id, Date.now());
    logger.info(`Certificate expiry alert sent to ${user.email} for server ${server.name || server.id}`);
  }
}

async function runScheduledCheck() {
  if (!config.email?.enabled) {
    logger.debug('Certificate expiry check skip: email disabled');
    return;
  }
  if (!emailService.initialized) {
    await emailService.initialize();
  }
  if (!emailService.initialized) {
    logger.debug('Certificate expiry check skip: email not configured');
    return;
  }

  const cfg = config.certExpiryCheck;
  if (cfg?.enabled === false) {
    logger.debug('Certificate expiry check skip: disabled via config');
    return;
  }

  try {
    const servers = await Server.findAll({
      where: { publicWwwEnabled: true },
      include: [{ model: User, as: 'user', attributes: ['id', 'email'] }],
    });

    for (const server of servers) {
      const user = server.user;
      if (!user?.email) continue;
      try {
        await runCheckForServer(server, user);
      } catch (e) {
        logger.error(`Certificate expiry check failed for server ${server.id}:`, e.message);
      }
    }
  } catch (e) {
    logger.error('Certificate expiry check failed:', e);
  }
}

function start() {
  if (intervalId) {
    logger.warn('Certificate expiry service already running');
    return;
  }

  const ms = config.certExpiryCheck?.intervalMs ?? 24 * 3600 * 1000;
  logger.info(`Starting certificate expiry check (interval: ${Math.round(ms / 3600000)}h)`);

  intervalId = setInterval(runScheduledCheck, ms);
  runScheduledCheck();
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Certificate expiry service stopped');
  }
}

module.exports = {
  runScheduledCheck,
  start,
  stop,
};
