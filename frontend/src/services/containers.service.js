import api from './api';

export const containersService = {
  getAll: (serverId, params = {}) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/api/v1/servers/${serverId}/containers?${queryParams}`);
  },
  getById: (serverId, containerId) =>
    api.get(`/api/v1/servers/${serverId}/containers/${containerId}`),
  getLogs: (serverId, containerId, params = {}) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/api/v1/servers/${serverId}/containers/${containerId}/logs?${queryParams}`);
  },
  getStats: (serverId, containerId) =>
    api.get(`/api/v1/servers/${serverId}/containers/${containerId}/stats`),
  start: (serverId, containerId) =>
    api.post(`/api/v1/servers/${serverId}/containers/${containerId}/start`),
  stop: (serverId, containerId) =>
    api.post(`/api/v1/servers/${serverId}/containers/${containerId}/stop`),
  restart: (serverId, containerId) =>
    api.post(`/api/v1/servers/${serverId}/containers/${containerId}/restart`),
  remove: (serverId, containerId, force = false) =>
    api.delete(`/api/v1/servers/${serverId}/containers/${containerId}?force=${force}`),
  updateRestartPolicy: (serverId, containerId, policy) =>
    api.put(`/api/v1/servers/${serverId}/containers/${containerId}/restart-policy`, { policy }),
};
