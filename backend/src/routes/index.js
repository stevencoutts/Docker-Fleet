const express = require('express');
const router = express.Router();
const authRoutes = require('../modules/auth/auth.routes');
const serversRoutes = require('../modules/servers/servers.routes');
const containersRoutes = require('../modules/containers/containers.routes');
const imagesRoutes = require('../modules/images/images.routes');
const usersRoutes = require('../modules/users/users.routes');
const monitoringRoutes = require('../modules/monitoring/monitoring.routes');
const groupingRoutes = require('../modules/grouping/grouping.routes');
const backupSchedulesRoutes = require('../modules/backup-schedules/backup-schedules.routes');
const backupRoutes = require('../modules/backup/backup.routes');

router.use('/auth', authRoutes);
router.use('/backup', backupRoutes);
router.use('/backup-schedules', backupSchedulesRoutes);
router.use('/servers', serversRoutes);
router.use('/servers', containersRoutes);
router.use('/servers', imagesRoutes);
router.use('/users', usersRoutes);
router.use('/monitoring', monitoringRoutes);
router.use('/grouping', groupingRoutes);

module.exports = router;
