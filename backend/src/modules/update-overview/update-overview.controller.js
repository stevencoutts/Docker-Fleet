const { UpdateOverviewCache } = require('../../models');
const updateCheckService = require('../../services/update-check.service');

/**
 * GET /api/v1/update-overview
 * Returns stored update overview for current user (synced across browsers).
 */
const getUpdateOverview = async (req, res, next) => {
  try {
    const row = await UpdateOverviewCache.findOne({
      where: { userId: req.user.id },
    });
    const payload = row?.payload || {};
    const result = {
      ranOnce: payload.ranOnce === true,
      containers: Array.isArray(payload.containers) ? payload.containers : [],
      totalChecked: typeof payload.totalChecked === 'number' ? payload.totalChecked : 0,
      errors: Array.isArray(payload.errors) ? payload.errors : [],
      lastCheckedAt: payload.lastCheckedAt || null,
    };
    res.json(result);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/update-overview/check
 * Runs update check for all of user's containers, stores result, returns it (synced across browsers).
 */
const runUpdateCheck = async (req, res, next) => {
  try {
    const payload = await updateCheckService.runCheckForUser(req.user.id);
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/update-overview/remove-container
 * Body: { serverId, containerId }. Removes one container from stored overview (e.g. after user updated it).
 */
const removeContainerFromOverview = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.body || {};
    if (!serverId || !containerId) {
      return res.status(400).json({ error: 'serverId and containerId required' });
    }

    const row = await UpdateOverviewCache.findOne({
      where: { userId: req.user.id },
    });
    if (!row || !row.payload || !Array.isArray(row.payload.containers)) {
      return res.json({ ranOnce: true, containers: [], totalChecked: 0, errors: [], lastCheckedAt: null });
    }

    const containers = row.payload.containers.filter(
      (c) => !(String(c.serverId) === String(serverId) && String(c.containerId) === String(containerId))
    );
    const payload = {
      ...row.payload,
      containers,
    };
    await row.update({ payload, updatedAt: new Date() });

    res.json(payload);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getUpdateOverview,
  runUpdateCheck,
  removeContainerFromOverview,
};
