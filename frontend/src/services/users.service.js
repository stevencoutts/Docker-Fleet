import api from './api';

export const usersService = {
  getAll: () => api.get('/api/v1/users'),
  getById: (id) => api.get(`/api/v1/users/${id}`),
  update: (id, data) => api.put(`/api/v1/users/${id}`, data),
  updatePassword: (id, password) => api.put(`/api/v1/users/${id}/password`, { password }),
  delete: (id) => api.delete(`/api/v1/users/${id}`),
};
