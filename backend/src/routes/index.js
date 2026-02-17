const express = require('express');
const router = express.Router();
const authRoutes = require('../modules/auth/auth.routes');
const serversRoutes = require('../modules/servers/servers.routes');
const containersRoutes = require('../modules/containers/containers.routes');
const imagesRoutes = require('../modules/images/images.routes');

router.use('/auth', authRoutes);
router.use('/servers', serversRoutes);
router.use('/servers', containersRoutes);
router.use('/servers', imagesRoutes);

module.exports = router;
