import api from './api';

const groupingService = {
  getAll: () => {
    return api.get('/api/v1/grouping');
  },

  getById: (id) => {
    return api.get(`/api/v1/grouping/${id}`);
  },

  create: (data) => {
    return api.post('/api/v1/grouping', data);
  },

  update: (id, data) => {
    return api.put(`/api/v1/grouping/${id}`, data);
  },

  remove: (id) => {
    return api.delete(`/api/v1/grouping/${id}`);
  },
};

export default groupingService;
