import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { serversService } from '../services/servers.service';
import { containersService } from '../services/containers.service';
import { systemService } from '../services/system.service';

const Dashboard = () => {
  const [servers, setServers] = useState([]);
  const [containers, setContainers] = useState({});
  const [hostInfos, setHostInfos] = useState({}); // Store hostname info for each server
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    
    // Auto-refresh every 5 seconds to detect container state changes
    const refreshInterval = setInterval(() => {
      fetchData();
    }, 5000);
    
    return () => {
      clearInterval(refreshInterval);
    };
  }, []);

  const fetchData = async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      
      const serversResponse = await serversService.getAll();
      const serversData = serversResponse.data.servers;
      setServers(serversData);

      // Fetch containers and host info for each server in parallel for better performance
      const serverPromises = serversData.map(async (server) => {
        try {
          const [containersResponse, hostInfoResponse] = await Promise.all([
            containersService.getAll(server.id, { all: 'true' }).catch(() => ({ data: { containers: [] } })),
            systemService.getHostInfo(server.id).catch(() => ({ data: { hostInfo: null } })),
          ]);
          return {
            serverId: server.id,
            containers: containersResponse.data.containers || [],
            hostInfo: hostInfoResponse.data.hostInfo || null,
          };
        } catch (error) {
          console.error(`Failed to fetch data for server ${server.id}:`, error);
          return { serverId: server.id, containers: [], hostInfo: null };
        }
      });
      
      const serverResults = await Promise.all(serverPromises);
      const containersData = {};
      const hostInfosData = {};
      serverResults.forEach(({ serverId, containers: serverContainers, hostInfo }) => {
        containersData[serverId] = serverContainers;
        if (hostInfo) {
          hostInfosData[serverId] = hostInfo;
        }
      });
      
      setContainers(containersData);
      setHostInfos(hostInfosData);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  // Helper function to check if container is running
  const isContainerRunning = (container) => {
    const status = container.Status || container['.Status'] || '';
    return status.toLowerCase().includes('up') || 
           status.toLowerCase().includes('running') ||
           status.toLowerCase().startsWith('up');
  };

  // Helper function to get container name
  const getContainerName = (container) => {
    let name = container.Names || container['.Names'] || container.name || '';
    if (name) {
      name = name.replace(/^\//, ''); // Remove leading slash
    }
    if (!name || name === container.ID) {
      name = (container.ID || '').substring(0, 12) || 'Unnamed';
    }
    return name;
  };

  // Calculate totals and identify issues
  const totalServers = servers.length;
  const totalContainers = Object.values(containers).reduce((sum, serverContainers) => sum + serverContainers.length, 0);
  const totalRunning = Object.values(containers).reduce((sum, serverContainers) => {
    return sum + serverContainers.filter(isContainerRunning).length;
  }, 0);
  const totalStopped = totalContainers - totalRunning;

  // Find containers that should be running but aren't
  const containersThatShouldBeRunning = [];
  Object.entries(containers).forEach(([serverId, serverContainers]) => {
    const server = servers.find(s => s.id === serverId);
    serverContainers.forEach(container => {
      const restartPolicy = container.RestartPolicy || container.restartPolicy || 'no';
      const hasAutoRestart = restartPolicy !== 'no' && restartPolicy !== '';
      const isRunning = isContainerRunning(container);
      
      if (hasAutoRestart && !isRunning) {
        containersThatShouldBeRunning.push({
          ...container,
          serverId,
          serverName: server?.name || 'Unknown',
          serverHost: server?.host || 'Unknown',
          containerName: getContainerName(container),
        });
      }
    });
  });

  // Calculate issues count
  const issuesCount = containersThatShouldBeRunning.length;

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Overview of all servers and containers</p>
        </div>
        <Link
          to="/servers/new"
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 transition-colors shadow-sm"
        >
          <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Server
        </Link>
      </div>

      {/* Alerts Section */}
      {issuesCount > 0 && (
        <div className="mb-6 bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 dark:border-yellow-500 p-4 rounded-r-lg">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400 dark:text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                {issuesCount} Container{issuesCount !== 1 ? 's' : ''} Should Be Running
              </h3>
              <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                <p>The following containers have auto-restart enabled but are currently stopped:</p>
                <ul className="mt-2 list-disc list-inside space-y-1">
                  {containersThatShouldBeRunning.slice(0, 5).map((container, idx) => (
                    <li key={idx}>
                      <Link 
                        to={`/servers/${container.serverId}/containers/${container.ID}`}
                        className="font-medium hover:underline"
                      >
                        {container.containerName}
                      </Link>
                      {' '}on {container.serverName} ({container.serverHost})
                    </li>
                  ))}
                  {containersThatShouldBeRunning.length > 5 && (
                    <li className="text-yellow-600 dark:text-yellow-400">
                      ...and {containersThatShouldBeRunning.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {servers.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <div className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg transition-colors">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-blue-500 rounded-md p-3">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                  </svg>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Servers</dt>
                    <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">{totalServers}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg transition-colors">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-green-500 rounded-md p-3">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Running</dt>
                    <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">{totalRunning}</dd>
                    <dd className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {totalContainers > 0 ? `${Math.round((totalRunning / totalContainers) * 100)}% of total` : '0%'}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg transition-colors">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-red-500 rounded-md p-3">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Stopped</dt>
                    <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">{totalStopped}</dd>
                    <dd className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {totalContainers > 0 ? `${Math.round((totalStopped / totalContainers) * 100)}% of total` : '0%'}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className={`bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg transition-colors ${
            issuesCount > 0 ? 'ring-2 ring-yellow-400 dark:ring-yellow-500' : ''
          }`}>
            <div className="p-5">
              <div className="flex items-center">
                <div className={`flex-shrink-0 rounded-md p-3 ${
                  issuesCount > 0 ? 'bg-yellow-500' : 'bg-gray-500'
                }`}>
                  {issuesCount > 0 ? (
                    <svg className="h-6 w-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                      {issuesCount > 0 ? 'Issues Found' : 'All Healthy'}
                    </dt>
                    <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {issuesCount > 0 ? issuesCount : '0'}
                    </dd>
                    <dd className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {issuesCount > 0 
                        ? 'Auto-start containers stopped' 
                        : 'No issues detected'}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {servers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400 mb-4">No servers configured</p>
          <Link
            to="/servers/new"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600 transition-colors"
          >
            Add Server
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => {
            const serverContainers = containers[server.id] || [];
            const runningCount = serverContainers.filter(isContainerRunning).length;
            const stoppedCount = serverContainers.length - runningCount;
            const serverIssues = containersThatShouldBeRunning.filter(c => c.serverId === server.id).length;
            const serverHealth = serverContainers.length > 0 
              ? Math.round((runningCount / serverContainers.length) * 100) 
              : 100;

            return (
              <Link
                key={server.id}
                to={`/servers/${server.id}`}
                className={`bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1 ${
                  serverIssues > 0 ? 'ring-2 ring-yellow-400 dark:ring-yellow-500' : ''
                }`}
              >
                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900 rounded-lg flex items-center justify-center">
                          <span className="text-primary-600 dark:text-primary-400 font-bold">
                            {server.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <div className="ml-5 w-0 flex-1">
                        <dl>
                          <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                            {server.name}
                          </dt>
                          <dd className="text-lg font-medium text-gray-900 dark:text-gray-100">
                            {hostInfos[server.id]?.hostname && hostInfos[server.id].hostname !== 'Unknown'
                              ? `${hostInfos[server.id].hostname} (${server.host})`
                              : server.host}
                          </dd>
                        </dl>
                      </div>
                    </div>
                    {serverIssues > 0 && (
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                          {serverIssues} issue{serverIssues !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Containers</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {runningCount} / {serverContainers.length} running
                      </span>
                    </div>
                    {serverContainers.length > 0 && (
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all ${
                            serverHealth >= 90 ? 'bg-green-500' :
                            serverHealth >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${serverHealth}%` }}
                        ></div>
                      </div>
                    )}
                    {stoppedCount > 0 && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {stoppedCount} stopped
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
