import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { serversService } from '../services/servers.service';

const AddServer = () => {
  const navigate = useNavigate();
  const { serverId } = useParams();
  const isEditMode = !!serverId;
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: '22',
    username: '',
    privateKey: '',
    publicHost: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);

  // Load server data if editing
  useEffect(() => {
    if (isEditMode) {
      setFetching(true);
      serversService.getById(serverId)
        .then(response => {
          const server = response.data.server;
          setFormData({
            name: server.name || '',
            host: server.host || '',
            port: server.port?.toString() || '22',
            username: server.username || '',
            privateKey: '', // Don't pre-fill private key for security
            publicHost: server.publicHost || '',
          });
        })
        .catch(error => {
          setError(error.response?.data?.error || 'Failed to load server');
          console.error('Failed to load server:', error);
        })
        .finally(() => {
          setFetching(false);
        });
    }
  }, [serverId, isEditMode]);

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
      if (isEditMode) {
        // Update existing server
        // Only send fields that can be updated (don't send privateKey if it's empty)
        const updateData = {
          name: formData.name,
          host: formData.host,
          port: formData.port,
          username: formData.username,
          publicHost: formData.publicHost?.trim() || '',
        };
        // Only include privateKey if it was changed
        if (formData.privateKey.trim()) {
          updateData.privateKey = formData.privateKey;
        }
        await serversService.update(serverId, updateData);
        navigate(`/servers/${serverId}`);
      } else {
        // Create new server
        const response = await serversService.create(formData);
        navigate(`/servers/${response.data.server.id}`);
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.response?.data?.details || (isEditMode ? 'Failed to update server' : 'Failed to create server');
      const errorDetails = error.response?.data?.details ? `: ${error.response.data.details}` : '';
      setError(errorMessage + errorDetails);
      console.error(`Server ${isEditMode ? 'update' : 'creation'} error:`, error.response?.data || error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{isEditMode ? 'Edit Server' : 'Add New Server'}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{isEditMode ? 'Update server configuration' : 'Configure SSH access to a remote Docker host'}</p>
      </div>

      <div className="max-w-2xl">
        {fetching ? (
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Loading server details...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 space-y-6">
            {error && (
              <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
                <div className="text-sm text-red-800 dark:text-red-200">{error}</div>
              </div>
            )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Server Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              value={formData.name}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="My Docker Server"
            />
          </div>

          <div>
            <label htmlFor="host" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Host / IP Address or DNS Name *
            </label>
            <input
              type="text"
              id="host"
              name="host"
              required
              value={formData.host}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="192.168.1.100, example.com, or server.example.com"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              You can use either an IP address (e.g., 192.168.1.100) or a DNS name (e.g., server.example.com, kore.couttsnet.com)
            </p>
          </div>

          <div>
            <label htmlFor="publicHost" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Public IP / host (optional)
            </label>
            <input
              type="text"
              id="publicHost"
              name="publicHost"
              value={formData.publicHost}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="e.g. 100.67.238.27 or vps.example.com"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Shown on the dashboard in brackets as the public address this server is reached from (e.g. when Host is a private IP)
            </p>
          </div>

          <div>
            <label htmlFor="port" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              SSH Username *
            </label>
            <input
              type="text"
              id="username"
              name="username"
              required
              value={formData.username}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="root or docker"
            />
          </div>

          <div>
            <label htmlFor="privateKey" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              SSH Private Key {isEditMode ? '(leave blank to keep existing)' : '*'}
            </label>
            <textarea
              id="privateKey"
              name="privateKey"
              required={!isEditMode}
              rows="10"
              value={formData.privateKey}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
              placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
            />
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {isEditMode ? (
                <>Leave blank to keep the existing private key. Only paste a new key if you want to change it.</>
              ) : (
                <>
                  Paste your SSH <strong>private key</strong> here (not the public key). 
                  Private keys typically start with "-----BEGIN OPENSSH PRIVATE KEY-----" or "-----BEGIN RSA PRIVATE KEY-----". 
                  It will be encrypted before storage.
                </>
              )}
            </p>
            {!isEditMode && (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                💡 Tip: Your private key is usually in <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">~/.ssh/id_rsa</code> or <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">~/.ssh/id_ed25519</code>
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-4">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || loading}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                type="submit"
                disabled={loading || testing || fetching}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-white bg-primary-600 dark:bg-primary-500 hover:bg-primary-700 dark:hover:bg-primary-600 disabled:opacity-50 transition-colors"
              >
                {loading ? (isEditMode ? 'Updating...' : 'Creating...') : (isEditMode ? 'Update Server' : 'Create Server')}
              </button>
            </div>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};

export default AddServer;
