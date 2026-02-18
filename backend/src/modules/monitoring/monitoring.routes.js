const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validation.middleware');
const {
  getMonitoringSettings,
  updateMonitoringSettings,
  monitoringSettingsValidation,
} = require('./monitoring.controller');

router.use(authenticate);

router.get('/', getMonitoringSettings);
router.put('/', monitoringSettingsValidation, validate, updateMonitoringSettings);

module.exports = router;
