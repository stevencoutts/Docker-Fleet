import React, { useEffect, useState } from 'react';
import { serversService } from '../services/servers.service';

/**
 * A plain server <select> dropdown (no navigation side effects, unlike
 * ServerSelector). Lists "name (host)" with the server id as the value.
 */
const ServerPicker = ({ value, onChange, includePlaceholder = true, className = '' }) => {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await serversService.getAll();
        if (active) setServers(data.servers || []);
      } catch {
        if (active) setServers([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const base =
    'px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={loading}
      className={`${base} ${className}`}
    >
      {includePlaceholder && (
        <option value="">{loading ? 'Loading servers…' : 'Select a server'}</option>
      )}
      {servers.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({s.host})
        </option>
      ))}
    </select>
  );
};

export default ServerPicker;
