import React, { useState, useEffect } from 'react';
import groupingService from '../services/grouping.service';
import { useRefetchOnVisible } from '../hooks/useRefetchOnVisible';

const Grouping = () => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingRule, setEditingRule] = useState(null);
  const [formData, setFormData] = useState({
    groupName: '',
    pattern: '',
    patternType: 'prefix',
    enabled: true,
    sortOrder: 0,
  });
  const [error, setError] = useState('');

  const fetchRules = async () => {
    try {
      setLoading(true);
      const response = await groupingService.getAll();
      setRules(response.data.rules || []);
    } catch (error) {
      console.error('Failed to fetch grouping rules:', error);
      setError('Failed to load grouping rules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  useRefetchOnVisible(fetchRules);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      if (editingRule) {
        await groupingService.update(editingRule.id, formData);
      } else {
        await groupingService.create(formData);
      }
      setEditingRule(null);
      setFormData({ groupName: '', pattern: '', patternType: 'prefix', enabled: true, sortOrder: 0 });
      fetchRules();
    } catch (error) {
      setError(error.response?.data?.error || error.response?.data?.details || 'Failed to save grouping rule');
    }
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setFormData({
      groupName: rule.groupName,
      pattern: rule.pattern,
      patternType: rule.patternType,
      enabled: rule.enabled,
      sortOrder: rule.sortOrder,
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this grouping rule?')) {
      return;
    }

    try {
      await groupingService.remove(id);
      fetchRules();
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to delete grouping rule');
    }
  };

  const handleCancel = () => {
    setEditingRule(null);
    setFormData({ groupName: '', pattern: '', patternType: 'prefix', enabled: true, sortOrder: 0 });
    setError('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-gray-700 dark:text-gray-300">Loading...</div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Container Grouping Rules</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Configure rules to automatically group containers by name patterns
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Form */}
      <div className="mb-6 bg-white dark:bg-gray-800 shadow dark:shadow-gray-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {editingRule ? 'Edit Grouping Rule' : 'Add New Grouping Rule'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="groupName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Group Name *
              </label>
              <input
                type="text"
                id="groupName"
                required
                value={formData.groupName}
                onChange={(e) => setFormData({ ...formData, groupName: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="e.g., ClipChef"
              />
            </div>
            <div>
              <label htmlFor="pattern" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Pattern *
              </label>
              <input
                type="text"
                id="pattern"
                required
                value={formData.pattern}
                onChange={(e) => setFormData({ ...formData, pattern: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="e.g., clipchef-"
              />
            </div>
            <div>
              <label htmlFor="patternType" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Pattern Type *
              </label>
              <select
                id="patternType"
                required
                value={formData.patternType}
                onChange={(e) => setFormData({ ...formData, patternType: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="prefix">Prefix (starts with)</option>
                <option value="suffix">Suffix (ends with)</option>
                <option value="contains">Contains</option>
                <option value="regex">Regular Expression</option>
              </select>
            </div>
            <div>
              <label htmlFor="sortOrder" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Sort Order
              </label>
              <input
                type="number"
                id="sortOrder"
                value={formData.sortOrder}
                onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="0"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Lower numbers appear first</p>
            </div>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="enabled"
              checked={formData.enabled}
              onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
              className="rounded text-primary-600 dark:text-primary-400 focus:ring-primary-500 dark:focus:ring-primary-400"
            />
            <label htmlFor="enabled" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
              Enabled
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 dark:bg-primary-500 rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors"
            >
              {editingRule ? 'Update Rule' : 'Add Rule'}
            </button>
            {editingRule && (
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Rules List */}
      <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Existing Rules</h2>
        </div>
        {rules.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-gray-500 dark:text-gray-400">No grouping rules configured</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {rules.map((rule) => (
              <div key={rule.id} className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{rule.groupName}</h3>
                      {!rule.enabled && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      Pattern: <span className="font-mono">{rule.pattern}</span> ({rule.patternType})
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                      Sort Order: {rule.sortOrder}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit(rule)}
                      className="px-3 py-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Grouping;
