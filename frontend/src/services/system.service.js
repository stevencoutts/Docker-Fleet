import api from './api';

export const systemService = {
  getHostInfo: (serverId) => api.get(`/api/v1/servers/${serverId}/host-info`),
};
