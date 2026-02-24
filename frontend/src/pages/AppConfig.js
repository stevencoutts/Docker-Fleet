import React, { useState, useEffect } from 'react';
import { appConfigService } from '../services/appConfig.service';

const AppConfig = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [schema, setSchema] = useState([]);
  const [saved, setSaved] = useState({});
  const [note, setNote] = useState('');
  const [form, setForm] = useState({});

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await appConfigService.get();
      setSchema(res.data.schema || []);
      setSaved(res.data.saved || {});
      setNote(res.data.note || '');
      setForm(res.data.saved || {});
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load app configuration');
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
      await appConfigService.put(form);
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDownloadEnv}
            className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
          >
            Download .env
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
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 p-4">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-md bg-green-50 dark:bg-green-900/20 p-4">
          <p className="text-sm text-green-800 dark:text-green-200">{success}</p>
        </div>
      )}

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
        </div>
      </div>
    </div>
  );
};

export default AppConfig;
