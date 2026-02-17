import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { serversService } from '../services/servers.service';
import { containersService } from '../services/containers.service';

const Dashboard = () => {
  const [servers, setServers] = useState([]);
  const [containers, setContainers] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const serversResponse = await serversService.getAll();
      const serversData = serversResponse.data.servers;
      setServers(serversData);

      // Fetch containers for each server
      const containersData = {};
      for (const server of serversData) {
        try {
          const containersResponse = await containersService.getAll(server.id, { all: 'true' });
          containersData[server.id] = containersResponse.data.containers;
        } catch (error) {
          console.error(`Failed to fetch containers for server ${server.id}:`, error);
          containersData[server.id] = [];
        }
      }
      setContainers(containersData);
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

  // Calculate totals
  const totalServers = servers.length;
  const totalContainers = Object.values(containers).reduce((sum, serverContainers) => sum + serverContainers.length, 0);
  const totalRunning = Object.values(containers).reduce((sum, serverContainers) => {
    return sum + serverContainers.filter((c) => {
      const status = c.Status || c['.Status'] || '';
      return status.toLowerCase().includes('up') || status.toLowerCase().includes('running');
    }).length;
  }, 0);

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Overview of all servers and containers</p>
      </div>

      {/* Summary Cards */}
      {servers.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
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
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Running Containers</dt>
                    <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">{totalRunning}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg transition-colors">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-gray-500 rounded-md p-3">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Containers</dt>
                    <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">{totalContainers}</dd>
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
            const runningCount = serverContainers.filter((c) => {
              const status = c.Status || c['.Status'] || '';
              return status.toLowerCase().includes('up') || status.toLowerCase().includes('running');
            }).length;

            return (
              <Link
                key={server.id}
                to={`/servers/${server.id}`}
                className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1"
              >
                <div className="p-5">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                        <span className="text-primary-600 font-bold">
                          {server.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                          {server.name}
                        </dt>
                        <dd className="text-lg font-medium text-gray-900 dark:text-gray-100">{server.host}</dd>
                      </dl>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Containers</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {runningCount} / {serverContainers.length} running
                      </span>
                    </div>
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
