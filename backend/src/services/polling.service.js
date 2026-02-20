/**
 * Background polling: sync container lists and host info from Docker/SSH into the DB.
 * Web app reads from DB only; this service keeps the cache fresh.
 */
const { Server, ServerContainerCache, ServerHostInfoCache } = require('../models');
const dockerService = require('./docker.service');
const sshService = require('./ssh.service');
const { getIO } = require('../config/socket');
const logger = require('../config/logger');

const DEFAULT_INTERVAL_MS = 30 * 1000; // 30 seconds
const CONCURRENCY = 1; // Sync one server at a time to limit SSH load

// Last sync error per server (for UI diagnostics). Cleared on success.
const lastSyncErrorByServerId = new Map();

function getIntervalMs() {
  const env = process.env.POLLING_INTERVAL_MS || process.env.DOCKERFLEET_POLLING_INTERVAL_MS;
  if (env) {
    const n = parseInt(env, 10);
    if (n >= 5000) return n;
  }
  return DEFAULT_INTERVAL_MS;
}

function setSyncError(serverId, message) {
  lastSyncErrorByServerId.set(serverId, message);
}

function clearSyncError(serverId) {
  lastSyncErrorByServerId.delete(serverId);
}

async function syncServer(server) {
  const serverId = server.id;
  try {
    // Containers (all: true so dashboard can show stopped too)
    const containers = await dockerService.listContainers(server, true);
    const now = new Date();

    await ServerContainerCache.destroy({ where: { serverId } });
    if (containers.length > 0) {
      const rows = containers.map((c) => ({
        serverId,
        containerId: (c.ID || c.Id || '').substring(0, 64),
        payload: c,
        updatedAt: now,
      }));
      await ServerContainerCache.bulkCreate(rows);
    }
    logger.debug(`Polling: synced ${containers.length} containers for server ${serverId}`);
    clearSyncError(serverId);

    // Host info
    try {
      const hostInfo = await dockerService.getHostInfo(server);
      await ServerHostInfoCache.upsert({
        serverId,
        hostInfo: hostInfo || {},
        updatedAt: now,
      });
    } catch (hostErr) {
      logger.warn(`Polling: host info failed for server ${serverId}:`, hostErr.message);
      // Keep previous cache or leave empty
    }

    const io = getIO();
    if (io) {
      io.emit('server:containers:updated', { serverId });
      io.emit('server:hostinfo:updated', { serverId });
    }
  } catch (err) {
    const msg = err.message || String(err);
    logger.error(`Polling: sync failed for server ${serverId}:`, msg);
    setSyncError(serverId, msg);
    // Disconnect SSH so next tick tries a fresh connection (helps after host reboot/update)
    try {
      sshService.disconnect(serverId);
    } catch (e) { /* ignore */ }
  }
}

class PollingService {
  constructor() {
    this.intervalId = null;
    this.intervalMs = getIntervalMs();
    this.isRunning = false;
    this.refreshQueue = new Set(); // serverIds to refresh on next tick (deduped)
  }

  start() {
    if (this.intervalId) return;
    this.intervalMs = getIntervalMs();
    logger.info(`Polling service started (interval: ${this.intervalMs / 1000}s, concurrency: ${CONCURRENCY})`);
    this.tick();
    this.intervalId = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Polling service stopped');
    }
  }

  /**
   * Request an immediate refresh for a server (e.g. after start/stop/restart container).
   */
  refreshServer(serverId) {
    this.refreshQueue.add(serverId);
  }

  async tick() {
    if (this.isRunning) {
      logger.debug('Polling: tick skipped (previous still running)');
      return;
    }
    this.isRunning = true;
    try {
      // Load full server (need port, username, privateKeyEncrypted for SSH)
      const servers = await Server.findAll();
      for (const server of servers) {
        await syncServer(server);
      }
      this.refreshQueue.clear();
    } catch (err) {
      logger.error('Polling tick error:', err.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run a one-off sync for a single server (e.g. after user action). Non-blocking.
   */
  async syncServerNow(serverId) {
    const server = await Server.findByPk(serverId);
    if (!server) return;
    await syncServer(server);
  }

  /**
   * Get last sync error for a server (for UI diagnostics). Returns null if none.
   */
  getLastSyncError(serverId) {
    return lastSyncErrorByServerId.get(serverId) ?? null;
  }
}

const pollingService = new PollingService();
module.exports = pollingService;
