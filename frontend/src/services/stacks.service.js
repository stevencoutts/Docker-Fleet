import api from './api';

export const stacksService = {
  list: (serverId) => api.get('/api/v1/stacks', { params: serverId ? { serverId } : {} }),
  get: (id) => api.get(`/api/v1/stacks/${id}`),
  create: (payload) => api.post('/api/v1/stacks', payload),
  update: (id, payload) => api.put(`/api/v1/stacks/${id}`, payload),
  remove: (id, down = false) => api.delete(`/api/v1/stacks/${id}`, { params: { down } }),
  deploy: (id, pull = false) => api.post(`/api/v1/stacks/${id}/deploy`, null, { params: { pull } }),
  down: (id) => api.post(`/api/v1/stacks/${id}/down`),
  restart: (id) => api.post(`/api/v1/stacks/${id}/restart`),
  discover: (serverId) => api.get(`/api/v1/servers/${serverId}/stacks/discover`),
  importStacks: (serverId, projects) => api.post(`/api/v1/servers/${serverId}/stacks/import`, { projects }),
};
