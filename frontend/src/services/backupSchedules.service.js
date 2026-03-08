import api from './api';

export const backupSchedulesService = {
  /** List all backup jobs (each job has many entries). Optional: ?serverId= &containerName= */
  getAll: (params = {}) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/api/v1/backup-schedules${queryParams ? `?${queryParams}` : ''}`);
  },
  /** Create one job with many entries (same schedule for all) */
  createBulk: (body) =>
    api.post('/api/v1/backup-schedules/bulk', body),
  /** Update a job's container entries (replace all). Body: { entries: [{ serverId, containerName }, ...] } */
  updateJobEntries: (jobId, body) =>
    api.put(`/api/v1/backup-schedules/${jobId}/entries`, body),
  /** Delete a backup job and all its entries */
  deleteJob: (jobId) =>
    api.delete(`/api/v1/backup-schedules/${jobId}`),
};
