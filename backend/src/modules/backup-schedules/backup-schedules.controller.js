const { BackupJob, BackupJobEntry, Server } = require('../../models');
const backupSchedulerService = require('../../services/backup-scheduler.service');

const validScheduleTypes = ['interval', 'daily', 'weekly'];
const MAX_BULK_TARGETS = 200;
const MAX_SCHEDULE_CONFIG_KEYS = 20;
const MAX_SCHEDULE_CONFIG_STRING_LENGTH = 2000;

/**
 * List all backup jobs for the current user (each job has many entries).
 * GET /api/v1/backup-schedules?serverId=...
 */
const listJobs = async (req, res, next) => {
  try {
    const { serverId } = req.query;
    const { containerName } = req.query;
    const jobs = await BackupJob.findAll({
      where: { userId: req.user.id },
      include: [
        {
          model: BackupJobEntry,
          as: 'entries',
          include: [{ model: Server, as: 'server', attributes: ['id', 'name', 'host'] }],
        },
      ],
      order: [['nextRunAt', 'ASC']],
    });
    let result = jobs;
    if (serverId || containerName) {
      result = jobs.filter((j) =>
        (j.entries || []).some(
          (e) =>
            (!serverId || e.serverId === serverId) &&
            (!containerName || (e.containerName || '').trim() === String(containerName || '').trim())
        )
      );
    }
    res.json({ jobs: result });
  } catch (error) {
    next(error);
  }
};

/**
 * Create one backup job with many entries. Same schedule for all.
 * POST /api/v1/backup-schedules/bulk
 * Body: { targets: [{ serverId, containerName }, ...], scheduleType, scheduleConfig?, retention?, enabled?, name? }
 */
const createJob = async (req, res, next) => {
  try {
    const { targets, scheduleType, scheduleConfig, retention, enabled, name } = req.body;

    if (!Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: 'targets must be a non-empty array of { serverId, containerName }' });
    }
    if (targets.length > MAX_BULK_TARGETS) {
      return res.status(400).json({ error: `Too many targets (max ${MAX_BULK_TARGETS})` });
    }
    if (scheduleConfig != null && (typeof scheduleConfig !== 'object' || Array.isArray(scheduleConfig))) {
      return res.status(400).json({ error: 'scheduleConfig must be an object' });
    }
    if (scheduleConfig && Object.keys(scheduleConfig).length > MAX_SCHEDULE_CONFIG_KEYS) {
      return res.status(400).json({ error: `scheduleConfig has too many keys (max ${MAX_SCHEDULE_CONFIG_KEYS})` });
    }
    if (scheduleConfig && JSON.stringify(scheduleConfig).length > MAX_SCHEDULE_CONFIG_STRING_LENGTH) {
      return res.status(400).json({ error: 'scheduleConfig too large' });
    }
    if (!scheduleType || !validScheduleTypes.includes(scheduleType)) {
      return res.status(400).json({
        error: 'scheduleType is required and must be one of: interval, daily, weekly',
      });
    }

    const userId = req.user.id;
    const retentionVal = retention != null ? Math.max(1, parseInt(retention, 10) || 5) : 5;
    const enabledVal = enabled !== false;

    const serverIds = [...new Set(targets.map((t) => t.serverId).filter(Boolean))];
    const servers = await Server.findAll({
      where: { id: serverIds, userId },
      attributes: ['id'],
    });
    const allowedServerIds = new Set(servers.map((s) => s.id));

    const entriesToCreate = [];
    for (const t of targets) {
      const serverId = t.serverId;
      const containerName = t.containerName ? String(t.containerName).trim() : '';
      if (!serverId || !containerName) continue;
      if (!allowedServerIds.has(serverId)) continue;
      entriesToCreate.push({ serverId, containerName });
    }

    if (entriesToCreate.length === 0) {
      return res.status(400).json({ error: 'No valid targets (serverId + containerName) for your servers' });
    }

    const job = await BackupJob.create({
      userId,
      name: name ? String(name).trim() : null,
      scheduleType,
      scheduleConfig: scheduleConfig || {},
      retention: retentionVal,
      enabled: enabledVal,
    });

    for (const { serverId, containerName } of entriesToCreate) {
      await BackupJobEntry.create({
        backupJobId: job.id,
        serverId,
        containerName,
      });
    }

    await backupSchedulerService.constructor.setNextRunAt(job);
    const withEntries = await BackupJob.findByPk(job.id, {
      include: [
        {
          model: BackupJobEntry,
          as: 'entries',
          include: [{ model: Server, as: 'server', attributes: ['id', 'name', 'host'] }],
        },
      ],
    });
    res.status(201).json({ job: withEntries });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a backup job's schedule config.
 * PUT /api/v1/backup-schedules/:jobId
 */
const updateJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { scheduleType, scheduleConfig, retention, enabled, name } = req.body;
    const job = await BackupJob.findOne({
      where: { id: jobId, userId: req.user.id },
    });
    if (!job) {
      return res.status(404).json({ error: 'Backup job not found' });
    }
    const updates = {};
    if (scheduleType !== undefined) {
      if (!validScheduleTypes.includes(scheduleType)) {
        return res.status(400).json({ error: 'scheduleType must be one of: interval, daily, weekly' });
      }
      updates.scheduleType = scheduleType;
    }
    if (scheduleConfig !== undefined) {
      if (typeof scheduleConfig !== 'object' || scheduleConfig === null || Array.isArray(scheduleConfig)) {
        return res.status(400).json({ error: 'scheduleConfig must be an object' });
      }
      if (Object.keys(scheduleConfig).length > MAX_SCHEDULE_CONFIG_KEYS) {
        return res.status(400).json({ error: `scheduleConfig has too many keys (max ${MAX_SCHEDULE_CONFIG_KEYS})` });
      }
      const configStr = JSON.stringify(scheduleConfig);
      if (configStr.length > MAX_SCHEDULE_CONFIG_STRING_LENGTH) {
        return res.status(400).json({ error: 'scheduleConfig too large' });
      }
      updates.scheduleConfig = scheduleConfig;
    }
    if (retention !== undefined) updates.retention = Math.max(1, parseInt(retention, 10) || 5);
    if (enabled !== undefined) updates.enabled = enabled;
    if (name !== undefined) updates.name = name ? String(name).trim() : null;
    await job.update(updates);
    await backupSchedulerService.constructor.setNextRunAt(job);
    const updated = await BackupJob.findByPk(job.id, {
      include: [
        {
          model: BackupJobEntry,
          as: 'entries',
          include: [{ model: Server, as: 'server', attributes: ['id', 'name', 'host'] }],
        },
      ],
    });
    res.json({ job: updated });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a backup job (and all its entries).
 * DELETE /api/v1/backup-schedules/:jobId
 */
const deleteJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const job = await BackupJob.findOne({
      where: { id: jobId, userId: req.user.id },
    });
    if (!job) {
      return res.status(404).json({ error: 'Backup job not found' });
    }
    await job.destroy(); // cascade deletes entries
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listJobs,
  createJob,
  updateJob,
  deleteJob,
};