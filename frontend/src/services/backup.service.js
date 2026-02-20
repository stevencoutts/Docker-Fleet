import api from './api';

export const backupService = {
  /** Export backup (returns JSON). Download as file in the UI. */
  export: () => api.get('/api/v1/backup/export'),
  /** Import backup. Body: backup JSON object. */
  import: (data) => api.post('/api/v1/backup/import', data, { timeout: 60000 }),
};
