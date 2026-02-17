import api from './api';

export const serversService = {
  getAll: () => api.get('/api/v1/servers'),
  getById: (id) => api.get(`/api/v1/servers/${id}`),
  create: (data) => api.post('/api/v1/servers', data),
  update: (id, data) => api.put(`/api/v1/servers/${id}`, data),
  delete: (id) => api.delete(`/api/v1/servers/${id}`),
  testConnection: (id) => api.post(`/api/v1/servers/${id}/test`),
};
