const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const authRoutes = require('../modules/auth/auth.routes');
const serversRoutes = require('../modules/servers/servers.routes');
const containersRoutes = require('../modules/containers/containers.routes');
const imagesRoutes = require('../modules/images/images.routes');
const usersRoutes = require('../modules/users/users.routes');
const monitoringRoutes = require('../modules/monitoring/monitoring.routes');
const groupingRoutes = require('../modules/grouping/grouping.routes');
const backupSchedulesRoutes = require('../modules/backup-schedules/backup-schedules.routes');
const backupRoutes = require('../modules/backup/backup.routes');
const appConfigRoutes = require('../modules/app-config/app-config.routes');

// Public: only auth routes (setup, login, register, refresh); /auth/me uses authenticate in its own route
router.use('/auth', authRoutes);

// All other API routes require a valid Bearer token
router.use(authenticate);
router.use('/app-config', appConfigRoutes);
router.use('/backup', backupRoutes);
router.use('/backup-schedules', backupSchedulesRoutes);
router.use('/servers', serversRoutes);
router.use('/servers', containersRoutes);
router.use('/servers', imagesRoutes);
router.use('/users', usersRoutes);
router.use('/monitoring', monitoringRoutes);
router.use('/grouping', groupingRoutes);

module.exports = router;
