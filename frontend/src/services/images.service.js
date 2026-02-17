import api from './api';

export const imagesService = {
  getAll: (serverId) => api.get(`/api/v1/servers/${serverId}/images`),
  pull: (serverId, imageName) =>
    api.post(`/api/v1/servers/${serverId}/images/pull`, { imageName }),
  remove: (serverId, imageId, force = false) =>
    api.delete(`/api/v1/servers/${serverId}/images/${imageId}?force=${force}`),
};
