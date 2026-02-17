const express = require('express');
const router = express.Router();
const {
  getContainers,
  getContainerDetails,
  getContainerLogs,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  getContainerStats,
} = require('./containers.controller');
const { authenticate } = require('../../middleware/auth.middleware');

router.use(authenticate);

router.get('/:serverId/containers', getContainers);
router.get('/:serverId/containers/:containerId', getContainerDetails);
router.get('/:serverId/containers/:containerId/logs', getContainerLogs);
router.get('/:serverId/containers/:containerId/stats', getContainerStats);
router.post('/:serverId/containers/:containerId/start', startContainer);
router.post('/:serverId/containers/:containerId/stop', stopContainer);
router.post('/:serverId/containers/:containerId/restart', restartContainer);
router.delete('/:serverId/containers/:containerId', removeContainer);

module.exports = router;
