import api from './api';

export const updateOverviewService = {
  getOverview: () => api.get('/api/v1/update-overview'),
  runCheck: () => api.post('/api/v1/update-overview/check', {}, { timeout: 300000 }),
  removeContainer: (serverId, containerId) =>
    api.patch('/api/v1/update-overview/remove-container', { serverId, containerId }),
};
