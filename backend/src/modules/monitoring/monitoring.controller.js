const { body } = require('express-validator');
const { MonitoringSettings, User } = require('../../models');
const logger = require('../../config/logger');
const config = require('../../config/config');

// Get monitoring settings for current user
const getMonitoringSettings = async (req, res, next) => {
  try {
    let settings = await MonitoringSettings.findOne({
      where: { userId: req.user.id },
    });

    // If no settings exist, create default ones
    if (!settings) {
      settings = await MonitoringSettings.create({
        userId: req.user.id,
        alertOnContainerDown: config.monitoring.alertOnContainerDown,
        alertOnContainerRecovery: config.monitoring.alertOnContainerRecovery,
        alertOnNoAutoRestart: config.monitoring.alertOnNoAutoRestart,
        alertCooldownMs: config.monitoring.alertCooldownMs,
        noAutoRestartCooldownMs: config.monitoring.noAutoRestartCooldownMs,
        minDownTimeBeforeAlertMs: config.monitoring.minDownTimeBeforeAlertMs,
      });
    }

    res.json({ settings });
  } catch (error) {
    logger.error('Error fetching monitoring settings:', error);
    next(error);
  }
};

// Update monitoring settings for current user
const updateMonitoringSettings = async (req, res, next) => {
  try {
    const {
      alertOnContainerDown,
      alertOnContainerRecovery,
      alertOnNoAutoRestart,
      alertCooldownMs,
      noAutoRestartCooldownMs,
      minDownTimeBeforeAlertMs,
    } = req.body;

    let settings = await MonitoringSettings.findOne({
      where: { userId: req.user.id },
    });

    if (!settings) {
      // Create new settings if they don't exist
      settings = await MonitoringSettings.create({
        userId: req.user.id,
        alertOnContainerDown: alertOnContainerDown !== undefined ? alertOnContainerDown : config.monitoring.alertOnContainerDown,
        alertOnContainerRecovery: alertOnContainerRecovery !== undefined ? alertOnContainerRecovery : config.monitoring.alertOnContainerRecovery,
        alertOnNoAutoRestart: alertOnNoAutoRestart !== undefined ? alertOnNoAutoRestart : config.monitoring.alertOnNoAutoRestart,
        alertCooldownMs: alertCooldownMs !== undefined ? alertCooldownMs : config.monitoring.alertCooldownMs,
        noAutoRestartCooldownMs: noAutoRestartCooldownMs !== undefined ? noAutoRestartCooldownMs : config.monitoring.noAutoRestartCooldownMs,
        minDownTimeBeforeAlertMs: minDownTimeBeforeAlertMs !== undefined ? minDownTimeBeforeAlertMs : config.monitoring.minDownTimeBeforeAlertMs,
      });
    } else {
      // Update existing settings
      if (alertOnContainerDown !== undefined) settings.alertOnContainerDown = alertOnContainerDown;
      if (alertOnContainerRecovery !== undefined) settings.alertOnContainerRecovery = alertOnContainerRecovery;
      if (alertOnNoAutoRestart !== undefined) settings.alertOnNoAutoRestart = alertOnNoAutoRestart;
      if (alertCooldownMs !== undefined) settings.alertCooldownMs = alertCooldownMs;
      if (noAutoRestartCooldownMs !== undefined) settings.noAutoRestartCooldownMs = noAutoRestartCooldownMs;
      if (minDownTimeBeforeAlertMs !== undefined) settings.minDownTimeBeforeAlertMs = minDownTimeBeforeAlertMs;

      await settings.save();
    }

    res.json({ 
      message: 'Monitoring settings updated successfully',
      settings 
    });
  } catch (error) {
    logger.error('Error updating monitoring settings:', error);
    next(error);
  }
};

// Validation rules
const monitoringSettingsValidation = [
  body('alertOnContainerDown').optional().isBoolean().withMessage('alertOnContainerDown must be a boolean'),
  body('alertOnContainerRecovery').optional().isBoolean().withMessage('alertOnContainerRecovery must be a boolean'),
  body('alertOnNoAutoRestart').optional().isBoolean().withMessage('alertOnNoAutoRestart must be a boolean'),
  body('alertCooldownMs').optional().isInt({ min: 0 }).withMessage('alertCooldownMs must be a non-negative integer'),
  body('noAutoRestartCooldownMs').optional().isInt({ min: 0 }).withMessage('noAutoRestartCooldownMs must be a non-negative integer'),
  body('minDownTimeBeforeAlertMs').optional().isInt({ min: 0 }).withMessage('minDownTimeBeforeAlertMs must be a non-negative integer'),
];

module.exports = {
  getMonitoringSettings,
  updateMonitoringSettings,
  monitoringSettingsValidation,
};
