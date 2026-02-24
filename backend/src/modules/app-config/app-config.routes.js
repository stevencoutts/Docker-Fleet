const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { getAppConfig, putAppConfig, getEnvFile } = require('./app-config.controller');

router.use(authenticate);
router.use(authorize('admin'));

router.get('/', getAppConfig);
router.put('/', putAppConfig);
router.get('/env-file', getEnvFile);

module.exports = router;
