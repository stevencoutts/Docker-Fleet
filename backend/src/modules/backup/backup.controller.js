/**
 * Backup (export) and restore (import) of user data.
 * Includes servers (metadata only, no private keys), Public WWW (publicWwwEnabled, sshAllowedIps, proxy routes),
 * backup schedules, backup jobs, monitoring settings, and grouping rules.
 */
const {
  Server,
  ServerProxyRoute,
  User,
  MonitoringSettings,
  ContainerGroupingRule,
  BackupSchedule,
  BackupJob,
  BackupJobEntry,
} = require('../../models');
const backupSchedulerService = require('../../services/backup-scheduler.service');
const logger = require('../../config/logger');

const BACKUP_VERSION = 1;

/**
 * GET /api/v1/backup/export
 * Returns JSON backup of current user's data (no private keys).
 */
const exportData = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId, {
      attributes: ['id', 'email', 'letsEncryptEmail'],
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const servers = await Server.findAll({
      where: { userId },
      attributes: ['id', 'name', 'host', 'port', 'username', 'publicWwwEnabled', 'sshAllowedIps'],
    });

    const serverIds = servers.map((s) => s.id);
    const proxyRoutes = await ServerProxyRoute.findAll({
      where: { serverId: serverIds },
      attributes: ['serverId', 'domain', 'containerName', 'containerPort'],
    });

    const monitoringSettings = await MonitoringSettings.findOne({
      where: { userId },
      attributes: [
        'alertOnContainerDown',
        'alertOnContainerRecovery',
        'alertOnNoAutoRestart',
        'alertCooldownMs',
        'noAutoRestartCooldownMs',
        'minDownTimeBeforeAlertMs',
      ],
    });

    const groupingRules = await ContainerGroupingRule.findAll({
      where: { userId },
      attributes: ['groupName', 'pattern', 'patternType', 'enabled', 'sortOrder'],
    });

    const backupSchedules = await BackupSchedule.findAll({
      where: { userId },
      include: [{ model: Server, as: 'server', attributes: ['id', 'name', 'host'] }],
    });

    const backupJobs = await BackupJob.findAll({
      where: { userId },
      include: [
        {
          model: BackupJobEntry,
          as: 'entries',
          include: [{ model: Server, as: 'server', attributes: ['id', 'name', 'host'] }],
        },
      ],
    });

    const backup = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        letsEncryptEmail: user.letsEncryptEmail ?? null,
      },
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        host: s.host,
        port: s.port,
        username: s.username,
        publicWwwEnabled: s.publicWwwEnabled,
        sshAllowedIps: s.sshAllowedIps ?? null,
        customNginxConfig: s.customNginxConfig ?? null,
      })),
      serverProxyRoutes: proxyRoutes.map((r) => ({
        serverId: r.serverId,
        domain: r.domain,
        containerName: r.containerName,
        containerPort: r.containerPort,
        customNginxBlock: r.customNginxBlock ?? null,
      })),
      monitoringSettings: monitoringSettings
        ? {
            alertOnContainerDown: monitoringSettings.alertOnContainerDown,
            alertOnContainerRecovery: monitoringSettings.alertOnContainerRecovery,
            alertOnNoAutoRestart: monitoringSettings.alertOnNoAutoRestart,
            alertCooldownMs: monitoringSettings.alertCooldownMs,
            noAutoRestartCooldownMs: monitoringSettings.noAutoRestartCooldownMs,
            minDownTimeBeforeAlertMs: monitoringSettings.minDownTimeBeforeAlertMs,
          }
        : null,
      containerGroupingRules: groupingRules.map((r) => ({
        groupName: r.groupName,
        pattern: r.pattern,
        patternType: r.patternType,
        enabled: r.enabled,
        sortOrder: r.sortOrder,
      })),
      backupSchedules: backupSchedules.map((s) => ({
        serverId: s.serverId,
        serverName: s.server?.name ?? null,
        serverHost: s.server?.host ?? null,
        containerName: s.containerName,
        scheduleType: s.scheduleType,
        scheduleConfig: s.scheduleConfig,
        retention: s.retention,
        enabled: s.enabled,
      })),
      backupJobs: backupJobs.map((j) => ({
        name: j.name,
        scheduleType: j.scheduleType,
        scheduleConfig: j.scheduleConfig,
        retention: j.retention,
        enabled: j.enabled,
        entries: (j.entries || []).map((e) => ({
          serverId: e.serverId,
          serverName: e.server?.name ?? null,
          serverHost: e.server?.host ?? null,
          containerName: e.containerName,
        })),
      })),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="dockerfleet-backup-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.json(backup);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/backup/import
 * Body: backup JSON (from export).
 * Restores config into current user; servers are matched by (name, host). Does not create new servers or restore private keys.
 */
const importData = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const data = req.body;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid backup: body must be a JSON object' });
    }
    if (data.version !== BACKUP_VERSION) {
      return res.status(400).json({
        error: `Unsupported backup version: ${data.version}. This app supports version ${BACKUP_VERSION}.`,
      });
    }

    const backupServers = Array.isArray(data.servers) ? data.servers : [];
    const currentServers = await Server.findAll({
      where: { userId },
      attributes: ['id', 'name', 'host'],
    });
    const serverKey = (s) => `${(s.name || '').trim()}\n${(s.host || '').trim()}`;
    const serverName = (s) => (s.name || '').trim().toLowerCase();
    const oldIdToNewId = new Map();
    for (const backupS of backupServers) {
      const key = serverKey(backupS);
      let match = currentServers.find((c) => serverKey(c) === key);
      if (!match) {
        const nameOnly = currentServers.filter((c) => serverName(c) === serverName(backupS));
        if (nameOnly.length === 1) match = nameOnly[0];
      }
      if (match) oldIdToNewId.set(String(backupS.id), match.id);
    }

    let restored = { serversMatched: oldIdToNewId.size, serversInBackup: backupServers.length };

    for (const backupS of backupServers) {
      const newId = oldIdToNewId.get(String(backupS.id));
      if (!newId) continue;
      await Server.update(
        {
          publicWwwEnabled: !!backupS.publicWwwEnabled,
          sshAllowedIps: backupS.sshAllowedIps ?? null,
          customNginxConfig: backupS.customNginxConfig ?? null,
        },
        { where: { id: newId, userId } }
      );
    }

    const proxyRoutes = Array.isArray(data.serverProxyRoutes)
      ? data.serverProxyRoutes
      : Array.isArray(data.proxyRoutes)
        ? data.proxyRoutes
        : [];
    // When backup has routes but no server matched (or only one current server), assign all backup route serverIds to a current server so routes aren't lost
    if (currentServers.length >= 1 && proxyRoutes.length > 0) {
      const targetId = currentServers[0].id;
      const routeServerIds = [...new Set(proxyRoutes.map((r) => String(r.serverId)).filter(Boolean))];
      const anyUnmapped = routeServerIds.some((bid) => !oldIdToNewId.has(bid));
      if (currentServers.length === 1 || (anyUnmapped && oldIdToNewId.size === 0)) {
        for (const bid of routeServerIds) {
          if (!oldIdToNewId.has(bid)) oldIdToNewId.set(bid, targetId);
        }
      }
    }
    const newServerIdsForRoutes = new Set(oldIdToNewId.values());
    for (const newServerId of newServerIdsForRoutes) {
      await ServerProxyRoute.destroy({ where: { serverId: newServerId } });
    }
    for (const r of proxyRoutes) {
      const newServerId = oldIdToNewId.get(String(r.serverId));
      if (!newServerId) continue;
      await ServerProxyRoute.create({
        serverId: newServerId,
        domain: r.domain,
        containerName: r.containerName,
        containerPort: r.containerPort,
        customNginxBlock: r.customNginxBlock ?? null,
      });
    }
    restored.proxyRoutes = proxyRoutes.filter((r) => oldIdToNewId.has(String(r.serverId))).length;

    if (data.monitoringSettings && typeof data.monitoringSettings === 'object') {
      const ms = data.monitoringSettings;
      const [existing] = await MonitoringSettings.findOrCreate({
        where: { userId },
        defaults: {
          userId,
          alertOnContainerDown: true,
          alertOnContainerRecovery: true,
          alertOnNoAutoRestart: true,
          alertCooldownMs: 43200000,
          noAutoRestartCooldownMs: 43200000,
          minDownTimeBeforeAlertMs: 0,
        },
      });
      await existing.update({
        alertOnContainerDown: ms.alertOnContainerDown !== false,
        alertOnContainerRecovery: ms.alertOnContainerRecovery !== false,
        alertOnNoAutoRestart: ms.alertOnNoAutoRestart !== false,
        alertCooldownMs: Math.max(0, parseInt(ms.alertCooldownMs, 10) || 43200000),
        noAutoRestartCooldownMs: Math.max(0, parseInt(ms.noAutoRestartCooldownMs, 10) || 43200000),
        minDownTimeBeforeAlertMs: Math.max(0, parseInt(ms.minDownTimeBeforeAlertMs, 10) || 0),
      });
      restored.monitoringSettings = true;
    }

    const groupingRules = Array.isArray(data.containerGroupingRules) ? data.containerGroupingRules : [];
    await ContainerGroupingRule.destroy({ where: { userId } });
    for (const r of groupingRules) {
      await ContainerGroupingRule.create({
        userId,
        groupName: r.groupName,
        pattern: r.pattern,
        patternType: r.patternType || 'prefix',
        enabled: r.enabled !== false,
        sortOrder: parseInt(r.sortOrder, 10) || 0,
      });
    }
    restored.containerGroupingRules = groupingRules.length;

    const schedules = Array.isArray(data.backupSchedules) ? data.backupSchedules : [];
    const scheduleServerId = (s) => {
      const key = `${(s.serverName || '').trim()}\n${(s.serverHost || '').trim()}`;
      return currentServers.find((c) => serverKey(c) === key)?.id;
    };
    await BackupSchedule.destroy({ where: { userId } });
    for (const s of schedules) {
      const newServerId = scheduleServerId(s);
      if (!newServerId) continue;
      const created = await BackupSchedule.create({
        userId,
        serverId: newServerId,
        containerName: s.containerName,
        scheduleType: s.scheduleType,
        scheduleConfig: s.scheduleConfig || {},
        retention: Math.max(1, parseInt(s.retention, 10) || 5),
        enabled: s.enabled !== false,
      });
      await backupSchedulerService.constructor.setNextRunAt(created);
    }
    restored.backupSchedules = schedules.filter((s) => scheduleServerId(s)).length;

    const jobs = Array.isArray(data.backupJobs) ? data.backupJobs : [];
    await BackupJob.destroy({ where: { userId } });
    for (const j of jobs) {
      const entries = Array.isArray(j.entries) ? j.entries : [];
      const validEntries = entries
        .map((e) => {
          const newServerId = currentServers.find(
            (c) => serverKey(c) === `${(e.serverName || '').trim()}\n${(e.serverHost || '').trim()}`
          )?.id;
          return newServerId ? { serverId: newServerId, containerName: e.containerName } : null;
        })
        .filter(Boolean);
      if (validEntries.length === 0) continue;
      const job = await BackupJob.create({
        userId,
        name: j.name ? String(j.name).trim() : null,
        scheduleType: j.scheduleType || 'daily',
        scheduleConfig: j.scheduleConfig || {},
        retention: Math.max(1, parseInt(j.retention, 10) || 5),
        enabled: j.enabled !== false,
      });
      for (const { serverId, containerName } of validEntries) {
        await BackupJobEntry.create({
          backupJobId: job.id,
          serverId,
          containerName,
        });
      }
      await backupSchedulerService.constructor.setNextRunAt(job);
    }
    restored.backupJobs = jobs.length;

    logger.info('Backup restored', { userId, restored });
    res.json({
      message: 'Restore completed.',
      restored,
    });
  } catch (error) {
    logger.error('Backup restore failed', { userId: req.user?.id, error: error.message });
    next(error);
  }
};

module.exports = {
  exportData,
  importData,
};
