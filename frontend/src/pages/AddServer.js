import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { serversService } from '../services/servers.service';

const AddServer = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: '22',
    username: '',
    privateKey: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleTest = async () => {
    setError('');
    setTesting(true);
    try {
      // We'll need to create a temporary server object for testing
      // For now, just validate the form
      if (!formData.name || !formData.host || !formData.username || !formData.privateKey) {
        setError('Please fill in all required fields');
        return;
      }
      alert('Connection test feature will be available after server is created');
    } catch (error) {
      setError(error.response?.data?.error || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await serversService.create(formData);
      navigate(`/servers/${response.data.server.id}`);
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to create server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Add New Server</h1>
        <p className="mt-1 text-sm text-gray-600">Configure SSH access to a remote Docker host</p>
      </div>

      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6 space-y-6">
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="text-sm text-red-800">{error}</div>
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              Server Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              value={formData.name}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="My Docker Server"
            />
          </div>

          <div>
            <label htmlFor="host" className="block text-sm font-medium text-gray-700">
              Host / IP Address *
            </label>
            <input
              type="text"
              id="host"
              name="host"
              required
              value={formData.host}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="192.168.1.100 or example.com"
            />
          </div>

          <div>
            <label htmlFor="port" className="block text-sm font-medium text-gray-700">
              SSH Port *
            </label>
            <input
              type="number"
              id="port"
              name="port"
              required
              min="1"
              max="65535"
              value={formData.port}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700">
              SSH Username *
            </label>
            <input
              type="text"
              id="username"
              name="username"
              required
              value={formData.username}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="root or docker"
            />
          </div>

          <div>
            <label htmlFor="privateKey" className="block text-sm font-medium text-gray-700">
              SSH Private Key *
            </label>
            <textarea
              id="privateKey"
              name="privateKey"
              required
              rows="10"
              value={formData.privateKey}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
              placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
            />
            <p className="mt-2 text-sm text-gray-500">
              Paste your SSH private key here. It will be encrypted before storage.
            </p>
          </div>

          <div className="flex items-center justify-between pt-4">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || loading}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                type="submit"
                disabled={loading || testing}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create Server'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddServer;
