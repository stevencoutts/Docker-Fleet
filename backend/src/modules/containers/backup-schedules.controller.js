const { BackupJob, BackupJobEntry, Server } = require('../../models');

/**
 * List backup jobs that have an entry on this server (optionally for this container).
 * Returns { jobs } for compatibility with container details page.
 */
const listBackupSchedules = async (req, res, next) => {
  try {
    const { serverId } = req.params;
    const { containerName } = req.query;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const jobs = await BackupJob.findAll({
      where: { userId: req.user.id },
      include: [
        {
          model: BackupJobEntry,
          as: 'entries',
          where: { serverId },
          required: true,
          include: [{ model: Server, as: 'server', attributes: ['id', 'name', 'host'] }],
        },
      ],
      order: [['nextRunAt', 'ASC']],
    });

    let result = jobs;
    if (containerName) {
      const cn = String(containerName).trim();
      result = jobs.filter((j) => (j.entries || []).some((e) => (e.containerName || '').trim() === cn));
    }
    res.json({ jobs: result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listBackupSchedules,
};
