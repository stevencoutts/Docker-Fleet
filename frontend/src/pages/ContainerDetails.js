import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { containersService } from '../services/containers.service';
import LogsViewer from '../components/LogsViewer';
import Console from '../components/Console';
import { LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const ContainerDetails = () => {
  const { serverId, containerId } = useParams();
  const [container, setContainer] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsHistory, setStatsHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('details');
  const [loading, setLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [snapshotImageName, setSnapshotImageName] = useState('');
  const [snapshotTag, setSnapshotTag] = useState('snapshot');
  const [snapshotDownload, setSnapshotDownload] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreImageName, setRestoreImageName] = useState('');
  const [restoreContainerName, setRestoreContainerName] = useState('');
  const maxHistoryPoints = 30;

  // Set default snapshot name when modal opens or container changes
  useEffect(() => {
    if (container) {
      const containerName = container.Name?.replace('/', '') || containerId.substring(0, 12);
      const defaultName = `${containerName}-snapshot`;
      setSnapshotImageName(defaultName);
    }
  }, [container, containerId]);

  useEffect(() => {
    fetchContainerDetails();
    fetchSnapshots();
  }, [serverId, containerId]);

  const fetchSnapshots = async () => {
    try {
      const response = await containersService.getSnapshots(serverId, containerId);
      // Filter snapshots that match the container name pattern
      const containerName = container?.Name?.replace('/', '') || containerId.substring(0, 12);
      const filtered = response.data.snapshots.filter(img => 
        img.name.includes(containerName) || img.name.includes('-snapshot')
      );
      setSnapshots(filtered);
    } catch (error) {
      console.error('Failed to fetch snapshots:', error);
      setSnapshots([]);
    }
  };

  useEffect(() => {
    if (activeTab === 'stats' && containerId) {
      fetchStats();
      const interval = setInterval(() => {
        fetchStats();
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [activeTab, containerId]);

  const fetchContainerDetails = async () => {
    try {
      const response = await containersService.getById(serverId, containerId);
      setContainer(response.data.container);
    } catch (error) {
      console.error('Failed to fetch container details:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await containersService.getStats(serverId, containerId);
      const newStats = response.data.stats;
      setStats(newStats);
      
      // Add to history for charts
      const cpuPercent = calculateCPUPercent(newStats);
      const memUsage = newStats.memory_stats?.usage || 0;
      const memLimit = newStats.memory_stats?.limit || 0;
      const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;
      
      const historyPoint = {
        time: new Date().toLocaleTimeString(),
        cpu: parseFloat(cpuPercent.toFixed(2)),
        memory: parseFloat(memPercent.toFixed(2)),
        memoryUsed: memUsage,
        memoryLimit: memLimit,
        netRx: newStats.networks ? Object.values(newStats.networks).reduce((sum, net) => sum + (net.rx_bytes || 0), 0) : 0,
        netTx: newStats.networks ? Object.values(newStats.networks).reduce((sum, net) => sum + (net.tx_bytes || 0), 0) : 0,
        blockRead: newStats.blkio_stats?.io_service_bytes_recursive?.find(b => b.op === 'Read')?.value || 0,
        blockWrite: newStats.blkio_stats?.io_service_bytes_recursive?.find(b => b.op === 'Write')?.value || 0,
        pids: newStats.pids_stats?.current || 0,
      };
      
      setStatsHistory(prev => {
        const updated = [...prev, historyPoint];
        return updated.slice(-maxHistoryPoints);
      });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const handleAction = async (action) => {
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
        default:
          return;
      }

      if (response.data.success !== false) {
        fetchContainerDetails();
      } else {
        alert(response.data.message || 'Action failed');
      }
    } catch (error) {
      alert(error.response?.data?.error || 'Action failed');
    }
  };

  const handleCreateSnapshot = async () => {
    if (!snapshotImageName.trim()) {
      alert('Please enter an image name');
      return;
    }

    setSnapshotLoading(true);
    try {
      const result = await containersService.createSnapshot(
        serverId, 
        containerId, 
        snapshotImageName.trim(), 
        snapshotTag.trim() || 'snapshot',
        snapshotDownload
      );
      setSnapshotModalOpen(false);
      setSnapshotImageName('');
      setSnapshotTag('snapshot');
      setSnapshotDownload(false);
      
      // Refresh snapshots list
      await fetchSnapshots();
      
      if (snapshotDownload) {
        alert('Snapshot created, saved on server, and downloaded successfully!');
      } else {
        alert(`Snapshot created and saved on server as ${result.data?.imageName || snapshotImageName}:${snapshotTag || 'snapshot'}`);
      }
    } catch (error) {
      alert(error.response?.data?.error || error.message || 'Failed to create snapshot');
    } finally {
      setSnapshotLoading(false);
    }
  };

  const formatPorts = (ports) => {
    if (!ports || Object.keys(ports).length === 0) return [];
    
    const formatted = [];
    for (const [containerPort, hostPorts] of Object.entries(ports)) {
      if (hostPorts && hostPorts.length > 0) {
        hostPorts.forEach(hostPort => {
          formatted.push({
            container: containerPort,
            host: `${hostPort.HostIp || '0.0.0.0'}:${hostPort.HostPort}`,
            protocol: containerPort.split('/')[1] || 'tcp',
          });
        });
      } else {
        formatted.push({
          container: containerPort,
          host: 'Not mapped',
          protocol: containerPort.split('/')[1] || 'tcp',
        });
      }
    }
    return formatted;
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const calculateCPUPercent = (stats) => {
    if (!stats || !stats.cpu_stats || !stats.precpu_stats) return 0;
    
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numCpus = stats.cpu_stats.online_cpus || 1;
    
    if (systemDelta > 0 && cpuDelta > 0) {
      return (cpuDelta / systemDelta) * numCpus * 100;
    }
    return 0;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 dark:border-primary-400"></div>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">Loading container details...</p>
        </div>
      </div>
    );
  }

  if (!container) {
    return (
      <div className="text-center py-12">
        <div className="max-w-md mx-auto">
          <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">Container not found</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">The container you're looking for doesn't exist or has been removed.</p>
          <div className="mt-6">
            <Link
              to={`/servers/${serverId}`}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
            >
              ← Back to server
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isRunning = container.State?.Status === 'running' || container.State?.Running;
  const containerName = container.Name?.replace('/', '') || containerId.substring(0, 12);
  const image = container.Config?.Image || 'Unknown';
  const created = new Date(container.Created * 1000).toLocaleString();
  const ports = formatPorts(container.NetworkSettings?.Ports);
  const cpuPercent = stats ? calculateCPUPercent(stats) : 0;
  const memUsage = stats?.memory_stats?.usage || 0;
  const memLimit = stats?.memory_stats?.limit || 0;
  const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;

  return (
    <div className="px-4 py-6 sm:px-0">
      {/* Hero Header */}
      <div className="mb-6">
        <Link
          to={`/servers/${serverId}`}
          className="inline-flex items-center text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 mb-4 transition-colors"
        >
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to server
        </Link>
        
        <div className="bg-gradient-to-r from-primary-500 to-primary-600 dark:from-primary-600 dark:to-primary-700 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 bg-white/20 rounded-lg backdrop-blur-sm">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-3xl font-bold">{containerName}</h1>
                  <p className="text-primary-100 mt-1">{image}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-4">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  isRunning 
                    ? 'bg-green-500/30 text-white backdrop-blur-sm' 
                    : 'bg-gray-500/30 text-white backdrop-blur-sm'
                }`}>
                  {isRunning ? '● Running' : '○ Stopped'}
                </span>
                <span className="text-primary-100 text-sm">
                  Created: {created}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleAction(isRunning ? 'stop' : 'start')}
                className={`px-4 py-2 rounded-lg font-medium transition-all transform hover:scale-105 ${
                  isRunning
                    ? 'bg-yellow-500 hover:bg-yellow-600 text-white shadow-lg'
                    : 'bg-green-500 hover:bg-green-600 text-white shadow-lg'
                }`}
              >
                {isRunning ? (
                  <>
                    <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                    Stop
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Start
                  </>
                )}
              </button>
              <button
                onClick={() => handleAction('restart')}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg font-medium transition-all transform hover:scale-105 backdrop-blur-sm flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 14M20 20v-5h-.582m-15.356 2a8.001 8.001 0 0015.356-2m0 0V9M20 4v5" />
                </svg>
                Restart
              </button>
              <button
                onClick={() => {
                  // Set default name when opening modal
                  if (container) {
                    const containerName = container.Name?.replace('/', '') || containerId.substring(0, 12);
                    setSnapshotImageName(`${containerName}-snapshot`);
                  }
                  setSnapshotModalOpen(true);
                }}
                className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-medium transition-all transform hover:scale-105 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Snapshot
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Snapshot Modal */}
      {snapshotModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Create Snapshot</h3>
              <button
                onClick={() => setSnapshotModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              This will commit the container to an image and export it as a tar file for download.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Image Name *
                </label>
                <input
                  type="text"
                  value={snapshotImageName}
                  onChange={(e) => setSnapshotImageName(e.target.value)}
                  placeholder="e.g., my-container"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  disabled={snapshotLoading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Tag
                </label>
                <input
                  type="text"
                  value={snapshotTag}
                  onChange={(e) => setSnapshotTag(e.target.value)}
                  placeholder="snapshot"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  disabled={snapshotLoading}
                />
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="snapshotDownload"
                  checked={snapshotDownload}
                  onChange={(e) => setSnapshotDownload(e.target.checked)}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  disabled={snapshotLoading}
                />
                <label htmlFor="snapshotDownload" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  Also download as tar file
                </label>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                The image will always be saved on the server and appear in your Images list. 
                Checking this option will also download a tar file to your computer.
              </p>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleCreateSnapshot}
                disabled={snapshotLoading || !snapshotImageName.trim()}
                className="flex-1 px-4 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {snapshotLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating...
                  </span>
                ) : (
                  'Create Snapshot'
                )}
              </button>
              <button
                onClick={() => setSnapshotModalOpen(false)}
                disabled={snapshotLoading}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Snapshot Modal */}
      {restoreModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Restore Snapshot</h3>
              <button
                onClick={() => setRestoreModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Create a new container from snapshot: <span className="font-mono text-primary-600 dark:text-primary-400">{restoreImageName}</span>
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Container Name *
                </label>
                <input
                  type="text"
                  value={restoreContainerName}
                  onChange={(e) => setRestoreContainerName(e.target.value)}
                  placeholder="e.g., my-restored-container"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={async () => {
                  if (!restoreContainerName.trim()) {
                    alert('Please enter a container name');
                    return;
                  }
                  try {
                    await containersService.restoreSnapshot(serverId, restoreImageName, restoreContainerName.trim());
                    setRestoreModalOpen(false);
                    setRestoreContainerName('');
                    alert('Container created successfully!');
                    // Navigate to server page to see the new container
                    window.location.href = `/servers/${serverId}`;
                  } catch (error) {
                    alert(error.response?.data?.error || error.message || 'Failed to restore snapshot');
                  }
                }}
                className="flex-1 px-4 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors font-medium"
              >
                Create Container
              </button>
              <button
                onClick={() => setRestoreModalOpen(false)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 shadow-lg rounded-xl overflow-hidden">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex -mb-px">
            {[
              { id: 'details', label: 'Details', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
              { id: 'logs', label: 'Logs', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
              { id: 'console', label: 'Console', icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
              { id: 'snapshots', label: 'Snapshots', icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' },
              { id: 'stats', label: 'Stats', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 px-6 py-4 text-sm font-medium border-b-2 transition-all ${
                  activeTab === tab.id
                    ? 'border-primary-500 dark:border-primary-400 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                  </svg>
                  {tab.label}
                </div>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* Quick Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Status</p>
                      <p className="text-2xl font-bold text-blue-900 dark:text-blue-100 mt-1 capitalize">
                        {container.State?.Status || 'Unknown'}
                      </p>
                    </div>
                    <div className="p-3 bg-blue-500/20 rounded-lg">
                      <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-purple-600 dark:text-purple-400">Image</p>
                      <p className="text-sm font-semibold text-purple-900 dark:text-purple-100 mt-1 truncate" title={image}>
                        {image}
                      </p>
                    </div>
                    <div className="p-3 bg-purple-500/20 rounded-lg">
                      <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/30 dark:to-green-800/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-green-600 dark:text-green-400">Created</p>
                      <p className="text-sm font-semibold text-green-900 dark:text-green-100 mt-1">
                        {new Date(container.Created * 1000).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">
                        {new Date(container.Created * 1000).toLocaleTimeString()}
                      </p>
                    </div>
                    <div className="p-3 bg-green-500/20 rounded-lg">
                      <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              {/* Ports Section */}
              {ports.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <svg className="w-5 h-5 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Port Mappings</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {ports.map((port, idx) => (
                      <div key={idx} className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Container</span>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                            port.protocol === 'tcp' 
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200' 
                              : 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200'
                          }`}>
                            {port.protocol.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-sm font-mono font-semibold text-gray-900 dark:text-gray-100 mb-2">{port.container.split('/')[0]}</p>
                        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          <span className="font-mono">{port.host}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Environment Variables */}
              {container.Config?.Env && container.Config.Env.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <svg className="w-5 h-5 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Environment Variables</h3>
                    <span className="px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full">
                      {container.Config.Env.length}
                    </span>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 max-h-64 overflow-y-auto">
                    <div className="space-y-1">
                      {container.Config.Env.map((env, idx) => {
                        const [key, ...valueParts] = env.split('=');
                        const value = valueParts.join('=');
                        return (
                          <div key={idx} className="flex items-start gap-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                            <span className="font-mono text-xs font-semibold text-primary-600 dark:text-primary-400 flex-shrink-0">{key}=</span>
                            <span className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">{value || '(empty)'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Additional Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                  <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Container ID</h4>
                  <p className="text-sm font-mono text-gray-900 dark:text-gray-100">{containerId}</p>
                </div>
                {container.State?.StartedAt && (
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Started At</h4>
                    <p className="text-sm text-gray-900 dark:text-gray-100">
                      {new Date(container.State.StartedAt).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="h-[600px]">
              <LogsViewer serverId={serverId} containerId={containerId} />
            </div>
          )}

          {activeTab === 'console' && (
            <div className="h-[600px]">
              <Console serverId={serverId} containerId={containerId} />
            </div>
          )}

          {activeTab === 'snapshots' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Snapshots</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    View and restore snapshots created from this container
                  </p>
                </div>
                <button
                  onClick={() => {
                    const containerName = container?.Name?.replace('/', '') || containerId.substring(0, 12);
                    setSnapshotImageName(`${containerName}-snapshot`);
                    setSnapshotModalOpen(true);
                  }}
                  className="px-4 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Snapshot
                </button>
              </div>

              {snapshots.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No snapshots</h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Create a snapshot to save the current state of this container.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {snapshots.map((snapshot, idx) => (
                    <div key={idx} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{snapshot.name}</h4>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">ID: {snapshot.id.substring(0, 12)}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Created: {snapshot.created}</p>
                        </div>
                        <svg className="w-5 h-5 text-purple-500 dark:text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </div>
                      <button
                        onClick={() => {
                          setRestoreImageName(snapshot.name);
                          setRestoreContainerName(`${snapshot.name.split(':')[0]}-restored`);
                          setRestoreModalOpen(true);
                        }}
                        className="w-full px-3 py-2 bg-primary-600 dark:bg-primary-500 text-white text-sm rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors"
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'stats' && (
            <div>
              {stats ? (
                <div className="space-y-6">
                  {/* Real-time CPU and Memory Charts */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* CPU Usage Chart */}
                    <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/20 rounded-xl p-6 border border-blue-200 dark:border-blue-800 shadow-lg">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100">CPU Usage</h3>
                          <p className="text-3xl font-bold text-blue-900 dark:text-blue-100 mt-1">
                            {cpuPercent.toFixed(2)}%
                          </p>
                        </div>
                        <div className="p-3 bg-blue-500/20 rounded-lg">
                          <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                      </div>
                      {statsHistory.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={statsHistory}>
                            <defs>
                              <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fillOpacity={1} fill="url(#cpuGradient)" />
                            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                              formatter={(value) => [`${value}%`, 'CPU']}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="w-full bg-blue-200 dark:bg-blue-900/50 rounded-full h-4">
                          <div 
                            className="bg-blue-600 dark:bg-blue-400 h-4 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(cpuPercent, 100)}%` }}
                          ></div>
                        </div>
                      )}
                    </div>

                    {/* Memory Usage Chart */}
                    <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/30 dark:to-green-800/20 rounded-xl p-6 border border-green-200 dark:border-green-800 shadow-lg">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-green-900 dark:text-green-100">Memory Usage</h3>
                          <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-1">
                            {formatBytes(memUsage)}
                          </p>
                          <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                            {memPercent.toFixed(1)}% of {formatBytes(memLimit)}
                          </p>
                        </div>
                        <div className="p-3 bg-green-500/20 rounded-lg">
                          <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                          </svg>
                        </div>
                      </div>
                      {statsHistory.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={statsHistory}>
                            <defs>
                              <linearGradient id="memGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <Area type="monotone" dataKey="memory" stroke="#10b981" fillOpacity={1} fill="url(#memGradient)" />
                            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                              formatter={(value) => [`${value}%`, 'Memory']}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="w-full bg-green-200 dark:bg-green-900/50 rounded-full h-4">
                          <div 
                            className="bg-green-600 dark:bg-green-400 h-4 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(memPercent, 100)}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Network I/O Chart */}
                  {statsHistory.length > 0 && (
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
                      <div className="flex items-center gap-2 mb-4">
                        <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                        </svg>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Network I/O</h3>
                      </div>
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={statsHistory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                          <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#6b7280" />
                          <YAxis tick={{ fontSize: 10 }} stroke="#6b7280" />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                            formatter={(value) => [formatBytes(value), '']}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="netRx" stroke="#3b82f6" strokeWidth={2} name="Received" dot={false} />
                          <Line type="monotone" dataKey="netTx" stroke="#10b981" strokeWidth={2} name="Transmitted" dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Block I/O Chart */}
                  {statsHistory.length > 0 && statsHistory[statsHistory.length - 1]?.blockRead > 0 && (
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-lg">
                      <div className="flex items-center gap-2 mb-4">
                        <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                        </svg>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Block I/O</h3>
                      </div>
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={statsHistory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                          <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#6b7280" />
                          <YAxis tick={{ fontSize: 10 }} stroke="#6b7280" />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                            formatter={(value) => [formatBytes(value), '']}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="blockRead" stroke="#8b5cf6" strokeWidth={2} name="Read" dot={false} />
                          <Line type="monotone" dataKey="blockWrite" stroke="#f59e0b" strokeWidth={2} name="Write" dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Current Stats Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Processes */}
                    <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-purple-600 dark:text-purple-400">Processes</p>
                          <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-1">
                            {stats.pids_stats?.current || 0}
                          </p>
                        </div>
                        <div className="p-3 bg-purple-500/20 rounded-lg">
                          <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Network Summary */}
                    {stats.networks && Object.keys(stats.networks).length > 0 && (
                      <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-900/30 dark:to-indigo-800/20 rounded-lg p-4 border border-indigo-200 dark:border-indigo-800">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">Networks</p>
                            <p className="text-2xl font-bold text-indigo-900 dark:text-indigo-100 mt-1">
                              {Object.keys(stats.networks).length}
                            </p>
                            <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-1">
                              {Object.values(stats.networks).reduce((sum, net) => sum + (net.rx_bytes || 0), 0) > 0 && 
                                formatBytes(Object.values(stats.networks).reduce((sum, net) => sum + (net.rx_bytes || 0), 0))}
                            </p>
                          </div>
                          <div className="p-3 bg-indigo-500/20 rounded-lg">
                            <svg className="w-6 h-6 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Memory Distribution Pie Chart */}
                    {memLimit > 0 && (
                      <div className="bg-gradient-to-br from-pink-50 to-pink-100 dark:from-pink-900/30 dark:to-pink-800/20 rounded-lg p-4 border border-pink-200 dark:border-pink-800">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium text-pink-600 dark:text-pink-400">Memory Distribution</p>
                        </div>
                        <ResponsiveContainer width="100%" height={120}>
                          <PieChart>
                            <Pie
                              data={[
                                { name: 'Used', value: memUsage },
                                { name: 'Free', value: Math.max(0, memLimit - memUsage) }
                              ]}
                              cx="50%"
                              cy="50%"
                              innerRadius={30}
                              outerRadius={50}
                              paddingAngle={2}
                              dataKey="value"
                            >
                              <Cell fill="#10b981" />
                              <Cell fill="#e5e7eb" />
                            </Pie>
                            <Tooltip formatter={(value) => formatBytes(value)} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="flex justify-center gap-4 mt-2 text-xs">
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 bg-green-500 rounded"></div>
                            <span className="text-gray-700 dark:text-gray-300">Used</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 bg-gray-300 dark:bg-gray-600 rounded"></div>
                            <span className="text-gray-700 dark:text-gray-300">Free</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Network Details */}
                  {stats.networks && Object.keys(stats.networks).length > 0 && (
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-lg">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Network Interfaces</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {Object.entries(stats.networks).map(([network, data]) => (
                          <div key={network} className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                            <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                              <svg className="w-4 h-4 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                              </svg>
                              {network}
                            </h4>
                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Received:</span>
                                <span className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">{formatBytes(data.rx_bytes || 0)}</span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Transmitted:</span>
                                <span className="font-mono text-sm font-semibold text-green-600 dark:text-green-400">{formatBytes(data.tx_bytes || 0)}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Raw Stats (Collapsible) */}
                  <details className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">
                      View Raw Statistics (JSON)
                    </summary>
                    <pre className="mt-4 text-xs bg-gray-900 dark:bg-black text-gray-100 p-4 rounded overflow-x-auto">
                      {JSON.stringify(stats, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 dark:border-primary-400"></div>
                  <p className="mt-4 text-gray-500 dark:text-gray-400">Loading stats...</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContainerDetails;
