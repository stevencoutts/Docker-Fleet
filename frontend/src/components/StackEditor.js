import React, { useState } from 'react';
import { stacksService } from '../services/stacks.service';
import ServerPicker from './ServerPicker';

let _uidCounter = 0;
const nextUid = () => ++_uidCounter;

export default function StackEditor({ stack, onClose, onSaved }) {
  const isEdit = !!stack;
  const [name, setName] = useState(stack?.name || '');
  const [serverId, setServerId] = useState(stack?.serverId || '');
  const [composeYaml, setComposeYaml] = useState(stack?.composeYaml || '');
  const [env, setEnv] = useState(() => (stack?.env || []).map((e) => ({ ...e, _uid: nextUid() })));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const setRow = (i, patch) => setEnv((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setEnv((rows) => [...rows, { key: '', value: '', isSecret: false, _uid: nextUid() }]);
  const delRow = (i) => setEnv((rows) => rows.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    setError(null);
    const envPayload = env.map(({ key, value, isSecret }) => ({ key, value, isSecret }));
    try {
      if (isEdit) {
        await stacksService.update(stack.id, { composeYaml, env: envPayload });
      } else {
        await stacksService.create({ serverId, name, composeYaml, env: envPayload });
      }
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose}></div>
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {isEdit ? `Edit ${stack.name}` : 'New stack'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
              aria-label="Close"
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

          {!isEdit && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  className="block w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-stack"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Server
                </label>
                <ServerPicker value={serverId} onChange={setServerId} className="block w-full" />
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Compose YAML
            </label>
            <textarea
              className="block w-full px-2 py-1.5 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500 h-48"
              value={composeYaml}
              onChange={(e) => setComposeYaml(e.target.value)}
              placeholder={'services:\n  web:\n    image: nginx'}
            />
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Environment</span>
              <button
                onClick={addRow}
                className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
              >
                + Add
              </button>
            </div>

            {env.length > 0 && (
              <div className="space-y-2">
                {env.map((r, i) => (
                  <div key={r._uid} className="flex gap-2 items-center">
                    <input
                      type="text"
                      className="flex-1 px-2 py-1.5 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      placeholder="KEY"
                      value={r.key}
                      onChange={(e) => setRow(i, { key: e.target.value })}
                    />
                    <input
                      type={r.isSecret ? 'password' : 'text'}
                      className="flex-1 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                      placeholder={r.isSecret ? '•••• (blank = keep)' : 'value'}
                      value={r.value ?? ''}
                      onChange={(e) => setRow(i, { value: e.target.value })}
                    />
                    <label className="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-1 whitespace-nowrap">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={!!r.isSecret}
                        onChange={(e) => setRow(i, { isSecret: e.target.checked })}
                      />
                      secret
                    </label>
                    <button
                      onClick={() => delRow(i)}
                      className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm"
                      aria-label="Remove row"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {env.length === 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 italic">No environment variables. Click + Add to add one.</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-600">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 dark:bg-primary-500 rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
