import api, { getApiUrl } from './api';

export const appConfigService = {
  get: () => api.get('/api/v1/app-config'),
  put: (settings) => api.put('/api/v1/app-config', { settings }),
  getEnvFile: async () => {
    const token = localStorage.getItem('token');
    const url = `${getApiUrl()}/api/v1/app-config/env-file`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(res.statusText);
    return res.text();
  },
};
