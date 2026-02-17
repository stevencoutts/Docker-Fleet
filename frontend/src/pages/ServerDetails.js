import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { serversService } from '../services/servers.service';
import { containersService } from '../services/containers.service';

const ServerDetails = () => {
  const { serverId } = useParams();
  const [server, setServer] = useState(null);
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetchData();
  }, [serverId, showAll]);

  const fetchData = async () => {
    try {
      const [serverResponse, containersResponse] = await Promise.all([
        serversService.getById(serverId),
        containersService.getAll(serverId, { all: showAll ? 'true' : 'false' }),
      ]);

      setServer(serverResponse.data.server);
      setContainers(containersResponse.data.containers);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleContainerAction = async (action, containerId) => {
    try {
      let response;
      switch (action) {
        case 'start':
          response = await containersService.start(serverId, containerId);
          break;
        case 'stop':
          response = await containersService.stop(serverId, containerId);
          break;
        case 'restart':
          response = await containersService.restart(serverId, containerId);
          break;
        case 'remove':
          if (window.confirm('Are you sure you want to remove this container?')) {
            response = await containersService.remove(serverId, containerId);
          } else {
            return;
          }
          break;
        default:
          return;
      }

      if (response.data.success !== false) {
        fetchData();
      } else {
        alert(response.data.message || 'Action failed');
      }
    } catch (error) {
      alert(error.response?.data?.error || 'Action failed');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Server not found</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{server.name}</h1>
        <p className="mt-1 text-sm text-gray-600">{server.host}:{server.port}</p>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="rounded"
            />
            Show all containers
          </label>
        </div>
        <Link
          to={`/servers/${serverId}/images`}
          className="text-sm text-primary-600 hover:text-primary-700"
        >
          View Images →
        </Link>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {containers.length === 0 ? (
            <li className="px-6 py-4 text-center text-gray-500">No containers found</li>
          ) : (
            containers.map((container) => {
              const isRunning = container.Status?.includes('Up') || container.Status?.includes('running');
              const containerId = container.ID || container.Id || container['.ID'];

              return (
                <li key={containerId} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/servers/${serverId}/containers/${containerId}`}
                        className="text-sm font-medium text-primary-600 hover:text-primary-700"
                      >
                        {container.Names || container['.Names'] || containerId.substring(0, 12)}
                      </Link>
                      <p className="text-sm text-gray-500 truncate">
                        {container.Image || container['.Image']}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {container.Status || container['.Status']}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-1 text-xs rounded ${
                          isRunning
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {isRunning ? 'Running' : 'Stopped'}
                      </span>
                      <div className="flex gap-1">
                        {isRunning ? (
                          <>
                            <button
                              onClick={() => handleContainerAction('stop', containerId)}
                              className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                            >
                              Stop
                            </button>
                            <button
                              onClick={() => handleContainerAction('restart', containerId)}
                              className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                            >
                              Restart
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleContainerAction('start', containerId)}
                            className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200"
                          >
                            Start
                          </button>
                        )}
                        <button
                          onClick={() => handleContainerAction('remove', containerId)}
                          className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
};

export default ServerDetails;
