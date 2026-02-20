import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { serversService } from '../services/servers.service';
import { containersService } from '../services/containers.service';
import { backupSchedulesService } from '../services/backupSchedules.service';
import { useRefetchOnVisible } from '../hooks/useRefetchOnVisible';

function getContainerName(c) {
  // Backend listContainers returns Names as a string (from docker ps --format). Don't use Names[0] or you get first character only.
  let name = '';
  if (typeof c.Names === 'string' && c.Names.trim()) {
    name = c.Names.trim().replace(/^\//, '');
  } else if (Array.isArray(c.Names) && c.Names[0]) {
    name = String(c.Names[0]).replace(/^\//, '');
  } else if (c.Name || c.name) {
    name = String(c.Name || c.name).replace(/^\//, '');
  }
  return name || (c.ID || c.Id || '').substring(0, 12) || 'unknown';
}

const BulkBackupSchedules = () => {
  const [servers, setServers] = useState([]);
  const [selectedServerIds, setSelectedServerIds] = useState(new Set());
  const [containersByServer, setContainersByServer] = useState({});
  const [loadingContainers, setLoadingContainers] = useState(new Set());
  const [selectedTargets, setSelectedTargets] = useState(new Set()); // 'serverId|containerName'
  const [scheduleForm, setScheduleForm] = useState({
    scheduleType: 'interval',
    scheduleConfig: { intervalHours: 24 },
    retention: 5,
    enabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [existingJobs, setExistingJobs] = useState([]);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await serversService.getAll();
        if (!cancelled) setServers(res.data.servers || res.data || []);
      } catch (e) {
        if (!cancelled) setServers([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchContainers = useCallback(async (serverId) => {
    setLoadingContainers((prev) => new Set(prev).add(serverId));
    try {
      const res = await containersService.getAll(serverId, { all: 'true' });
      const list = res.data.containers || [];
      setContainersByServer((prev) => ({ ...prev, [serverId]: list }));
    } catch {
      setContainersByServer((prev) => ({ ...prev, [serverId]: [] }));
    } finally {
      setLoadingContainers((prev) => {
        const next = new Set(prev);
        next.delete(serverId);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    selectedServerIds.forEach((serverId) => {
      if (!containersByServer[serverId] && !loadingContainers.has(serverId)) {
        fetchContainers(serverId);
      }
    });
  }, [selectedServerIds, containersByServer, loadingContainers, fetchContainers]);

  const toggleServer = (serverId) => {
    setSelectedServerIds((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
        setSelectedTargets((t) => {
          const t2 = new Set(t);
          t2.forEach((key) => {
            if (key.startsWith(serverId + '|')) t2.delete(key);
          });
          return t2;
        });
      } else {
        next.add(serverId);
      }
      return next;
    });
  };

  const toggleTarget = (serverId, containerName) => {
    const key = `${serverId}|${containerName}`;
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllOnServer = (serverId) => {
    const list = containersByServer[serverId] || [];
    const names = list.map((c) => getContainerName(c));
    const keySet = new Set(names.map((n) => `${serverId}|${n}`));
    const allSelected = names.length > 0 && names.every((n) => selectedTargets.has(`${serverId}|${n}`));
    setSelectedTargets((prev) => {
      if (allSelected) {
        return new Set([...prev].filter((key) => !key.startsWith(serverId + '|')));
      }
      return new Set([...prev, ...keySet]);
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (selectedTargets.size === 0) {
      alert('Select at least one container.');
      return;
    }
    const targets = Array.from(selectedTargets).map((key) => {
      const [serverId, containerName] = key.split('|');
      return { serverId, containerName };
    });
    setSaving(true);
    try {
      await backupSchedulesService.createBulk({
        targets,
        scheduleType: scheduleForm.scheduleType,
        scheduleConfig: scheduleForm.scheduleConfig,
        retention: scheduleForm.retention,
        enabled: scheduleForm.enabled,
      });
      setSelectedTargets(new Set());
      const res = await backupSchedulesService.getAll();
      setExistingJobs(res.data.jobs || []);
      alert(`Created 1 backup job with ${targets.length} container(s).`);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to create schedules');
    } finally {
      setSaving(false);
    }
  };

  const fetchJobs = useCallback(() => {
    setLoadingExisting(true);
    backupSchedulesService.getAll()
      .then((res) => setExistingJobs(res.data.jobs || []))
      .catch(() => setExistingJobs([]))
      .finally(() => setLoadingExisting(false));
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useRefetchOnVisible(fetchJobs);

  const handleDeleteJob = async (job) => {
    if (!window.confirm(`Delete this backup job? It will stop scheduled backups for ${(job.entries || []).length} container(s). Snapshots already created are not removed.`)) return;
    setDeletingJobId(job.id);
    try {
      await backupSchedulesService.deleteJob(job.id);
      await fetchJobs();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to delete job');
    } finally {
      setDeletingJobId(null);
    }
  };

  const formatDate = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString();
    } catch {
      return '—';
    }
  };

  const scheduleSummary = (job) => {
    const cfg = job.scheduleConfig || {};
    if (job.scheduleType === 'interval') return `Every ${cfg.intervalHours ?? 24}h`;
    if (job.scheduleType === 'daily') return `Daily ${String(cfg.hour ?? 2).padStart(2, '0')}:${String(cfg.minute ?? 0).padStart(2, '0')} UTC`;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${days[cfg.dayOfWeek ?? 0]} ${String(cfg.hour ?? 2).padStart(2, '0')}:${String(cfg.minute ?? 0).padStart(2, '0')} UTC`;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Scheduled backups</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Create snapshot schedules for multiple containers across servers at once, or manage existing schedules.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
          You can also add or edit a schedule for a single container: open a server → open a container → <strong>Scheduled backups</strong> tab.
        </p>
      </div>

      {/* Existing jobs (one job = one schedule, many containers) */}
      <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          Existing backup jobs
        </h2>
        <div className="p-6 space-y-6">
          {loadingExisting ? (
            <p className="text-gray-500 dark:text-gray-400">Loading…</p>
          ) : existingJobs.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No backup jobs yet. Create one below.</p>
          ) : (
            existingJobs.map((job) => (
              <div key={job.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{scheduleSummary(job)}</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">Keep last {job.retention} · Next run {formatDate(job.nextRunAt)}</span>
                    {job.name && <span className="text-sm text-gray-500 dark:text-gray-400">({job.name})</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteJob(job)}
                    disabled={deletingJobId === job.id}
                    className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50"
                  >
                    {deletingJobId === job.id ? 'Deleting…' : 'Delete job'}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead>
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Server</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Container</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {(job.entries || []).map((entry) => (
                        <tr key={entry.id}>
                          <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">
                            {entry.server ? (entry.server.name || entry.server.host) : entry.serverId}
                          </td>
                          <td className="px-4 py-2 text-sm font-mono text-gray-700 dark:text-gray-300">{entry.containerName}</td>
                          <td className="px-4 py-2 text-sm">
                            <Link
                              to={`/servers/${entry.serverId}`}
                              className="text-primary-600 dark:text-primary-400 hover:underline"
                            >
                              Open server
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Bulk create */}
      <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          Create schedules in bulk
        </h2>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Servers</label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Select servers; then choose containers per server.</p>
            <div className="flex flex-wrap gap-3">
              {servers.map((s) => (
                <label key={s.id} className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedServerIds.has(s.id)}
                    onChange={() => toggleServer(s.id)}
                    className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-900 dark:text-gray-100">{s.name || s.host}</span>
                </label>
              ))}
              {servers.length === 0 && <span className="text-sm text-gray-500">No servers. Add a server first.</span>}
            </div>
          </div>

          {selectedServerIds.size > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Containers</label>
              <div className="space-y-4 max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                {Array.from(selectedServerIds).map((serverId) => {
                  const server = servers.find((s) => s.id === serverId);
                  const list = containersByServer[serverId];
                  const loading = loadingContainers.has(serverId);
                  const allSelected = list && list.length > 0 && list.every((c) => selectedTargets.has(`${serverId}|${getContainerName(c)}`));
                  const selectAllLabel = list && list.length > 0 ? (allSelected ? 'Deselect all' : 'Select all') : null;
                  return (
                    <div key={serverId}>
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          type="button"
                          onClick={() => toggleAllOnServer(serverId)}
                          className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          {selectAllLabel}
                        </button>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {server?.name || server?.host || serverId}
                        </span>
                        {loading && <span className="text-xs text-gray-500">Loading…</span>}
                      </div>
                      {loading && <p className="text-sm text-gray-500">Loading containers…</p>}
                      {!loading && list && (
                        <ul className="list-none space-y-1 pl-4">
                          {list.map((c) => {
                            const name = getContainerName(c);
                            const key = `${serverId}|${name}`;
                            const checked = selectedTargets.has(key);
                            return (
                              <li key={key}>
                                <label className="inline-flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleTarget(serverId, name)}
                                    className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                                  />
                                  <span className="text-sm font-mono text-gray-800 dark:text-gray-200">{name}</span>
                                </label>
                              </li>
                            );
                          })}
                          {list.length === 0 && <li className="text-sm text-gray-500">No containers</li>}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Selected: {selectedTargets.size} container(s)
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Schedule type</label>
              <select
                value={scheduleForm.scheduleType}
                onChange={(e) => {
                  const t = e.target.value;
                  setScheduleForm((f) => ({
                    ...f,
                    scheduleType: t,
                    scheduleConfig: t === 'interval' ? { intervalHours: 24 } : t === 'daily' ? { hour: 2, minute: 0 } : { dayOfWeek: 0, hour: 2, minute: 0 },
                  }));
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="interval">Every N hours</option>
                <option value="daily">Daily at a set time (UTC)</option>
                <option value="weekly">Weekly (day + time UTC)</option>
              </select>
            </div>
            {scheduleForm.scheduleType === 'interval' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Interval (hours)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={scheduleForm.scheduleConfig.intervalHours ?? 24}
                  onChange={(e) => setScheduleForm((f) => ({
                    ...f,
                    scheduleConfig: { ...f.scheduleConfig, intervalHours: Math.max(1, parseInt(e.target.value, 10) || 24) },
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            )}
            {scheduleForm.scheduleType === 'daily' && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Hour (UTC)</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={scheduleForm.scheduleConfig.hour ?? 2}
                    onChange={(e) => setScheduleForm((f) => ({
                      ...f,
                      scheduleConfig: { ...f.scheduleConfig, hour: Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)) },
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Minute</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={scheduleForm.scheduleConfig.minute ?? 0}
                    onChange={(e) => setScheduleForm((f) => ({
                      ...f,
                      scheduleConfig: { ...f.scheduleConfig, minute: Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)) },
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>
            )}
            {scheduleForm.scheduleType === 'weekly' && (
              <div className="md:col-span-2 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Day of week (UTC)</label>
                  <select
                    value={scheduleForm.scheduleConfig.dayOfWeek ?? 0}
                    onChange={(e) => setScheduleForm((f) => ({
                      ...f,
                      scheduleConfig: { ...f.scheduleConfig, dayOfWeek: parseInt(e.target.value, 10) },
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                      <option key={d} value={i}>{d}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Hour (UTC)</label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={scheduleForm.scheduleConfig.hour ?? 2}
                      onChange={(e) => setScheduleForm((f) => ({
                        ...f,
                        scheduleConfig: { ...f.scheduleConfig, hour: Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)) },
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Minute</label>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={scheduleForm.scheduleConfig.minute ?? 0}
                      onChange={(e) => setScheduleForm((f) => ({
                        ...f,
                        scheduleConfig: { ...f.scheduleConfig, minute: Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)) },
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Keep last N snapshots</label>
              <input
                type="number"
                min={1}
                max={100}
                value={scheduleForm.retention}
                onChange={(e) => setScheduleForm((f) => ({ ...f, retention: Math.max(1, parseInt(e.target.value, 10) || 5) }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="bulkEnabled"
                checked={scheduleForm.enabled}
                onChange={(e) => setScheduleForm((f) => ({ ...f, enabled: e.target.checked }))}
                className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="bulkEnabled" className="ml-2 text-sm text-gray-700 dark:text-gray-300">Schedule enabled</label>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={saving || selectedTargets.size === 0}
              className="px-4 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {saving ? 'Creating…' : `Create 1 job (${selectedTargets.size} container${selectedTargets.size !== 1 ? 's' : ''})`}
            </button>
            {selectedTargets.size === 0 && (
              <span className="text-sm text-gray-500">Select at least one container above.</span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
};

export default BulkBackupSchedules;
