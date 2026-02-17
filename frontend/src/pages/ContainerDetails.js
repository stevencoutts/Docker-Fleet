import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { containersService } from '../services/containers.service';
import LogsViewer from '../components/LogsViewer';

const ContainerDetails = () => {
  const { serverId, containerId } = useParams();
  const [container, setContainer] = useState(null);
  const [stats, setStats] = useState(null);
  const [activeTab, setActiveTab] = useState('details');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContainerDetails();
  }, [serverId, containerId]);

  useEffect(() => {
    if (activeTab === 'stats' && containerId) {
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
      setStats(response.data.stats);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!container) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Container not found</p>
        <Link to={`/servers/${serverId}`} className="text-primary-600 hover:text-primary-700">
          Back to server
        </Link>
      </div>
    );
  }

  const isRunning = container.State?.Status === 'running' || container.State?.Running;

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6">
        <Link
          to={`/servers/${serverId}`}
          className="text-sm text-primary-600 hover:text-primary-700 mb-2 inline-block"
        >
          ← Back to server
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          {container.Name?.replace('/', '') || containerId.substring(0, 12)}
        </h1>
        <p className="mt-1 text-sm text-gray-600">{container.Config?.Image}</p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => handleAction(isRunning ? 'stop' : 'start')}
          className={`px-4 py-2 text-sm rounded-lg ${
            isRunning
              ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
              : 'bg-green-100 text-green-800 hover:bg-green-200'
          }`}
        >
          {isRunning ? 'Stop' : 'Start'}
        </button>
        <button
          onClick={() => handleAction('restart')}
          className="px-4 py-2 text-sm bg-blue-100 text-blue-800 rounded-lg hover:bg-blue-200"
        >
          Restart
        </button>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {['details', 'logs', 'stats'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  activeTab === tab
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'details' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500">Status</h3>
                <p className="mt-1 text-sm text-gray-900">
                  {container.State?.Status || 'Unknown'}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500">Image</h3>
                <p className="mt-1 text-sm text-gray-900">{container.Config?.Image}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500">Created</h3>
                <p className="mt-1 text-sm text-gray-900">
                  {new Date(container.Created).toLocaleString()}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500">Ports</h3>
                <div className="mt-1 text-sm text-gray-900">
                  {container.NetworkSettings?.Ports ? (
                    <pre className="bg-gray-50 p-2 rounded">
                      {JSON.stringify(container.NetworkSettings.Ports, null, 2)}
                    </pre>
                  ) : (
                    'No ports exposed'
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500">Environment</h3>
                <div className="mt-1 text-sm text-gray-900">
                  {container.Config?.Env ? (
                    <pre className="bg-gray-50 p-2 rounded max-h-48 overflow-y-auto">
                      {container.Config.Env.join('\n')}
                    </pre>
                  ) : (
                    'No environment variables'
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="h-96">
              <LogsViewer serverId={serverId} containerId={containerId} />
            </div>
          )}

          {activeTab === 'stats' && (
            <div>
              {stats ? (
                <pre className="bg-gray-50 p-4 rounded overflow-x-auto">
                  {JSON.stringify(stats, null, 2)}
                </pre>
              ) : (
                <p className="text-gray-500">Loading stats...</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContainerDetails;
