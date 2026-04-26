/**
 * Certificate cache: periodically sync cert lists from Public WWW into DB.
 * Dashboard reads from this cache for instant display.
 */
const { Server, ServerCertificateCache } = require('../models');
const publicWwwService = require('./public-www.service');
const logger = require('../config/logger');

const DEFAULT_INTERVAL_MS = 6 * 3600 * 1000; // 6 hours
const DEFAULT_STALE_AFTER_MS = 6 * 3600 * 1000; // 6 hours
const CONCURRENCY = 1;

function getIntervalMs() {
  const env = process.env.CERT_CACHE_INTERVAL_MS || process.env.DOCKERFLEET_CERT_CACHE_INTERVAL_MS;
  if (env) {
    const n = parseInt(env, 10);
    if (n >= 60 * 1000) return n;
  }
  return DEFAULT_INTERVAL_MS;
}

function getStaleAfterMs() {
  const env = process.env.CERT_CACHE_STALE_AFTER_MS || process.env.DOCKERFLEET_CERT_CACHE_STALE_AFTER_MS;
  if (env) {
    const n = parseInt(env, 10);
    if (n >= 60 * 1000) return n;
  }
  return DEFAULT_STALE_AFTER_MS;
}

async function refreshServer(server) {
  const serverId = server.id;
  const userId = server.userId;
  try {
    const result = await publicWwwService.listCertificates(serverId, userId);
    const now = new Date();
    await ServerCertificateCache.upsert({
      serverId,
      payload: result || { certificates: [] },
      updatedAt: now,
    });
    return { ok: true };
  } catch (e) {
    logger.warn(`Cert cache: refresh failed for server ${serverId}:`, e.message);
    return { ok: false, error: e.message || 'refresh failed' };
  }
}

class CertificateCacheService {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
  }

  start() {
    if (this.intervalId) return;
    const intervalMs = getIntervalMs();
    logger.info(`Certificate cache service started (interval: ${Math.round(intervalMs / 60000)}m, concurrency: ${CONCURRENCY})`);
    this.tick().catch(() => {});
    this.intervalId = setInterval(() => this.tick().catch(() => {}), intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Certificate cache service stopped');
    }
  }

  async tick() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const servers = await Server.findAll({ where: { publicWwwEnabled: true } });
      for (const server of servers) {
        // serial refresh to limit SSH load
        // eslint-disable-next-line no-await-in-loop
        await refreshServer(server);
      }
    } catch (e) {
      logger.error('Cert cache tick error:', e.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Schedule a non-blocking refresh for a user's Public WWW servers.
   */
  refreshUserSoon(userId, { onlyStale = true } = {}) {
    setImmediate(async () => {
      try {
        const servers = await Server.findAll({ where: { userId, publicWwwEnabled: true } });
        if (servers.length === 0) return;

        let staleSet = null;
        if (onlyStale) {
          const caches = await ServerCertificateCache.findAll({
            where: { serverId: servers.map((s) => s.id) },
            attributes: ['serverId', 'updatedAt'],
          });
          staleSet = new Set();
          const staleAfter = getStaleAfterMs();
          const now = Date.now();
          const cacheByServerId = new Map(caches.map((c) => [String(c.serverId), c.updatedAt ? new Date(c.updatedAt).getTime() : 0]));
          for (const s of servers) {
            const t = cacheByServerId.get(String(s.id)) || 0;
            if (!t || now - t > staleAfter) staleSet.add(String(s.id));
          }
        }

        for (const s of servers) {
          if (staleSet && !staleSet.has(String(s.id))) continue;
          // eslint-disable-next-line no-await-in-loop
          await refreshServer(s);
        }
      } catch (e) {
        logger.warn('Cert cache: refreshUserSoon failed:', e.message);
      }
    });
  }
}

const certificateCacheService = new CertificateCacheService();
module.exports = certificateCacheService;

