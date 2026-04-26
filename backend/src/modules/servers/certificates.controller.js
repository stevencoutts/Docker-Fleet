const { Server, ServerCertificateCache } = require('../../models');
const certificateCacheService = require('../../services/certificate-cache.service');

const DEFAULT_THRESHOLD_DAYS = 30;

function parseThresholdDays(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_THRESHOLD_DAYS;
  return Math.min(3650, Math.max(0, n));
}

async function getCertificateOverview(req, res, next) {
  try {
    const userId = req.user.id;
    const thresholdDays = parseThresholdDays(req.query.thresholdDays);

    const servers = await Server.findAll({
      where: { userId, publicWwwEnabled: true },
      attributes: ['id', 'name', 'host', 'publicWwwEnabled'],
      order: [['name', 'ASC']],
    });

    if (!servers.length) {
      return res.json({ checkedServers: 0, thresholdDays, expiring: [], errors: 0, updatedAt: null });
    }

    const caches = await ServerCertificateCache.findAll({
      where: { serverId: servers.map((s) => s.id) },
      attributes: ['serverId', 'payload', 'updatedAt'],
    });
    const cacheByServerId = new Map(caches.map((c) => [String(c.serverId), c]));

    const expiring = [];
    let errors = 0;
    let newestUpdatedAt = null;
    let anyMissing = false;

    for (const server of servers) {
      const cache = cacheByServerId.get(String(server.id));
      if (!cache) {
        anyMissing = true;
        errors += 1;
        continue;
      }
      if (cache.updatedAt && (!newestUpdatedAt || new Date(cache.updatedAt) > newestUpdatedAt)) {
        newestUpdatedAt = new Date(cache.updatedAt);
      }
      const certs = cache.payload?.certificates || [];
      for (const c of certs) {
        const days = c?.validDays;
        if (days == null) continue;
        if (days <= thresholdDays) {
          expiring.push({
            serverId: server.id,
            serverName: server.name || server.host || 'Unknown',
            serverHost: server.host || server.name || 'Unknown',
            name: c.name,
            expiryDate: c.expiryDate,
            validDays: days,
          });
        }
      }
    }

    expiring.sort((a, b) => (a.validDays ?? 999999) - (b.validDays ?? 999999));

    // If caches are missing/stale, schedule a background refresh.
    // We still return cached data immediately.
    if (anyMissing || req.query.refresh === '1') {
      certificateCacheService.refreshUserSoon(userId, { onlyStale: req.query.refresh !== '1' });
    } else {
      // also opportunistically refresh stale entries
      certificateCacheService.refreshUserSoon(userId, { onlyStale: true });
    }

    res.json({
      checkedServers: servers.length,
      thresholdDays,
      expiring,
      errors,
      updatedAt: newestUpdatedAt ? newestUpdatedAt.toISOString() : null,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  getCertificateOverview,
};

