import React, { useState, useEffect } from 'react';
import { monitoringService } from '../services/monitoring.service';

const MonitoringSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [settings, setSettings] = useState({
    alertOnContainerDown: true,
    alertOnContainerRecovery: true,
    alertOnNoAutoRestart: true,
    alertCooldownMs: 43200000, // 12 hours
    noAutoRestartCooldownMs: 43200000, // 12 hours
    minDownTimeBeforeAlertMs: 0,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await monitoringService.getSettings();
      if (response.settings) {
        setSettings(response.settings);
      }
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch monitoring settings');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setSettings((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await monitoringService.updateSettings(settings);
      setSuccess('Monitoring settings updated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update monitoring settings');
    } finally {
      setSaving(false);
    }
  };

  const formatMsToHours = (ms) => {
    return (ms / 3600000).toFixed(1);
  };

  const formatMsToMinutes = (ms) => {
    return (ms / 60000).toFixed(0);
  };

  const hoursToMs = (hours) => {
    return Math.round(parseFloat(hours) * 3600000);
  };

  const minutesToMs = (minutes) => {
    return Math.round(parseFloat(minutes) * 60000);
  };

  if (loading) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-400">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Email Alert Settings</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Configure when and how often you receive email alerts</p>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 p-4">
          <div className="text-sm text-red-800 dark:text-red-200">{error}</div>
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-md bg-green-50 dark:bg-green-900/20 p-4">
          <div className="text-sm text-green-800 dark:text-green-200">{success}</div>
        </div>
      )}

      <div className="max-w-3xl">
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 space-y-6">
          {/* Alert Type Toggles */}
          <div>
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Alert Types</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Alert when containers with auto-restart are down
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Receive alerts when containers that should be running are stopped
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.alertOnContainerDown}
                    onChange={(e) => handleChange('alertOnContainerDown', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Alert when containers recover
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Receive alerts when previously down containers start running again
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.alertOnContainerRecovery}
                    onChange={(e) => handleChange('alertOnContainerRecovery', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Alert for containers without auto-restart
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Receive alerts for running containers that don't have auto-restart enabled
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.alertOnNoAutoRestart}
                    onChange={(e) => handleChange('alertOnNoAutoRestart', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Cooldown Settings */}
          <div>
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Alert Cooldown Periods</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              How long to wait before resending alerts for the same issue
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Container Down/Recovery Alert Cooldown (hours)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={formatMsToHours(settings.alertCooldownMs)}
                  onChange={(e) => handleChange('alertCooldownMs', hoursToMs(e.target.value))}
                  className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Alerts for the same container issue will only be resent after this period (default: 12 hours)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  No Auto-Restart Alert Cooldown (hours)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={formatMsToHours(settings.noAutoRestartCooldownMs)}
                  onChange={(e) => handleChange('noAutoRestartCooldownMs', hoursToMs(e.target.value))}
                  className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Alerts for containers without auto-restart will only be resent after this period (default: 12 hours)
                </p>
              </div>
            </div>
          </div>

          {/* Thresholds */}
          <div>
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Alert Thresholds</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Minimum Down Time Before Alert (minutes)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formatMsToMinutes(settings.minDownTimeBeforeAlertMs)}
                  onChange={(e) => handleChange('minDownTimeBeforeAlertMs', minutesToMs(e.target.value))}
                  className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Wait this long before sending the first alert when a container goes down (0 = alert immediately)
                </p>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded hover:bg-primary-700 dark:hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonitoringSettings;
