import axios from 'axios';

// Auto-detect API URL: use environment variable, or detect from current host
const getApiUrl = () => {
  // If explicitly set in environment, use it
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }
  
  // Otherwise, detect from current host
  // If accessing via remote host, use the same host for API
  const host = window.location.hostname;
  const protocol = window.location.protocol;
  
  // If it's localhost, use localhost:5020 (development)
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:5020';
  }
  
  // Otherwise, use the same host with port 5020
  return `${protocol}//${host}:5020`;
};

const api = axios.create({
  baseURL: getApiUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
