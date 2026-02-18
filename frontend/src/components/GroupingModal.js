import React, { useState, useEffect } from 'react';
import groupingService from '../services/grouping.service';

const GroupingModal = ({ isOpen, onClose, onRulesUpdated }) => {
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

  useEffect(() => {
    if (isOpen) {
      fetchRules();
    }
  }, [isOpen]);

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
      if (onRulesUpdated) onRulesUpdated();
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
      if (onRulesUpdated) onRulesUpdated();
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to delete grouping rule');
    }
  };

  const handleCancel = () => {
    setEditingRule(null);
    setFormData({ groupName: '', pattern: '', patternType: 'prefix', enabled: true, sortOrder: 0 });
    setError('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>

        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div className="inline-block align-bottom bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
          <div className="bg-white dark:bg-gray-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Container Grouping Rules</h3>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            )}

            {/* Form */}
            <div className="mb-6 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                {editingRule ? 'Edit Grouping Rule' : 'Add New Grouping Rule'}
              </h4>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="groupName" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                      Group Name *
                    </label>
                    <input
                      type="text"
                      id="groupName"
                      required
                      value={formData.groupName}
                      onChange={(e) => setFormData({ ...formData, groupName: e.target.value })}
                      className="mt-1 block w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      placeholder="e.g., ClipChef"
                    />
                  </div>
                  <div>
                    <label htmlFor="pattern" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                      Pattern *
                    </label>
                    <input
                      type="text"
                      id="pattern"
                      required
                      value={formData.pattern}
                      onChange={(e) => setFormData({ ...formData, pattern: e.target.value })}
                      className="mt-1 block w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      placeholder="e.g., clipchef-"
                    />
                  </div>
                  <div>
                    <label htmlFor="patternType" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                      Pattern Type *
                    </label>
                    <select
                      id="patternType"
                      required
                      value={formData.patternType}
                      onChange={(e) => setFormData({ ...formData, patternType: e.target.value })}
                      className="mt-1 block w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="prefix">Prefix (starts with)</option>
                      <option value="suffix">Suffix (ends with)</option>
                      <option value="contains">Contains</option>
                      <option value="regex">Regular Expression</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="sortOrder" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                      Sort Order
                    </label>
                    <input
                      type="number"
                      id="sortOrder"
                      value={formData.sortOrder}
                      onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                      className="mt-1 block w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
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
                  <label htmlFor="enabled" className="ml-2 text-xs text-gray-700 dark:text-gray-300">
                    Enabled
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 dark:bg-primary-500 rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors"
                  >
                    {editingRule ? 'Update Rule' : 'Add Rule'}
                  </button>
                  {editingRule && (
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Rules List */}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-600">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Existing Rules</h4>
              </div>
              {loading ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
                </div>
              ) : rules.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400">No grouping rules configured</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-600 max-h-64 overflow-y-auto">
                  {rules.map((rule) => (
                    <div key={rule.id} className="px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-600/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h5 className="text-xs font-semibold text-gray-900 dark:text-gray-100">{rule.groupName}</h5>
                            {!rule.enabled && (
                              <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                                Disabled
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                            Pattern: <span className="font-mono">{rule.pattern}</span> ({rule.patternType})
                          </p>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                            Sort Order: {rule.sortOrder}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEdit(rule)}
                            className="px-2 py-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(rule.id)}
                            className="px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
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
          <div className="bg-gray-50 dark:bg-gray-700/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              onClick={onClose}
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-primary-600 dark:bg-primary-500 text-base font-medium text-white hover:bg-primary-700 dark:hover:bg-primary-600 sm:ml-3 sm:w-auto sm:text-sm transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GroupingModal;
