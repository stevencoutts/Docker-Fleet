import api, { getApiUrl } from './api';

// Enable/sync run apt-get and certbot over SSH; can take 2–5+ minutes
const LONG_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Enable Public WWW with streaming progress. Calls onProgress({ step, message, status }) for each step.
 * Returns { success } or throws. Use for real-time step feedback in the UI.
 */
export async function enableWithProgress(serverId, onProgress) {
  const token = localStorage.getItem('token');
  const url = `${getApiUrl()}/api/v1/servers/${serverId}/public-www/enable?stream=1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.details || err.error || res.statusText);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
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
          if (data.step && onProgress) onProgress(data);
          if (data.step === 'done' && data.success === false) throw new Error(data.error || 'Enable failed');
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
  return { success: true };
}

/** Request DNS-01 challenge: returns { recordName, recordValue, domain, baseDomain }. Add TXT record, then call continueDnsCert. */
export function requestDnsCert(serverId, { domain, wildcard }) {
  return api.post(`/api/v1/servers/${serverId}/public-www/request-dns-cert`, { domain, wildcard }, { timeout: 90000 });
}

/** After adding the TXT record, call this to complete issuance and reload nginx. */
export function continueDnsCert(serverId, { domain }) {
  return api.post(`/api/v1/servers/${serverId}/public-www/continue-dns-cert`, { domain }, { timeout: 150000 });
}

export function getCertificates(serverId) {
  return api.get(`/api/v1/servers/${serverId}/public-www/certificates`);
}

export function getNginxConfig(serverId) {
  return api.get(`/api/v1/servers/${serverId}/public-www/nginx-config`);
}

export const publicWwwService = {
  getProxyRoutes: (serverId) => api.get(`/api/v1/servers/${serverId}/proxy-routes`),
  getCertificates,
  getNginxConfig,
  addProxyRoute: (serverId, data) => api.post(`/api/v1/servers/${serverId}/proxy-routes`, data),
  deleteProxyRoute: (serverId, routeId) => api.delete(`/api/v1/servers/${serverId}/proxy-routes/${routeId}`),
  enable: (serverId) => api.post(`/api/v1/servers/${serverId}/public-www/enable`, {}, { timeout: LONG_TIMEOUT_MS }),
  enableWithProgress,
  disable: (serverId) => api.post(`/api/v1/servers/${serverId}/public-www/disable`),
  sync: (serverId) => api.post(`/api/v1/servers/${serverId}/public-www/sync`, {}, { timeout: LONG_TIMEOUT_MS }),
  requestDnsCert,
  continueDnsCert,
};
