const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const {
  getAppConfig,
  putAppConfig,
  getEnvFile,
  getStackUpdateConfig,
  putStackUpdateConfig,
  postStackUpdateRun,
} = require('./app-config.controller');

router.use(authenticate);
router.use(authorize('admin'));

router.get('/', getAppConfig);
router.put('/', putAppConfig);
router.get('/env-file', getEnvFile);
router.get('/stack-update', getStackUpdateConfig);
router.put('/stack-update', putStackUpdateConfig);
router.post('/stack-update/run', postStackUpdateRun);

module.exports = router;
