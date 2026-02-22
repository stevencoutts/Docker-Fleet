import api from './api';

export const containersService = {
  getAll: (serverId, params = {}) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/api/v1/servers/${serverId}/containers?${queryParams}`);
  },
  getById: (serverId, containerId) =>
    api.get(`/api/v1/servers/${serverId}/containers/${containerId}`, { timeout: 20000 }),
  getUpdateStatus: (serverId, containerId) =>
    api.get(`/api/v1/servers/${serverId}/containers/${containerId}/update-status`, { timeout: 30000 }),
  pullAndUpdate: (serverId, containerId) =>
    api.post(`/api/v1/servers/${serverId}/containers/${containerId}/pull-and-update`, {}, { timeout: 360000 }),
  recreate: (serverId, containerId, body = {}) =>
    api.post(`/api/v1/servers/${serverId}/containers/${containerId}/recreate`, body, { timeout: 120000 }),
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
  executeCommand: (serverId, containerId, command, shell = '/bin/sh') =>
    api.post(`/api/v1/servers/${serverId}/containers/${containerId}/execute`, { command, shell }),
  getSnapshots: (serverId, containerId) =>
    api.get(`/api/v1/servers/${serverId}/containers/${containerId}/snapshots`),
  restoreSnapshot: (serverId, imageName, containerName, options = {}) =>
    api.post(`/api/v1/servers/${serverId}/containers/restore`, {
      imageName,
      containerName,
      ...options,
    }, { timeout: 300000 }),
  deploy: (serverId, body) =>
    api.post(`/api/v1/servers/${serverId}/containers/deploy`, body, { timeout: 120000 }),
  getBackupSchedules: (serverId, params = {}) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/api/v1/servers/${serverId}/backup-schedules${queryParams ? `?${queryParams}` : ''}`);
  },
  createBackupSchedule: (serverId, body) =>
    api.post(`/api/v1/servers/${serverId}/backup-schedules`, body),
  updateBackupSchedule: (serverId, scheduleId, body) =>
    api.put(`/api/v1/servers/${serverId}/backup-schedules/${scheduleId}`, body),
  deleteBackupSchedule: (serverId, scheduleId) =>
    api.delete(`/api/v1/servers/${serverId}/backup-schedules/${scheduleId}`),
  createSnapshot: async (serverId, containerId, imageName, tag = 'snapshot', download = false) => {
    const config = {
      responseType: download ? 'blob' : 'json',
    };
    
    const response = await api.post(
      `/api/v1/servers/${serverId}/containers/${containerId}/snapshot`,
      { imageName, tag, download },
      config
    );
    
    // If download was requested and response is a blob, trigger download
    if (download && response.data instanceof Blob) {
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const contentDisposition = response.headers['content-disposition'];
      let filename = `${imageName}-${tag}.tar`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      return { success: true, filename, data: response.data };
    }
    
    // Otherwise return the JSON response
    return response;
  },
};
