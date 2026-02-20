import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { SocketProvider } from './context/SocketContext';
import PrivateRoute from './components/PrivateRoute';
import AdminRoute from './components/AdminRoute';
import Layout from './layouts/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import AddServer from './pages/AddServer';
import ServerDetails from './pages/ServerDetails';
import ContainerDetails from './pages/ContainerDetails';
import Images from './pages/Images';
import Users from './pages/Users';
import Profile from './pages/Profile';
import MonitoringSettings from './pages/MonitoringSettings';
import BulkBackupSchedules from './pages/BulkBackupSchedules';
import BackupRestore from './pages/BackupRestore';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              path="/"
              element={
                <PrivateRoute>
                  <SocketProvider>
                    <Layout />
                  </SocketProvider>
                </PrivateRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="servers/new" element={<AddServer />} />
              <Route path="servers/:serverId/edit" element={<AddServer />} />
              <Route path="servers/:serverId" element={<ServerDetails />} />
              <Route path="servers/:serverId/containers/:containerId" element={<ContainerDetails />} />
              <Route path="servers/:serverId/images" element={<Images />} />
              <Route
                path="admin/users"
                element={
                  <AdminRoute>
                    <Users />
                  </AdminRoute>
                }
              />
              <Route path="profile" element={<Profile />} />
              <Route path="monitoring" element={<MonitoringSettings />} />
              <Route path="scheduled-backups" element={<BulkBackupSchedules />} />
              <Route path="backup-restore" element={<BackupRestore />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
