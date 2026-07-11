import React, { useEffect, useState } from 'react';
import { stacksService } from '../services/stacks.service';

export default function StackImportModal({ serverId, onClose, onImported }) {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await stacksService.discover(serverId);
        setProjects(data);
      } catch (e) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [serverId]);

  const doImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const chosen = projects.filter((p) => selected[p.name] && !p.managed);
      const { data } = await stacksService.importStacks(
        serverId,
        chosen.map((p) => ({ name: p.name, configFiles: p.configFiles }))
      );
      onImported(data.results);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Import stacks from server</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {error && (
          <div className="bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200 p-3 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 py-4">
            <svg className="animate-spin h-4 w-4 text-primary-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Discovering compose projects…
          </div>
        ) : (
          <table className="w-full text-left mb-4 text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                <th className="p-2 w-8"></th>
                <th className="p-2">Project</th>
                <th className="p-2">Status</th>
                <th className="p-2">State</th>
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-2 text-gray-500 dark:text-gray-400">No compose projects found on this server.</td>
                </tr>
              )}
              {projects.map((p) => (
                <tr key={p.name} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      disabled={p.managed}
                      checked={!!selected[p.name]}
                      onChange={(e) => setSelected((s) => ({ ...s, [p.name]: e.target.checked }))}
                      className="rounded"
                    />
                  </td>
                  <td className="p-2 font-mono text-gray-900 dark:text-gray-100">{p.name}</td>
                  <td className="p-2 text-gray-600 dark:text-gray-400">{p.status || '—'}</td>
                  <td className="p-2">
                    {p.managed ? (
                      <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded-full">managed</span>
                    ) : (
                      <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">unmanaged</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Close
          </button>
          <button
            type="button"
            onClick={doImport}
            disabled={importing || loading}
            className="px-4 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {importing && (
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {importing ? 'Importing…' : 'Import selected'}
          </button>
        </div>
      </div>
    </div>
  );
}
