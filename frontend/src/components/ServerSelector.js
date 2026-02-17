import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { serversService } from '../services/servers.service';

const ServerSelector = ({ selectedServerId, onServerChange }) => {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchServers();
  }, []);

  const fetchServers = async () => {
    try {
      const response = await serversService.getAll();
      setServers(response.data.servers);
      if (response.data.servers.length > 0 && !selectedServerId) {
        onServerChange(response.data.servers[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch servers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const serverId = e.target.value;
    onServerChange(serverId);
    navigate(`/servers/${serverId}`);
  };

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Loading servers...</div>;
  }

  return (
    <select
      value={selectedServerId || ''}
      onChange={handleChange}
      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 transition-colors"
    >
      <option value="">Select a server</option>
      {servers.map((server) => (
        <option key={server.id} value={server.id}>
          {server.name} ({server.host})
        </option>
      ))}
    </select>
  );
};

export default ServerSelector;
