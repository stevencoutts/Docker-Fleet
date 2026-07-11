import React, { useEffect, useState, useCallback } from 'react';
import { stacksService } from '../services/stacks.service';
import { serversService } from '../services/servers.service';
import StackEditor from '../components/StackEditor';
import StackImportModal from '../components/StackImportModal';
import ServerPicker from '../components/ServerPicker';

const statusBadge = (status) => {
  if (!status) return <span className="text-sm text-gray-400 dark:text-gray-500">—</span>;
  const styles = {
    deployed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    stopped: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  const cls = styles[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
};

export default function Stacks() {
  const [stacks, setStacks] = useState([]);
  const [servers, setServers] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(undefined);
  const [importServer, setImportServer] = useState(null);
  const [importServerId, setImportServerId] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await stacksService.list();
      setStacks(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    serversService.getAll().then(({ data }) => setServers(data.servers || [])).catch(() => {});
  }, []);

  const serverLabel = (id) => {
    const s = servers.find((x) => x.id === id);
    return s ? `${s.name} (${s.host})` : id;
  };

  const act = async (id, fn) => {
    setBusy(id);
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(null); }
  };

  const actionBtn = 'text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Stacks</h1>
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => { e.preventDefault(); if (importServerId) setImportServer(importServerId); }}
            className="flex items-center gap-2"
          >
            <ServerPicker value={importServerId} onChange={setImportServerId} className="w-56" />
            <button
              type="submit"
              disabled={!importServerId}
              className="px-3 py-1.5 text-sm font-medium text-white bg-gray-600 dark:bg-gray-500 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              Import from server
            </button>
          </form>
          <button
            onClick={() => setEditing(null)}
            className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 dark:bg-primary-500 rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors"
          >
            New stack
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 p-3">
          <div className="text-sm text-red-800 dark:text-red-200">{error}</div>
        </div>
      )}
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Server</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Last status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Last deployed</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {stacks.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-sm text-gray-900 dark:text-gray-100">{s.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{serverLabel(s.serverId)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{statusBadge(s.lastDeployStatus)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{s.lastDeployedAt ? new Date(s.lastDeployedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap space-x-3">
                    <button disabled={busy === s.id} onClick={async () => { try { const { data } = await stacksService.get(s.id); setEditing(data); } catch (e) { setError(e.response?.data?.error || e.message); } }} className={`${actionBtn} text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100`}>Edit</button>
                    <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.deploy(s.id, false))} className={`${actionBtn} text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300`}>Deploy</button>
                    <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.deploy(s.id, true))} className={`${actionBtn} text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300`}>Pull+Deploy</button>
                    <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.restart(s.id))} className={`${actionBtn} text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300`}>Restart</button>
                    <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.down(s.id))} className={`${actionBtn} text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300`}>Down</button>
                  </td>
                </tr>
              ))}
              {!stacks.length && (
                <tr>
                  <td className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400" colSpan={5}>No managed stacks yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {editing !== undefined && (
        <StackEditor
          stack={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); load(); }}
        />
      )}
      {importServer && (
        <StackImportModal
          serverId={importServer}
          onClose={() => setImportServer(null)}
          onImported={() => { setImportServer(null); setImportServerId(''); load(); }}
        />
      )}
    </div>
  );
}
