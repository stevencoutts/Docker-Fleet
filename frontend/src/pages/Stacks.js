import React, { useEffect, useState, useCallback } from 'react';
import { stacksService } from '../services/stacks.service';

export default function Stacks() {
  const [stacks, setStacks] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await stacksService.list();
      setStacks(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (id, fn) => {
    setBusy(id);
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Stacks</h1>
      {error && <div className="bg-red-100 text-red-800 p-2 rounded mb-3">{error}</div>}
      <table className="w-full text-left">
        <thead>
          <tr className="border-b">
            <th className="p-2">Name</th><th className="p-2">Server</th>
            <th className="p-2">Last status</th><th className="p-2">Last deployed</th><th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {stacks.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="p-2 font-mono">{s.name}</td>
              <td className="p-2">{s.serverId}</td>
              <td className="p-2">{s.lastDeployStatus || '—'}</td>
              <td className="p-2">{s.lastDeployedAt ? new Date(s.lastDeployedAt).toLocaleString() : '—'}</td>
              <td className="p-2 space-x-2">
                <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.deploy(s.id, false))} className="text-blue-600">Deploy</button>
                <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.deploy(s.id, true))} className="text-blue-600">Pull+Deploy</button>
                <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.restart(s.id))} className="text-amber-600">Restart</button>
                <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.down(s.id))} className="text-red-600">Down</button>
              </td>
            </tr>
          ))}
          {!stacks.length && <tr><td className="p-2" colSpan={5}>No managed stacks yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
