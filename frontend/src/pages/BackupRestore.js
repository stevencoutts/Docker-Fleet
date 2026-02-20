import React, { useState, useRef } from 'react';
import { backupService } from '../services/backup.service';

const BackupRestore = () => {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const fileInputRef = useRef(null);

  const handleDownloadBackup = async () => {
    setExporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const res = await backupService.export();
      const data = res.data;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.exportedAt
        ? `dockerfleet-backup-${data.exportedAt.slice(0, 10)}.json`
        : 'dockerfleet-backup.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setImportError(e.response?.data?.error || e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await backupService.import(data);
      setImportResult(res.data);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e) {
      if (e.response?.data?.error) {
        setImportError(e.response.data.error);
      } else if (e instanceof SyntaxError) {
        setImportError('Invalid JSON file.');
      } else {
        setImportError(e.message || 'Restore failed');
      }
      setImportResult(null);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Backup &amp; Restore</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Export or restore your DockerFleet config: servers (metadata only; no SSH keys), Public WWW (enabled state, SSH restriction IPs, proxy routes), backup schedules and jobs, monitoring settings, and grouping rules. Restore matches servers by name and host — ensure the same servers exist before restoring.
      </p>

      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Download backup</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Saves a JSON file with all your config (no private keys). Keep it safe.
          </p>
          <button
            type="button"
            disabled={exporting}
            onClick={handleDownloadBackup}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 rounded-lg disabled:opacity-50"
          >
            {exporting ? 'Preparing…' : 'Download backup'}
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Restore from backup</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Upload a backup JSON file. Servers are matched by name and host; Public WWW settings and proxy routes, backup schedules, monitoring, and grouping will be applied to your current account.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            disabled={importing}
            className="block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 dark:file:bg-primary-900/30 dark:file:text-primary-300"
          />
          {importing && <p className="mt-2 text-sm text-gray-500">Restoring…</p>}
          {importError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{importError}</p>
          )}
          {importResult && (
            <div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">{importResult.message}</p>
              <pre className="mt-2 text-xs text-green-700 dark:text-green-300 overflow-auto">
                {JSON.stringify(importResult.restored, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BackupRestore;
