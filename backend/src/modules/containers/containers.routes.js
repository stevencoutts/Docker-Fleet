const express = require('express');
const router = express.Router();
const {
  getContainers,
  getContainerDetails,
  getContainerUpdateStatus,
  pullAndRecreateContainer,
  getContainerLogs,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  getContainerStats,
  updateRestartPolicy,
  executeCommand,
  createSnapshot,
  getSnapshots,
  restoreSnapshot,
} = require('./containers.controller');
const { authenticate } = require('../../middleware/auth.middleware');

router.use(authenticate);

router.get('/:serverId/containers', getContainers);
router.get('/:serverId/containers/:containerId/update-status', getContainerUpdateStatus);
router.post('/:serverId/containers/:containerId/pull-and-update', pullAndRecreateContainer);
router.get('/:serverId/containers/:containerId/logs', getContainerLogs);
router.get('/:serverId/containers/:containerId/stats', getContainerStats);
router.get('/:serverId/containers/:containerId/snapshots', getSnapshots);
router.get('/:serverId/containers/:containerId', getContainerDetails);
router.put('/:serverId/containers/:containerId/restart-policy', updateRestartPolicy);
router.post('/:serverId/containers/:containerId/execute', executeCommand);
router.post('/:serverId/containers/:containerId/snapshot', createSnapshot);
router.post('/:serverId/containers/restore', restoreSnapshot);
router.post('/:serverId/containers/:containerId/start', startContainer);
router.post('/:serverId/containers/:containerId/stop', stopContainer);
router.post('/:serverId/containers/:containerId/restart', restartContainer);
router.delete('/:serverId/containers/:containerId', removeContainer);

module.exports = router;
