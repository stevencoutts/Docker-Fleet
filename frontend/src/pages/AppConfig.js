import React, { useState, useEffect } from 'react';
import { appConfigService } from '../services/appConfig.service';
import { serversService } from '../services/servers.service';

const AppConfig = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [schema, setSchema] = useState([]);
  const [saved, setSaved] = useState({});
  const [note, setNote] = useState('');
  const [form, setForm] = useState({});
  const [servers, setServers] = useState([]);
  const [stackUpdate, setStackUpdate] = useState({ serverId: '', path: '' });
  const [stackUpdateSaving, setStackUpdateSaving] = useState(false);
  const [stackUpdateRunning, setStackUpdateRunning] = useState(false);
  const [stackUpdateResult, setStackUpdateResult] = useState(null);
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [testEmailMessage, setTestEmailMessage] = useState(null);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const [configRes, stackRes, serversRes] = await Promise.all([
        appConfigService.get(),
        appConfigService.getStackUpdateConfig().catch(() => ({ data: { serverId: '', path: '' } })),
        serversService.getAll().catch(() => ({ data: { servers: [] } })),
      ]);
      setSchema(configRes.data.schema || []);
      setSaved(configRes.data.saved || {});
      setNote(configRes.data.note || '');
      setForm(configRes.data.saved || {});
      setStackUpdate({ serverId: stackRes.data?.serverId ?? '', path: stackRes.data?.path ?? '' });
      setServers(serversRes.data?.servers ?? []);
      setError(null);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to load app configuration';
      const status = err.response?.status;
      setError(status === 403 ? 'Access denied. Only admins can view app configuration.' : status === 401 ? 'Please sign in again.' : msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      // Build payload from schema so every key (including SMTP_*) is always sent
      const payload = {};
      schema.forEach((item) => {
        payload[item.key] = form[item.key] ?? '';
      });
      const res = await appConfigService.put(payload);
      if (res.data?.saved) {
        setForm(res.data.saved);
        setSaved(res.data.saved);
      }
      setSuccess('Settings saved and applied.');
      setTimeout(() => setSuccess(null), 4000);
      fetchConfig();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadEnv = async () => {
    try {
      const text = await appConfigService.getEnvFile();
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '.env.generated';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err.message || 'Failed to download .env file');
    }
  };

  const handleSaveStackUpdateConfig = async () => {
    try {
      setStackUpdateSaving(true);
      setError(null);
      await appConfigService.putStackUpdateConfig(stackUpdate);
      setSuccess('Stack update config saved.');
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save stack update config');
    } finally {
      setStackUpdateSaving(false);
    }
  };

  const handleTestEmail = async () => {
    try {
      setTestEmailLoading(true);
      setTestEmailMessage(null);
      setError(null);
      const res = await appConfigService.sendTestEmail(form);
      setTestEmailMessage(res.data?.message || 'Test email sent.');
      setSuccess(res.data?.message || 'Test email sent.');
      setTimeout(() => setSuccess(null), 5000);
      setTimeout(() => setTestEmailMessage(null), 8000);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to send test email';
      setTestEmailMessage(msg);
      setError(msg);
    } finally {
      setTestEmailLoading(false);
    }
  };

  const handleRunStackUpdate = async () => {
    if (!stackUpdate.serverId || !stackUpdate.path) {
      setError('Select the server and enter the path above, then run update.');
      return;
    }
    try {
      setStackUpdateRunning(true);
      setStackUpdateResult(null);
      setError(null);
      const res = await appConfigService.runStackUpdate(stackUpdate);
      setStackUpdateResult(res.data);
      if (res.data?.success) setSuccess('Docker Fleet stack updated. You may need to refresh the page.');
      else setError(res.data?.stderr || res.data?.stdout || 'Update failed.');
      if (res.data?.success) setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setStackUpdateResult(null);
      setError(err.response?.data?.error || err.message || 'Update failed');
    } finally {
      setStackUpdateRunning(false);
    }
  };

  const renderField = (item) => {
    const value = form[item.key] ?? '';
    if (item.type === 'boolean') {
      return (
        <input
          type="checkbox"
          checked={value === 'true' || value === true}
          onChange={(e) => handleChange(item.key, e.target.checked ? 'true' : 'false')}
          className="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
      );
    }
    if (item.type === 'password') {
      return (
        <input
          type="password"
          value={value}
          onChange={(e) => handleChange(item.key, e.target.value)}
          placeholder={item.placeholder}
          className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm px-3 py-2 sm:text-sm"
          autoComplete="off"
        />
      );
    }
    if (item.type === 'number') {
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => handleChange(item.key, e.target.value)}
          placeholder={item.placeholder}
          className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm px-3 py-2 sm:text-sm"
        />
      );
    }
    return (
      <input
        type={item.type === 'email' ? 'email' : 'text'}
        value={value}
        onChange={(e) => handleChange(item.key, e.target.value)}
        placeholder={item.placeholder}
        className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm px-3 py-2 sm:text-sm"
      />
    );
  };

  if (loading) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-400">Loading configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">App configuration</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Manage app settings. Saved values are applied immediately. Download .env to use with Docker Compose.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleDownloadEnv}
            className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
          >
            Download .env
          </button>
          <button
            type="button"
            onClick={handleTestEmail}
            disabled={testEmailLoading}
            className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            {testEmailLoading ? 'Sending...' : 'Test email'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {note && (
        <div className="mb-4 rounded-md bg-blue-50 dark:bg-blue-900/20 p-4">
          <p className="text-sm text-blue-800 dark:text-blue-200">{note}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 p-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          <button
            type="button"
            onClick={() => { setError(null); fetchConfig(); }}
            className="shrink-0 inline-flex items-center px-3 py-1.5 border border-red-300 dark:border-red-700 rounded-md text-sm font-medium text-red-700 dark:text-red-200 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            Retry
          </button>
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-md bg-green-50 dark:bg-green-900/20 p-4">
          <p className="text-sm text-green-800 dark:text-green-200">{success}</p>
        </div>
      )}

      <div className="mb-6 bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
        <div className="px-4 py-5 sm:p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Docker Fleet stack update</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Run <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">docker compose pull &amp;&amp; docker compose up -d</code> on the server where this app runs. Configure that server and the project path, then run update. Brief downtime is expected.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Server (host that runs Docker Fleet)</label>
              <select
                value={stackUpdate.serverId}
                onChange={(e) => setStackUpdate((s) => ({ ...s, serverId: e.target.value }))}
                className="block w-48 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm px-3 py-2 sm:text-sm"
              >
                <option value="">— Select —</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name || s.host || s.id}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0 flex-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Path to project on host</label>
              <input
                type="text"
                value={stackUpdate.path}
                onChange={(e) => setStackUpdate((s) => ({ ...s, path: e.target.value }))}
                placeholder="e.g. /opt/dockerfleet"
                className="block w-full max-w-md rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm px-3 py-2 sm:text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveStackUpdateConfig}
                disabled={stackUpdateSaving}
                className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {stackUpdateSaving ? 'Saving...' : 'Save config'}
              </button>
              <button
                type="button"
                onClick={handleRunStackUpdate}
                disabled={stackUpdateRunning || !stackUpdate.serverId || !stackUpdate.path}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 disabled:opacity-50"
              >
                {stackUpdateRunning ? 'Updating...' : 'Update Docker Fleet stack'}
              </button>
            </div>
          </div>
          {stackUpdateResult && (
            <div className={`mt-4 rounded-md p-4 text-sm font-mono whitespace-pre-wrap ${stackUpdateResult.success ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'}`}>
              {(stackUpdateResult.stdout || stackUpdateResult.stderr || '').trim() || (stackUpdateResult.success ? 'Done.' : 'Command failed.')}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
        <div className="px-4 py-5 sm:p-6 space-y-6">
          {schema.map((item) => (
            <div key={item.key}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {item.label}
                {item.secret && <span className="text-gray-500 ml-1">(stored in DB)</span>}
              </label>
              <div className="mt-1">{renderField(item)}</div>
            </div>
          ))}
          <div className="pt-2 border-t border-gray-200 dark:border-gray-600">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Send a test message using the current SMTP settings (sends to your user email).</p>
            <button
              type="button"
              onClick={handleTestEmail}
              disabled={testEmailLoading}
              className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              {testEmailLoading ? 'Sending...' : 'Test email'}
            </button>
            {testEmailMessage && (
              <span className="ml-3 text-sm text-gray-600 dark:text-gray-400">{testEmailMessage}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppConfig;
