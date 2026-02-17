import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { serversService } from '../services/servers.service';
import { containersService } from '../services/containers.service';
import { systemService } from '../services/system.service';

const ServerDetails = () => {
  const { serverId } = useParams();
  const [server, setServer] = useState(null);
  const [containers, setContainers] = useState([]);
  const [hostInfo, setHostInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, showAll]);

  const fetchData = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      else setRefreshing(true);

      const [serverResponse, containersResponse, hostInfoResponse] = await Promise.all([
        serversService.getById(serverId),
        containersService.getAll(serverId, { all: showAll ? 'true' : 'false' }),
        systemService.getHostInfo(serverId).catch((error) => {
          console.error('Failed to fetch host info:', error);
          return { data: { hostInfo: null } };
        }),
      ]);

      setServer(serverResponse.data.server);
      
      // Parse containers properly
      const parsedContainers = (containersResponse.data.containers || []).map(container => {
        // Handle both JSON string and object formats
        if (typeof container === 'string') {
          try {
            return JSON.parse(container);
          } catch (e) {
            return { ID: container };
          }
        }
        return container;
      });
      
      setContainers(parsedContainers);
      setHostInfo(hostInfoResponse.data.hostInfo);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
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
        fetchData(false); // Refresh without showing loading
      } else {
        alert(response.data.message || 'Action failed');
      }
    } catch (error) {
      alert(error.response?.data?.error || 'Action failed');
    }
  };

  // Filter containers based on search term
  const filteredContainers = containers.filter(container => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    const name = (container.Names || container['.Names'] || container.ID || '').toLowerCase();
    const image = (container.Image || container['.Image'] || '').toLowerCase();
    const id = (container.ID || container.Id || container['.ID'] || '').toLowerCase();
    return name.includes(search) || image.includes(search) || id.includes(search);
  });

  // Calculate stats with better parsing
  const stats = {
    total: containers.length,
    running: containers.filter(c => {
      const containerData = typeof c === 'string' ? (() => { try { return JSON.parse(c); } catch { return { Status: '' }; } })() : c;
      const status = (containerData.Status || containerData['.Status'] || containerData.status || '').toLowerCase();
      return status.includes('up') || status.includes('running') || status.startsWith('up');
    }).length,
    stopped: containers.filter(c => {
      const containerData = typeof c === 'string' ? (() => { try { return JSON.parse(c); } catch { return { Status: '' }; } })() : c;
      const status = (containerData.Status || containerData['.Status'] || containerData.status || '').toLowerCase();
      return !status.includes('up') && !status.includes('running') && !status.startsWith('up');
    }).length,
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
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{server.name}</h1>
            <p className="mt-1 text-sm text-gray-600">{server.host}:{server.port}</p>
          </div>
          <button
            onClick={() => fetchData(false)}
            disabled={refreshing}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
          >
            <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 14M20 20v-5h-.582m-15.356 2a8.001 8.001 0 0015.356-2m0 0V9M20 4v5" />
            </svg>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Host Information */}
      {hostInfo && !hostInfo.error && (
        <div className="mb-6 bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Host Information</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Hostname</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.hostname || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Architecture</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.architecture || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">OS</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.os || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Kernel</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.kernel || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">CPU Model</dt>
              <dd className="mt-1 text-sm text-gray-900 truncate" title={hostInfo.cpuModel || 'Unknown'}>
                {hostInfo.cpuModel || 'Unknown'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">CPU Cores</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.cpuCores || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">CPU Usage</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.cpuUsage || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Load Average</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.loadAverage || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Total Memory</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.totalMemory || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Used Memory</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.usedMemory || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Available Memory</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.availableMemory || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Disk Usage</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.diskUsage || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Uptime</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.uptime || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Docker Version</dt>
              <dd className="mt-1 text-sm text-gray-900">{hostInfo.dockerVersion || 'Unknown'}</dd>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-blue-500 rounded-md p-3">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Containers</dt>
                  <dd className="text-lg font-semibold text-gray-900">{stats.total}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-green-500 rounded-md p-3">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Running</dt>
                  <dd className="text-lg font-semibold text-gray-900">{stats.running}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-gray-500 rounded-md p-3">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Stopped</dt>
                  <dd className="text-lg font-semibold text-gray-900">{stats.stopped}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Actions */}
      <div className="mb-4 bg-white p-4 rounded-lg shadow">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4 flex-1">
            <div className="flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search containers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
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
            className="text-sm font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            View Images
          </Link>
        </div>
      </div>

      {/* Containers List */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        {filteredContainers.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No containers found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchTerm ? 'Try adjusting your search terms.' : 'No containers are running on this server.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredContainers.map((container) => {
              // Handle different container data formats
              let containerData = container;
              if (typeof container === 'string') {
                try {
                  containerData = JSON.parse(container);
                } catch (e) {
                  containerData = { ID: container };
                }
              }
              
              const status = containerData.Status || containerData['.Status'] || containerData.status || '';
              // More comprehensive status detection
              const isRunning = status.toLowerCase().includes('up') || 
                               status.toLowerCase().includes('running') ||
                               status.toLowerCase().startsWith('up');
              
              const containerId = containerData.ID || containerData.Id || containerData['.ID'] || containerData.id || '';
              // Extract name - remove leading slash if present
              let containerName = containerData.Names || containerData['.Names'] || containerData.name || '';
              if (containerName) {
                containerName = containerName.replace(/^\//, ''); // Remove leading slash
              }
              if (!containerName || containerName === containerId) {
                containerName = containerId.substring(0, 12) || 'Unnamed';
              }
              
              const image = containerData.Image || containerData['.Image'] || containerData.image || 'Unknown';
              const ports = containerData.Ports || containerData['.Ports'] || containerData.ports || '';

              return (
                <div key={containerId} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/servers/${serverId}/containers/${containerId}`}
                        className="text-sm font-semibold text-primary-600 hover:text-primary-700 truncate block"
                        title={containerName}
                      >
                        {containerName.replace(/^\//, '')}
                      </Link>
                      <p className="text-xs text-gray-500 truncate mt-1" title={image}>
                        {image}
                      </p>
                    </div>
                    <span
                      className={`ml-2 px-2 py-1 text-xs font-medium rounded-full flex-shrink-0 ${
                        isRunning
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {isRunning ? 'Running' : 'Stopped'}
                    </span>
                  </div>

                  {ports && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-500 truncate" title={ports}>
                        <span className="font-medium">Ports:</span> {ports || 'None'}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-4">
                    {isRunning ? (
                      <>
                        <button
                          onClick={() => handleContainerAction('stop', containerId)}
                          className="flex-1 px-3 py-1.5 text-xs font-medium text-yellow-800 bg-yellow-50 rounded hover:bg-yellow-100 transition-colors"
                        >
                          Stop
                        </button>
                        <button
                          onClick={() => handleContainerAction('restart', containerId)}
                          className="flex-1 px-3 py-1.5 text-xs font-medium text-blue-800 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                        >
                          Restart
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleContainerAction('start', containerId)}
                        className="flex-1 px-3 py-1.5 text-xs font-medium text-green-800 bg-green-50 rounded hover:bg-green-100 transition-colors"
                      >
                        Start
                      </button>
                    )}
                    <button
                      onClick={() => handleContainerAction('remove', containerId)}
                      className="px-3 py-1.5 text-xs font-medium text-red-800 bg-red-50 rounded hover:bg-red-100 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ServerDetails;
