import api, { getApiUrl } from './api';

const TAILSCALE_ENABLE_TIMEOUT_MS = 320000;

/**
 * Enable Tailscale with streaming progress. Calls onProgress({ step, message, status }) for each step.
 * Returns { server, message, imported } or throws. Use for real-time step feedback in the UI.
 * @param {string} serverId
 * @param {string} [authKey] - Auth key to use; if omitted and server has stored key (not expired), backend uses it.
 * @param {function} onProgress
 * @param {{ storeAuthKey?: boolean }} [options] - If true, store the auth key for 90 days (when authKey is provided).
 */
export async function tailscaleEnableWithProgress(serverId, authKey, onProgress, options = {}) {
  const token = localStorage.getItem('token');
  const url = `${getApiUrl()}/api/v1/servers/${serverId}/tailscale/enable?stream=1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      authKey: authKey || undefined,
      storeAuthKey: options.storeAuthKey === true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    let err;
    try { err = JSON.parse(text); } catch (_) { err = {}; }
    throw new Error(err.error || err.details || text || res.statusText);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult = null;
  let finalError = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.step && data.step !== 'done' && onProgress) onProgress(data);
          if (data.step === 'done') {
            if (data.success) {
              finalResult = { server: data.server, message: data.message, imported: data.imported };
            } else {
              const err = new Error(data.error || 'Enable failed');
              err.requireAuthKey = data.requireAuthKey;
              err.details = data.details;
              finalError = err;
            }
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
  if (finalError) throw finalError;
  if (!finalResult) throw new Error('No response from server');
  return finalResult;
}

export const serversService = {
  getAll: () => api.get('/api/v1/servers'),
  getById: (id) => api.get(`/api/v1/servers/${id}`),
  create: (data) => api.post('/api/v1/servers', data),
  update: (id, data) => api.put(`/api/v1/servers/${id}`, data),
  delete: (id) => api.delete(`/api/v1/servers/${id}`),
  testConnection: (id) => api.post(`/api/v1/servers/${id}/test`),
  tailscaleEnable: (id, authKey, options = {}) =>
    api.post(`/api/v1/servers/${id}/tailscale/enable`, { authKey, storeAuthKey: options.storeAuthKey }, { timeout: options.timeout ?? TAILSCALE_ENABLE_TIMEOUT_MS }),
  tailscaleDisable: (id) => api.post(`/api/v1/servers/${id}/tailscale/disable`),
  clearTailscaleStoredKey: (id) => api.delete(`/api/v1/servers/${id}/tailscale/stored-key`),
  tailscaleStatus: (id) => api.get(`/api/v1/servers/${id}/tailscale/status`),
};
