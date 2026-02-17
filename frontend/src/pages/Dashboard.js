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

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">Overview of all servers and containers</p>
      </div>

      {servers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No servers configured</p>
          <Link
            to="/servers/new"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
          >
            Add Server
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => {
            const serverContainers = containers[server.id] || [];
            const runningCount = serverContainers.filter((c) =>
              c.Status?.includes('Up') || c.Status?.includes('running')
            ).length;

            return (
              <Link
                key={server.id}
                to={`/servers/${server.id}`}
                className="bg-white overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow"
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
                        <dt className="text-sm font-medium text-gray-500 truncate">
                          {server.name}
                        </dt>
                        <dd className="text-lg font-medium text-gray-900">{server.host}</dd>
                      </dl>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Containers</span>
                      <span className="font-medium text-gray-900">
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
