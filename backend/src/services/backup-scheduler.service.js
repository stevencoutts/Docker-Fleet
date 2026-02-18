/**
 * Scheduled backups: run due BackupJobs (one job = many entries; commit each container, prune by retention).
 */
const { Op } = require('sequelize');
const { BackupJob, BackupJobEntry, Server } = require('../models');
const dockerService = require('./docker.service');
const logger = require('../config/logger');

const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

function computeNextRunAt(schedule) {
  const now = new Date();
  const last = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null;
  const ref = last || now;
  const type = schedule.scheduleType;
  const cfg = schedule.scheduleConfig || {};

  if (type === 'interval') {
    const hours = Math.max(1, parseInt(cfg.intervalHours, 10) || 24);
    const next = new Date(ref.getTime() + hours * 60 * 60 * 1000);
    return next;
  }

  if (type === 'daily') {
    const hour = Math.min(23, Math.max(0, parseInt(cfg.hour, 10) || 2));
    const minute = Math.min(59, Math.max(0, parseInt(cfg.minute, 10) || 0));
    const next = new Date(ref);
    next.setUTCHours(hour, minute, 0, 0);
    if (next <= ref) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  if (type === 'weekly') {
    const dayOfWeek = Math.min(6, Math.max(0, parseInt(cfg.dayOfWeek, 10) || 0)); // 0 = Sunday
    const hour = Math.min(23, Math.max(0, parseInt(cfg.hour, 10) || 2));
    const minute = Math.min(59, Math.max(0, parseInt(cfg.minute, 10) || 0));
    const next = new Date(ref);
    next.setUTCHours(hour, minute, 0, 0);
    let days = dayOfWeek - next.getUTCDay();
    if (days < 0) days += 7;
    if (days === 0 && next <= ref) days = 7;
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  return new Date(ref.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Find container ID on server whose name matches (with or without leading slash).
 */
async function findContainerIdByName(server, containerName) {
  const normalized = (containerName || '').trim().replace(/^\//, '');
  if (!normalized) return null;
  const containers = await dockerService.listContainers(server, true);
  for (const c of containers) {
    const name = (c.Names || c.Name || '').replace(/^\//, '').trim();
    if (name === normalized) return c.ID || c.Id;
  }
  return null;
}

/**
 * Create snapshot image name for scheduled backup (same pattern as manual: name-snapshot-YYYYMMDD-HHMMSS).
 */
function scheduledSnapshotImageName(containerName) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
  return `${containerName.replace(/^\//, '')}-snapshot-${dateStr}-${timeStr}`;
}

/**
 * Run one backup: commit container to image, then prune old snapshots beyond retention.
 * @param {object} server - Server model instance
 * @param {string} containerName - Container name
 * @param {number} retention - How many snapshots to keep
 */
async function runBackupForEntry(server, containerName, retention) {
  const containerId = await findContainerIdByName(server, containerName);
  if (!containerId) {
    logger.warn(`Backup: container "${containerName}" not found on server`);
    return;
  }

  const imageName = scheduledSnapshotImageName(containerName);
  const tag = 'snapshot';

  try {
    await dockerService.commitContainer(server, containerId, imageName, tag);
    logger.info(`Scheduled backup: ${containerName} -> ${imageName}:${tag}`);
  } catch (err) {
    logger.error(`Scheduled backup failed for ${containerName}:`, err.message);
    return;
  }

  const keep = Math.max(1, parseInt(retention, 10) || 5);
  try {
    const snapshots = await dockerService.getSnapshotsForContainer(server, containerId);
    if (snapshots.length > keep) {
      const byCreated = [...snapshots].sort((a, b) => {
        const tA = (a.created && new Date(a.created).getTime()) || 0;
        const tB = (b.created && new Date(b.created).getTime()) || 0;
        return tB - tA;
      });
      const toRemove = byCreated.slice(keep);
      for (const s of toRemove) {
        try {
          await dockerService.removeImage(server, s.id, true);
          logger.debug(`Pruned old backup: ${s.name} (${s.id})`);
        } catch (e) {
          logger.warn(`Could not prune image ${s.id}:`, e.message);
        }
      }
    }
  } catch (e) {
    logger.warn(`Could not list/prune snapshots for ${containerName}:`, e.message);
  }
}

class BackupSchedulerService {
  constructor() {
    this.intervalId = null;
  }

  start() {
    if (this.intervalId) return;
    logger.info('Backup scheduler started (check every 1 min)');
    this.tick();
    this.intervalId = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Backup scheduler stopped');
    }
  }

  async tick() {
    try {
      const now = new Date();
      const due = await BackupJob.findAll({
        where: {
          enabled: true,
          [Op.or]: [
            { nextRunAt: null },
            { nextRunAt: { [Op.lte]: now } },
          ],
        },
        include: [
          {
            model: BackupJobEntry,
            as: 'entries',
            include: [{ model: Server, as: 'server', attributes: ['id', 'userId', 'name', 'host'] }],
          },
        ],
      });

      for (const job of due) {
        try {
          const retention = Math.max(1, parseInt(job.retention, 10) || 5);
          for (const entry of job.entries || []) {
            const server = entry.server;
            if (!server || server.userId !== job.userId) continue;
            try {
              await runBackupForEntry(server, entry.containerName, retention);
            } catch (err) {
              logger.error(`Backup job ${job.id} entry ${entry.containerName}:`, err.message);
            }
          }
        } catch (err) {
          logger.error(`Backup job ${job.id} error:`, err.message);
        }

        const nextRunAt = computeNextRunAt({
          ...job.toJSON(),
          lastRunAt: now,
        });
        await job.update({ lastRunAt: now, nextRunAt });
      }
    } catch (err) {
      logger.error('Backup scheduler tick error:', err.message);
    }
  }

  /**
   * Set nextRunAt for a job (e.g. when creating or updating).
   */
  static setNextRunAt(job) {
    const next = computeNextRunAt(job);
    return job.update({ nextRunAt: next });
  }
}

const backupSchedulerService = new BackupSchedulerService();
backupSchedulerService.computeNextRunAt = computeNextRunAt;

module.exports = backupSchedulerService;
