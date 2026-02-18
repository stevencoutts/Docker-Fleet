import api from './api';

export const monitoringService = {
  getSettings: async () => {
    const response = await api.get('/api/v1/monitoring');
    return response.data;
  },

  updateSettings: async (settings) => {
    const response = await api.put('/api/v1/monitoring', settings);
    return response.data;
  },
};
