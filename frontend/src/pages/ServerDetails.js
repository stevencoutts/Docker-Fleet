import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { serversService } from '../services/servers.service';
import { containersService } from '../services/containers.service';
import { systemService } from '../services/system.service';
import groupingService from '../services/grouping.service';
import { useSocket } from '../context/SocketContext';
import { useRefetchOnVisible } from '../hooks/useRefetchOnVisible';
import LogsModal from '../components/LogsModal';
import GroupingModal from '../components/GroupingModal';

const ServerDetails = () => {
  const { serverId } = useParams();
  const navigate = useNavigate();
  const socket = useSocket();
  const [server, setServer] = useState(null);
  const [containers, setContainers] = useState([]);
  const [hostInfo, setHostInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'running', 'stopped'
  const [updatingPolicies, setUpdatingPolicies] = useState(new Set()); // Track containers being updated
  const [logsModal, setLogsModal] = useState({ isOpen: false, containerId: null, containerName: null });
  const [groupingRules, setGroupingRules] = useState([]);
  const [groupContainers, setGroupContainers] = useState(true); // Toggle for grouping
  // Start with "Ungrouped" expanded by default so those containers are visible initially
  const [expandedGroups, setExpandedGroups] = useState(() => new Set(['Ungrouped'])); // Track expanded groups
  const [showGroupingModal, setShowGroupingModal] = useState(false); // Show grouping management modal
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployImage, setDeployImage] = useState('');
  const [deployName, setDeployName] = useState('');
  const [deployPorts, setDeployPorts] = useState('');
  const [deployRestart, setDeployRestart] = useState('unless-stopped');
  const [deployPullFirst, setDeployPullFirst] = useState(true);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployError, setDeployError] = useState('');

  useEffect(() => {
    fetchData();
    fetchGroupingRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, showAll]);

  // Refetch containers when background poller updates this server (from DB)
  useEffect(() => {
    if (!socket || !serverId) return;
    const onUpdate = (payload) => {
      if (payload?.serverId === serverId) fetchData(false);
    };
    socket.on('server:containers:updated', onUpdate);
    socket.on('container:status:changed', onUpdate);
    return () => {
      socket.off('server:containers:updated', onUpdate);
      socket.off('container:status:changed', onUpdate);
    };
  }, [serverId, socket]);

  // Fetch grouping rules
  const fetchGroupingRules = async () => {
    try {
      const response = await groupingService.getAll();
      setGroupingRules(response.data.rules || []);
    } catch (error) {
      console.error('Failed to fetch grouping rules:', error);
    }
  };

  // Refetch when user returns to tab so data is latest when viewed
  useRefetchOnVisible(() => fetchData(false));

  // Host info: load from DB (cache); refetch on socket, visibility, or slow fallback
  useEffect(() => {
    if (!serverId) return;

    const fetchHostInfo = async () => {
      try {
        const res = await systemService.getHostInfo(serverId).catch(() => ({ data: { hostInfo: null } }));
        if (res.data?.hostInfo) setHostInfo(res.data.hostInfo);
      } catch (e) {}
    };

    fetchHostInfo();
    const fallbackMs = 60 * 1000;
    const interval = setInterval(fetchHostInfo, fallbackMs);

    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchHostInfo();
    };
    document.addEventListener('visibilitychange', onVisible);

    if (socket) {
      const onHost = (payload) => {
        if (payload?.serverId === serverId) fetchHostInfo();
      };
      socket.on('server:hostinfo:updated', onHost);
      return () => {
        socket.off('server:hostinfo:updated', onHost);
        clearInterval(interval);
        document.removeEventListener('visibilitychange', onVisible);
      };
    }
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [serverId, socket]);

  const fetchData = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      else setRefreshing(true);

      const [serverResponse, containersResponse] = await Promise.all([
        serversService.getById(serverId),
        containersService.getAll(serverId, { all: showAll ? 'true' : 'false' }),
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
      
      // Host info is now fetched separately in its own effect for live updates
      // No need to fetch here as it's handled by the separate polling effect
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

  // Helper to get container name
  const getContainerName = (container) => {
    let containerData = container;
    if (typeof container === 'string') {
      try {
        containerData = JSON.parse(container);
      } catch (e) {
        containerData = { ID: container };
      }
    }
    let name = containerData.Names || containerData['.Names'] || containerData.name || '';
    if (name) {
      name = name.replace(/^\//, ''); // Remove leading slash
    }
    if (!name) {
      name = (containerData.ID || containerData.Id || containerData['.ID'] || containerData.id || '').substring(0, 12);
    }
    return name;
  };

  // Filter containers based on search term and status
  const filteredContainers = containers.filter(container => {
    // Handle different container data formats
    let containerData = container;
    if (typeof container === 'string') {
      try {
        containerData = JSON.parse(container);
      } catch (e) {
        containerData = { ID: container };
      }
    }
    
    const status = (containerData.Status || containerData['.Status'] || containerData.status || '').toLowerCase();
    const isRunning = status.includes('up') || status.includes('running') || status.startsWith('up');
    
    // Apply status filter
    if (statusFilter === 'running' && !isRunning) return false;
    if (statusFilter === 'stopped' && isRunning) return false;
    
    // Apply search filter
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    const name = (containerData.Names || containerData['.Names'] || containerData.ID || '').toLowerCase();
    const image = (containerData.Image || containerData['.Image'] || containerData.image || '').toLowerCase();
    const id = (containerData.ID || containerData.Id || containerData['.ID'] || containerData.id || '').toLowerCase();
    return name.includes(search) || image.includes(search) || id.includes(search);
  });

  // Helper to check if container matches a rule
  const matchesRule = (containerName, rule) => {
    if (!rule.enabled) return false;
    
    const name = containerName.toLowerCase();
    const pattern = rule.pattern.toLowerCase();
    
    switch (rule.patternType) {
      case 'prefix':
        return name.startsWith(pattern);
      case 'suffix':
        return name.endsWith(pattern);
      case 'contains':
        return name.includes(pattern);
      case 'regex':
        try {
          const regex = new RegExp(rule.pattern, 'i');
          return regex.test(containerName);
        } catch (e) {
          return false;
        }
      default:
        return false;
    }
  };

  // Group containers based on rules
  const groupedContainers = useMemo(() => {
    if (!groupContainers || groupingRules.length === 0) {
      return null; // Return null to indicate no grouping
    }

    const grouped = {};
    const ungrouped = [];

    // Sort rules by sortOrder
    const sortedRules = [...groupingRules].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.groupName.localeCompare(b.groupName);
    });

    filteredContainers.forEach((container) => {
      const containerName = getContainerName(container);
      let matched = false;

      for (const rule of sortedRules) {
        if (matchesRule(containerName, rule)) {
          if (!grouped[rule.groupName]) {
            grouped[rule.groupName] = [];
          }
          grouped[rule.groupName].push(container);
          matched = true;
          break; // Only match to first rule
        }
      }

      if (!matched) {
        ungrouped.push(container);
      }
    });

    return { grouped, ungrouped };
  }, [filteredContainers, groupingRules, groupContainers]);

  // Helper function to parse memory values (e.g., "3.3Gi", "15Gi")
  const parseMemoryValue = (value) => {
    if (!value || value === 'Unknown') return 0;
    const match = value.toString().match(/^([\d.]+)\s*([KMGT]?i?B?)$/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const multipliers = { 'B': 1, 'KB': 1024, 'MB': 1024 ** 2, 'GB': 1024 ** 3, 'TB': 1024 ** 4, 'KIB': 1024, 'MIB': 1024 ** 2, 'GIB': 1024 ** 3, 'TIB': 1024 ** 4 };
    return num * (multipliers[unit] || 1);
  };

  // Helper function to parse CPU percentage (e.g., "1.0%")
  const parseCPUPercent = (value) => {
    if (!value || value === 'Unknown') return 0;
    const match = value.toString().match(/([\d.]+)/);
    return match ? parseFloat(match[1]) : 0;
  };

  // Calculate memory usage percentage
  const memoryUsage = hostInfo ? (() => {
    const total = parseMemoryValue(hostInfo.totalMemory);
    const used = parseMemoryValue(hostInfo.usedMemory);
    return total > 0 ? (used / total) * 100 : 0;
  })() : 0;

  // Get CPU usage percentage
  const cpuUsage = hostInfo ? parseCPUPercent(hostInfo.cpuUsage) : 0;

  // Render container card (extracted for reuse)
  const renderContainerCard = (container) => {
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
    const isRunning = status.toLowerCase().includes('up') || 
                     status.toLowerCase().includes('running') ||
                     status.toLowerCase().startsWith('up');
    
    const containerId = containerData.ID || containerData.Id || containerData['.ID'] || containerData.id || '';
    let containerName = getContainerName(container);
    
    const image = containerData.Image || containerData['.Image'] || containerData.image || 'Unknown';
    const ports = containerData.Ports || containerData['.Ports'] || containerData.ports || '';
    const restartPolicy = containerData.RestartPolicy || containerData.restartPolicy || 'no';
    const hasAutoRestart = restartPolicy !== 'no';
    const skipUpdate = !!(containerData.SkipUpdate || containerData.skipUpdate);

    const handleToggleRestart = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (updatingPolicies.has(containerId)) return;
      
      setUpdatingPolicies(prev => new Set(prev).add(containerId));
      
      try {
        const newPolicy = restartPolicy === 'no' ? 'unless-stopped' : 'no';
        await containersService.updateRestartPolicy(serverId, containerId, newPolicy);
        
        setContainers(containers.map(c => {
          const cData = typeof c === 'string' ? (() => { try { return JSON.parse(c); } catch { return { ID: c }; } })() : c;
          const cId = cData.ID || cData.Id || cData['.ID'] || cData.id;
          if (cId === containerId) {
            return { ...cData, RestartPolicy: newPolicy };
          }
          return c;
        }));
      } catch (error) {
        console.error('Failed to update restart policy:', error);
        alert(error.response?.data?.error || 'Failed to update restart policy');
      } finally {
        setUpdatingPolicies(prev => {
          const next = new Set(prev);
          next.delete(containerId);
          return next;
        });
      }
    };

    return (
      <div key={containerId} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md dark:hover:shadow-gray-700 transition-all duration-200 bg-white dark:bg-gray-800">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link
                to={`/servers/${serverId}/containers/${containerId}`}
                className="text-sm font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 truncate"
                title={containerName}
              >
                {containerName.replace(/^\//, '')}
              </Link>
              <button
                onClick={handleToggleRestart}
                disabled={updatingPolicies.has(containerId)}
                className={`flex-shrink-0 p-1 rounded transition-colors ${
                  hasAutoRestart
                    ? 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20'
                    : 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                } ${updatingPolicies.has(containerId) ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={hasAutoRestart 
                  ? `Auto-restart: ${restartPolicy} (click to disable)` 
                  : 'Auto-restart disabled (click to enable)'}
              >
                {updatingPolicies.has(containerId) ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 14M20 20v-5h-.582m-15.356 2a8.001 8.001 0 0015.356-2m0 0V9M20 4v5" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1" title={image}>
              {image}
            </p>
          </div>
          <span
            className={`ml-2 px-2 py-1 text-xs font-medium rounded-full flex-shrink-0 ${
              isRunning
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
            }`}
          >
            {isRunning ? 'Running' : 'Stopped'}
          </span>
          {skipUpdate && (
            <span className="ml-1 px-2 py-1 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200" title="Dev/pinned – update check skipped">
              Dev
            </span>
          )}
        </div>

        {ports && (
          <div className="mb-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={ports}>
              <span className="font-medium">Ports:</span> {ports || 'None'}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setLogsModal({ isOpen: true, containerId, containerName });
              }}
              className="px-3 py-1.5 text-xs font-medium text-purple-800 dark:text-purple-200 bg-purple-50 dark:bg-purple-900/30 rounded hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors flex items-center gap-1"
              title="View live logs"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Logs
            </button>
            {isRunning ? (
              <>
                <button
                  onClick={() => handleContainerAction('stop', containerId)}
                  className="px-3 py-1.5 text-xs font-medium text-yellow-800 dark:text-yellow-200 bg-yellow-50 dark:bg-yellow-900/30 rounded hover:bg-yellow-100 dark:hover:bg-yellow-900/50 transition-colors"
                >
                  Stop
                </button>
                <button
                  onClick={() => handleContainerAction('restart', containerId)}
                  className="px-3 py-1.5 text-xs font-medium text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/30 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                >
                  Restart
                </button>
              </>
            ) : (
              <button
                onClick={() => handleContainerAction('start', containerId)}
                className="px-3 py-1.5 text-xs font-medium text-green-800 dark:text-green-200 bg-green-50 dark:bg-green-900/30 rounded hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
              >
                Start
              </button>
            )}
            <button
              onClick={() => handleContainerAction('remove', containerId)}
              className="px-3 py-1.5 text-xs font-medium text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-900/30 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    );
  };

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

  // Linear progress gauge component - only animates the fill, not the entire component
  const LinearGauge = ({ value, max, label, unit, color }) => {
    const percentage = Math.min((value / max) * 100, 100);
    
    const getColor = () => {
      if (percentage < 50) return color || '#10b981'; // green
      if (percentage < 80) return '#f59e0b'; // yellow
      return '#ef4444'; // red
    };

    const gaugeColor = getColor();

    return (
      <div className="flex flex-col items-center justify-center p-4 w-full">
        <div className="w-full">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{label}</span>
            <span 
              className="text-2xl font-bold transition-colors duration-300" 
              style={{ color: gaugeColor }}
            >
              {value.toFixed(1)}%
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-6 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${percentage}%`,
                backgroundColor: gaugeColor,
              }}
            />
          </div>
          {unit && (
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-2 text-center">
              {unit}
            </div>
          )}
        </div>
      </div>
    );
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
        <p className="text-gray-500 dark:text-gray-400">Server not found</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {(() => {
                // Prefer FQDN hostname from hostInfo if available
                const hostname = hostInfo?.hostname;
                const serverHost = server.host;
                
                // If hostname is available and not 'Unknown', use it (should be FQDN from backend)
                if (hostname && hostname !== 'Unknown') {
                  return hostname;
                }
                
                // If no hostname from hostInfo, check if server.host is an FQDN (contains dots and not an IP)
                if (serverHost.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(serverHost)) {
                  return serverHost;
                }
                
                // Fallback to server name
                return server.name;
              })()}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {(() => {
                // Show IP address if server.host is an IP, otherwise show server.host
                const serverHost = server.host;
                if (/^\d+\.\d+\.\d+\.\d+$/.test(serverHost)) {
                  return `${serverHost}:${server.port}`;
                }
                // If server.host is already an FQDN, show it with port
                return `${serverHost}:${server.port}`;
              })()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setDeployError('');
                setDeployImage('');
                setDeployName('');
                setDeployPorts('');
                setDeployRestart('unless-stopped');
                setDeployPullFirst(true);
                setDeployModalOpen(true);
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 dark:bg-primary-500 border border-primary-600 dark:border-primary-500 rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Deploy container
            </button>
            <Link
              to={`/servers/${serverId}/edit`}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </Link>
            <button
              onClick={() => fetchData(false)}
              disabled={refreshing}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 dark:bg-gray-700 disabled:opacity-50 flex items-center gap-2"
            >
              <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 14M20 20v-5h-.582m-15.356 2a8.001 8.001 0 0015.356-2m0 0V9M20 4v5" />
              </svg>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              onClick={async () => {
                const serverName = hostInfo?.hostname && hostInfo.hostname !== 'Unknown'
                  ? hostInfo.hostname
                  : (server.host.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(server.host) ? server.host : server.name);
                
                if (window.confirm(`Are you sure you want to delete the server "${serverName}"? This action cannot be undone.`)) {
                  try {
                    await serversService.delete(serverId);
                    navigate('/');
                  } catch (error) {
                    alert(error.response?.data?.error || 'Failed to delete server');
                  }
                }
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 dark:bg-red-500 border border-red-600 dark:border-red-500 rounded-lg hover:bg-red-700 dark:hover:bg-red-600 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Host Information */}
      {hostInfo && !hostInfo.error && (
        <div className="mb-6 bg-white dark:bg-gray-800 shadow dark:shadow-gray-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Host Information</h2>
          
          {/* CPU and Memory Gauges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6 pb-6 border-b border-gray-200 dark:border-gray-700">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-lg p-6">
              <LinearGauge 
                value={cpuUsage} 
                max={100} 
                label="CPU Usage" 
                color="#3b82f6"
              />
              <div className="mt-4 space-y-1">
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  Current: {hostInfo.cpuUsage || 'Unknown'}
                </div>
                {hostInfo.loadAverage && (
                  <div className="text-xs text-gray-500 dark:text-gray-500">
                    Load Average: {hostInfo.loadAverage}
                  </div>
                )}
              </div>
            </div>
            
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-lg p-6">
              <LinearGauge 
                value={memoryUsage} 
                max={100} 
                label="Memory Usage" 
                color="#8b5cf6"
              />
              <div className="mt-4 space-y-1">
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {hostInfo.usedMemory || 'Unknown'} / {hostInfo.totalMemory || 'Unknown'}
                </div>
                {hostInfo.availableMemory && (
                  <div className="text-xs text-gray-500 dark:text-gray-500">
                    Available: {hostInfo.availableMemory}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Detailed Host Information Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Hostname</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {(() => {
                  // Always show FQDN hostname if available
                  const hostname = hostInfo?.hostname;
                  if (hostname && hostname !== 'Unknown') {
                    return hostname;
                  }
                  // Fallback to server.host if it's an FQDN
                  const serverHost = server.host;
                  if (serverHost.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(serverHost)) {
                    return serverHost;
                  }
                  return hostname || 'Unknown';
                })()}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Architecture</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.architecture || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">OS</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.os || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Kernel</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.kernel || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">CPU Model</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100 truncate" title={hostInfo.cpuModel || 'Unknown'}>
                {hostInfo.cpuModel || 'Unknown'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">CPU Cores</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.cpuCores || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">CPU Usage</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.cpuUsage || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Load Average</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.loadAverage || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Memory</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.totalMemory || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Used Memory</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.usedMemory || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Available Memory</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.availableMemory || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Disk Usage</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.diskUsage || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Uptime</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.uptime || 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Docker Version</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{hostInfo.dockerVersion || 'Unknown'}</dd>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
        <div className="bg-white dark:bg-gray-800 overflow-hidden shadow dark:shadow-gray-700 rounded-lg transition-colors">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-blue-500 rounded-md p-3">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Containers</dt>
                  <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stats.total}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 overflow-hidden shadow dark:shadow-gray-700 rounded-lg transition-colors">
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
                  <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stats.running}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 overflow-hidden shadow dark:shadow-gray-700 rounded-lg transition-colors">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-gray-500 dark:bg-gray-600 rounded-md p-3">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Stopped</dt>
                  <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stats.stopped}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Actions */}
      <div className="mb-4 bg-white dark:bg-gray-800 p-4 rounded-lg shadow dark:shadow-gray-700 transition-colors">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="flex-1 max-w-md">
                <input
                  type="text"
                  placeholder="Search containers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 focus:border-primary-500 dark:focus:border-primary-400"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                  className="rounded text-primary-600 dark:text-primary-400 focus:ring-primary-500 dark:focus:ring-primary-400"
                />
                Show all containers
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={groupContainers}
                  onChange={(e) => setGroupContainers(e.target.checked)}
                  className="rounded text-primary-600 dark:text-primary-400 focus:ring-primary-500 dark:focus:ring-primary-400"
                />
                Group containers
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowGroupingModal(true)}
                className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                Manage Groups
              </button>
              <Link
                to={`/servers/${serverId}/images`}
                className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                View Images
              </Link>
            </div>
          </div>
          
          {/* Status Filter Tags */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">Filter:</span>
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                statusFilter === 'all'
                  ? 'bg-primary-600 dark:bg-primary-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              All ({containers.length})
            </button>
            <button
              onClick={() => setStatusFilter('running')}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                statusFilter === 'running'
                  ? 'bg-green-600 dark:bg-green-500 text-white'
                  : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-900/50'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-current"></span>
              Running ({stats.running})
            </button>
            <button
              onClick={() => setStatusFilter('stopped')}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                statusFilter === 'stopped'
                  ? 'bg-gray-600 dark:bg-gray-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-current"></span>
              Stopped ({stats.stopped})
            </button>
          </div>
        </div>
      </div>

      {/* Containers List */}
      <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700 overflow-hidden sm:rounded-lg transition-colors">
        {filteredContainers.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No containers found</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {searchTerm ? 'Try adjusting your search terms.' : 'No containers are running on this server.'}
            </p>
          </div>
        ) : groupedContainers && groupContainers ? (
          // Grouped display
          <div className="p-4 space-y-4">
            {/* Render grouped containers */}
            {Object.entries(groupedContainers.grouped).sort(([a], [b]) => a.localeCompare(b)).map(([groupName, groupContainers]) => {
              const isExpanded = expandedGroups.has(groupName);
              
              // Calculate status for this group
              const groupStats = groupContainers.reduce((acc, container) => {
                let containerData = container;
                if (typeof container === 'string') {
                  try {
                    containerData = JSON.parse(container);
                  } catch (e) {
                    containerData = { ID: container };
                  }
                }
                const status = (containerData.Status || containerData['.Status'] || containerData.status || '').toLowerCase();
                const isRunning = status.includes('up') || status.includes('running') || status.startsWith('up');
                if (isRunning) {
                  acc.running++;
                } else {
                  acc.stopped++;
                }
                return acc;
              }, { running: 0, stopped: 0 });
              
              const allRunning = groupStats.stopped === 0 && groupStats.running > 0;
              const allStopped = groupStats.running === 0 && groupStats.stopped > 0;
              
              return (
                <div key={groupName} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <button
                    onClick={() => {
                      setExpandedGroups(prev => {
                        const next = new Set(prev);
                        if (isExpanded) {
                          next.delete(groupName);
                        } else {
                          next.add(groupName);
                        }
                        return next;
                      });
                    }}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{groupName}</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">({groupContainers.length})</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {!isExpanded && (
                        <>
                          <div className="flex items-center gap-2">
                            {allRunning && (
                              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                All Running
                              </span>
                            )}
                            {allStopped && (
                              <span className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                                All Stopped
                              </span>
                            )}
                            {!allRunning && !allStopped && (
                              <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
                                <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                                {groupStats.running}/{groupContainers.length} Running
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {groupStats.running > 0 && <span className="text-green-600 dark:text-green-400">{groupStats.running} up</span>}
                            {groupStats.running > 0 && groupStats.stopped > 0 && <span className="mx-1">•</span>}
                            {groupStats.stopped > 0 && <span className="text-gray-600 dark:text-gray-400">{groupStats.stopped} down</span>}
                          </div>
                        </>
                      )}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                      {groupContainers.map((container) => {
                        return renderContainerCard(container);
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Render ungrouped containers */}
            {groupedContainers.ungrouped.length > 0 && (() => {
              const ungroupedGroupName = 'Ungrouped';
              const isUngroupedExpanded = expandedGroups.has(ungroupedGroupName);
              
              const ungroupedStats = groupedContainers.ungrouped.reduce((acc, container) => {
                let containerData = container;
                if (typeof container === 'string') {
                  try {
                    containerData = JSON.parse(container);
                  } catch (e) {
                    containerData = { ID: container };
                  }
                }
                const status = (containerData.Status || containerData['.Status'] || containerData.status || '').toLowerCase();
                const isRunning = status.includes('up') || status.includes('running') || status.startsWith('up');
                if (isRunning) {
                  acc.running++;
                } else {
                  acc.stopped++;
                }
                return acc;
              }, { running: 0, stopped: 0 });
              
              const allRunning = ungroupedStats.stopped === 0 && ungroupedStats.running > 0;
              const allStopped = ungroupedStats.running === 0 && ungroupedStats.stopped > 0;
              
              return (
                <div key={ungroupedGroupName} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <button
                    onClick={() => {
                      setExpandedGroups(prev => {
                        const next = new Set(prev);
                        if (isUngroupedExpanded) {
                          next.delete(ungroupedGroupName);
                        } else {
                          next.add(ungroupedGroupName);
                        }
                        return next;
                      });
                    }}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${isUngroupedExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">Ungrouped</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">({groupedContainers.ungrouped.length})</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {!isUngroupedExpanded && (
                        <>
                          {allRunning && (
                            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                              <span className="w-2 h-2 rounded-full bg-green-500"></span>
                              All Running
                            </span>
                          )}
                          {allStopped && (
                            <span className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                              <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                              All Stopped
                            </span>
                          )}
                          {!allRunning && !allStopped && (
                            <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
                              <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                              {ungroupedStats.running}/{groupedContainers.ungrouped.length} Running
                            </span>
                          )}
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {ungroupedStats.running > 0 && <span className="text-green-600 dark:text-green-400">{ungroupedStats.running} up</span>}
                            {ungroupedStats.running > 0 && ungroupedStats.stopped > 0 && <span className="mx-1">•</span>}
                            {ungroupedStats.stopped > 0 && <span className="text-gray-600 dark:text-gray-400">{ungroupedStats.stopped} down</span>}
                          </div>
                        </>
                      )}
                    </div>
                  </button>
                  {isUngroupedExpanded && (
                    <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                      {groupedContainers.ungrouped.map((container) => {
                        return renderContainerCard(container);
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : (
          // Flat display (original)
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredContainers.map((container) => renderContainerCard(container))}
          </div>
        )}
      </div>

      {/* Deploy container modal */}
      {deployModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Deploy new container</h3>
              <button
                type="button"
                onClick={() => !deployLoading && setDeployModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {deployError && (
              <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-200">
                {deployError}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Image *</label>
                <input
                  type="text"
                  value={deployImage}
                  onChange={(e) => setDeployImage(e.target.value)}
                  placeholder="e.g. nginx:latest or ghcr.io/org/repo:tag"
                  disabled={deployLoading}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Container name *</label>
                <input
                  type="text"
                  value={deployName}
                  onChange={(e) => setDeployName(e.target.value)}
                  placeholder="e.g. my-app"
                  disabled={deployLoading}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Port mappings (optional)</label>
                <input
                  type="text"
                  value={deployPorts}
                  onChange={(e) => setDeployPorts(e.target.value)}
                  placeholder="e.g. 8080:80 or leave empty to auto-publish exposed ports"
                  disabled={deployLoading}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Leave empty to publish all ports the image exposes (EXPOSE) to random host ports.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Restart policy</label>
                <select
                  value={deployRestart}
                  onChange={(e) => setDeployRestart(e.target.value)}
                  disabled={deployLoading}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
                >
                  <option value="unless-stopped">Unless stopped</option>
                  <option value="always">Always</option>
                  <option value="on-failure">On failure</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="deploy-pull-first"
                  checked={deployPullFirst}
                  onChange={(e) => setDeployPullFirst(e.target.checked)}
                  disabled={deployLoading}
                  className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="deploy-pull-first" className="text-sm text-gray-700 dark:text-gray-300">Pull image before creating (recommended)</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={async () => {
                  const image = deployImage.trim();
                  const name = deployName.trim();
                  if (!image || !name) {
                    setDeployError('Image and container name are required.');
                    return;
                  }
                  setDeployError('');
                  setDeployLoading(true);
                  try {
                    const ports = deployPorts
                      ? deployPorts.split(/[\s,]+/).map((p) => p.trim()).filter(Boolean)
                      : undefined;
                    const res = await containersService.deploy(serverId, {
                      imageName: image,
                      containerName: name,
                      ports,
                      restart: deployRestart,
                      pullFirst: deployPullFirst,
                    });
                    setDeployModalOpen(false);
                    fetchData(false);
                    if (res.data?.containerId) {
                      navigate(`/servers/${serverId}/containers/${res.data.containerId}`);
                    }
                  } catch (err) {
                    setDeployError(err.response?.data?.error || err.message || 'Deploy failed');
                  } finally {
                    setDeployLoading(false);
                  }
                }}
                disabled={deployLoading}
                className="flex-1 px-4 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 font-medium disabled:opacity-50"
              >
                {deployLoading ? 'Deploying…' : 'Deploy'}
              </button>
              <button
                type="button"
                onClick={() => !deployLoading && setDeployModalOpen(false)}
                disabled={deployLoading}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      <LogsModal
        isOpen={logsModal.isOpen}
        onClose={() => setLogsModal({ isOpen: false, containerId: null, containerName: null })}
        serverId={serverId}
        containerId={logsModal.containerId}
        containerName={logsModal.containerName}
      />

      {/* Grouping Management Modal */}
      {showGroupingModal && (
        <GroupingModal
          isOpen={showGroupingModal}
          onClose={() => setShowGroupingModal(false)}
          onRulesUpdated={fetchGroupingRules}
        />
      )}
    </div>
  );
};

export default ServerDetails;
