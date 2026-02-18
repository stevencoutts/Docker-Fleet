import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { serversService } from '../services/servers.service';
import { containersService } from '../services/containers.service';
import { systemService } from '../services/system.service';
import { useSocket } from '../context/SocketContext';

const Dashboard = () => {
  const [servers, setServers] = useState([]);
  const [containers, setContainers] = useState({});
  const [hostInfos, setHostInfos] = useState({}); // Store hostname info for each server
  const [loading, setLoading] = useState(true);
  const [loadingServers, setLoadingServers] = useState(new Set()); // Track which servers are loading
  const [restarting, setRestarting] = useState(false);
  const [containersVersion, setContainersVersion] = useState(0); // Version counter to trigger recalculation only when stable data updates
  const socket = useSocket();
  const refreshTimeoutRef = useRef(null);
  const isRefreshingRef = useRef(false); // Track if we're currently refreshing to prevent flicker
  const stableContainersRef = useRef({}); // Store stable container data that only updates when complete

  useEffect(() => {
    fetchData(true);
    
    // Auto-refresh every 5 seconds to detect container state changes (increased from 3s to reduce flicker)
    const refreshInterval = setInterval(() => {
      // Only refresh if not already refreshing
      if (!isRefreshingRef.current) {
        fetchData(false);
      }
    }, 5000);
    
    // Listen for container status changes via WebSocket
    if (socket) {
      const handleContainerStatusChange = () => {
        // Debounce rapid status changes - refresh immediately but only once per batch
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }
        refreshTimeoutRef.current = setTimeout(() => {
          // Only refresh if not already refreshing
          if (!isRefreshingRef.current) {
            fetchData(false);
          }
        }, 500); // Increased debounce time
      };

      // Listen for container status change events
      socket.on('container:status:changed', handleContainerStatusChange);

      return () => {
        socket.off('container:status:changed', handleContainerStatusChange);
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }
      };
    }
    
    return () => {
      clearInterval(refreshInterval);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [socket]);

  const fetchData = async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      
      // First, fetch servers quickly to show the page immediately
      const serversResponse = await serversService.getAll();
      const serversData = serversResponse.data.servers;
      setServers(serversData);
      
      // Show the page immediately with server data (containers will load progressively)
      if (showLoading) {
        setLoading(false);
      }

      // Fetch containers for each server in parallel
      // Keep previous container data visible while loading new data to prevent flickering
      const containerPromises = serversData.map(async (server) => {
        setLoadingServers(prev => new Set(prev).add(server.id));
        try {
          const containersResponse = await containersService.getAll(server.id, { all: 'true' }).catch(() => ({ data: { containers: [] } }));
          return {
            serverId: server.id,
            containers: containersResponse.data.containers || [],
          };
        } catch (error) {
          console.error(`Failed to fetch containers for server ${server.id}:`, error);
          // On error, return null to indicate we should keep previous data
          return { serverId: server.id, containers: null };
        } finally {
          setLoadingServers(prev => {
            const next = new Set(prev);
            next.delete(server.id);
            return next;
          });
        }
      });
      
      // Wait for all containers to load, then update state once to prevent flickering
      const containerResults = await Promise.all(containerPromises);
      
      // Build new containers object, preserving previous data for servers that failed
      // Always start from the stable ref to ensure we preserve displayed data
      const currentStable = stableContainersRef.current || {};
      const newContainers = { ...currentStable }; // Start with stable previous data
      
      containerResults.forEach(({ serverId, containers: serverContainers }) => {
        if (serverContainers !== null) {
          // Only update if we got new data (not null from error)
          newContainers[serverId] = serverContainers;
        }
        // If serverContainers is null, keep previous data (already preserved in spread above)
      });
      
      // Update stable ref FIRST (before state update) - this is what calculations use
      stableContainersRef.current = newContainers;
      
      // Increment version counter to trigger recalculation (only when stable data actually changes)
      setContainersVersion(prev => prev + 1);
      
      // Then update state (for display purposes, but calculations use stable ref)
      setContainers(newContainers);

      // Fetch host info separately and lazily (non-blocking, can fail silently)
      // This is less critical data, so we load it after containers and don't block the UI
      // Load host info in the background without blocking
      serversData.forEach(async (server) => {
        try {
          const hostInfoResponse = await systemService.getHostInfo(server.id).catch(() => ({ data: { hostInfo: null } }));
          if (hostInfoResponse.data.hostInfo) {
            setHostInfos(prev => ({
              ...prev,
              [server.id]: hostInfoResponse.data.hostInfo,
            }));
          }
        } catch (error) {
          // Silently fail for host info - it's not critical
        }
      });
    } catch (error) {
      console.error('Failed to fetch data:', error);
      if (showLoading) {
        setLoading(false);
      }
    } finally {
      isRefreshingRef.current = false;
    }
  };

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
  // Use stable containers ref for calculations to prevent flickering during updates
  const totalServers = servers.length;
  
  // Calculate totals from stable ref - only recalculate when version changes (i.e., when stable data updates)
  const totalContainers = useMemo(() => {
    // Always read from stable ref which only updates when we have complete data
    const stableContainers = stableContainersRef.current;
    return Object.values(stableContainers).reduce((sum, serverContainers) => {
      return sum + (Array.isArray(serverContainers) ? serverContainers.length : 0);
    }, 0);
  }, [containersVersion]); // Only recalculate when version increments (stable data updated)
  
  const totalRunning = useMemo(() => {
    // Always read from stable ref which only updates when we have complete data
    const stableContainers = stableContainersRef.current;
    return Object.values(stableContainers).reduce((sum, serverContainers) => {
      if (!Array.isArray(serverContainers)) return sum;
      return sum + serverContainers.filter(isContainerRunning).length;
    }, 0);
  }, [containersVersion]); // Only recalculate when version increments (stable data updated)
  
  const totalStopped = useMemo(() => totalContainers - totalRunning, [totalContainers, totalRunning]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  // Find containers that should be running but aren't
  // Use stable containers ref to prevent flickering
  const containersThatShouldBeRunning = [];
  // Find containers running without auto-restart
  const containersWithoutAutoRestart = [];
  Object.entries(stableContainersRef.current).forEach(([serverId, serverContainers]) => {
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
      } else if (!hasAutoRestart && isRunning) {
        containersWithoutAutoRestart.push({
          ...container,
          serverId,
          serverName: server?.name || 'Unknown',
          serverHost: server?.host || 'Unknown',
          containerName: getContainerName(container),
        });
      }
    });
  });

  // Calculate issues count (both types)
  const issuesCount = containersThatShouldBeRunning.length + containersWithoutAutoRestart.length;

  // Find the first server with issues for navigation
  const getFirstServerWithIssues = () => {
    // Check for stopped containers first
    if (containersThatShouldBeRunning.length > 0) {
      return containersThatShouldBeRunning[0].serverId;
    }
    // Then check for containers without auto-restart
    if (containersWithoutAutoRestart.length > 0) {
      return containersWithoutAutoRestart[0].serverId;
    }
    return null;
  };

  const firstServerWithIssues = getFirstServerWithIssues();

  // Restart all stopped containers that should be running
  const handleRestartStopped = async () => {
    if (containersThatShouldBeRunning.length === 0) return;

    setRestarting(true);
    const results = { success: 0, failed: 0, errors: [] };

    try {
      // Restart all containers in parallel
      const restartPromises = containersThatShouldBeRunning.map(async (container) => {
        try {
          await containersService.start(container.serverId, container.ID);
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            container: container.containerName,
            error: error.response?.data?.error || error.message || 'Unknown error',
          });
        }
      });

      await Promise.all(restartPromises);

      // Show results
      if (results.failed === 0) {
        alert(`Successfully started ${results.success} container${results.success !== 1 ? 's' : ''}`);
      } else {
        const errorMsg = results.errors.map(e => `${e.container}: ${e.error}`).join('\n');
        alert(`Started ${results.success} container${results.success !== 1 ? 's' : ''}, failed ${results.failed}:\n${errorMsg}`);
      }

      // Refresh data after a short delay to see updated status
      setTimeout(() => {
        fetchData(false);
      }, 1000);
    } catch (error) {
      alert('Failed to restart containers: ' + (error.message || 'Unknown error'));
    } finally {
      setRestarting(false);
    }
  };

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

      {/* Alerts Section - Containers that should be running but are stopped */}
      {containersThatShouldBeRunning.length > 0 && (
        <div className="mb-6 bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 dark:border-yellow-500 p-4 rounded-r-lg">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400 dark:text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  {containersThatShouldBeRunning.length} Container{containersThatShouldBeRunning.length !== 1 ? 's' : ''} Should Be Running
                </h3>
                <button
                  onClick={handleRestartStopped}
                  disabled={restarting}
                  className="ml-4 inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-yellow-600 hover:bg-yellow-700 dark:bg-yellow-500 dark:hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {restarting ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-3 w-3 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Restarting...
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Restart Stopped
                    </>
                  )}
                </button>
              </div>
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

      {/* Alerts Section - Containers running without auto-restart */}
      {containersWithoutAutoRestart.length > 0 && (
        <div className="mb-6 bg-orange-50 dark:bg-orange-900/20 border-l-4 border-orange-400 dark:border-orange-500 p-4 rounded-r-lg">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-orange-400 dark:text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-orange-800 dark:text-orange-200">
                {containersWithoutAutoRestart.length} Container{containersWithoutAutoRestart.length !== 1 ? 's' : ''} Running Without Auto-Restart
              </h3>
              <div className="mt-2 text-sm text-orange-700 dark:text-orange-300">
                <p>The following containers are running but do NOT have auto-restart enabled. They will not automatically restart after a server reboot:</p>
                <ul className="mt-2 list-disc list-inside space-y-1">
                  {containersWithoutAutoRestart.slice(0, 5).map((container, idx) => (
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
                  {containersWithoutAutoRestart.length > 5 && (
                    <li className="text-orange-600 dark:text-orange-400">
                      ...and {containersWithoutAutoRestart.length - 5} more
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

          {issuesCount > 0 && firstServerWithIssues ? (
            <Link
              to={`/servers/${firstServerWithIssues}`}
              className={`bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg transition-all hover:shadow-lg cursor-pointer ring-2 ring-yellow-400 dark:ring-yellow-500`}
            >
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0 rounded-md p-3 bg-yellow-500">
                    <svg className="h-6 w-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                        Issues Found
                      </dt>
                      <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {issuesCount}
                      </dd>
                      <dd className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {containersThatShouldBeRunning.length > 0 && containersWithoutAutoRestart.length > 0
                          ? `${containersThatShouldBeRunning.length} stopped, ${containersWithoutAutoRestart.length} no auto-restart`
                          : containersThatShouldBeRunning.length > 0
                          ? 'Auto-start containers stopped'
                          : 'Containers without auto-restart'}
                      </dd>
                      <dd className="text-xs text-yellow-600 dark:text-yellow-400 mt-1 font-medium">
                        Click to view →
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </Link>
          ) : (
            <div className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg transition-colors">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0 rounded-md p-3 bg-gray-500">
                    <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                        All Healthy
                      </dt>
                      <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">0</dd>
                      <dd className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        No issues detected
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          )}
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
            // Use stable containers ref for display to prevent flickering
            const serverContainers = stableContainersRef.current[server.id] || containers[server.id] || [];
            const isLoadingServer = loadingServers.has(server.id);
            const runningCount = serverContainers.filter(isContainerRunning).length;
            const stoppedCount = serverContainers.length - runningCount;
            const serverIssues = containersThatShouldBeRunning.filter(c => c.serverId === server.id).length +
                                containersWithoutAutoRestart.filter(c => c.serverId === server.id).length;
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
                      {isLoadingServer ? (
                        <span className="text-gray-400 dark:text-gray-500 text-xs">Loading...</span>
                      ) : (
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {runningCount} / {serverContainers.length} running
                        </span>
                      )}
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
