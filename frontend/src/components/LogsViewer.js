import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext';

const LogsViewer = ({ serverId, containerId, tail = 100 }) => {
  const [logs, setLogs] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const logsEndRef = useRef(null);
  const socket = useSocket();

  useEffect(() => {
    if (!socket || !containerId) return;

    const handleLogsData = (data) => {
      if (data.containerId === containerId) {
        setLogs((prev) => prev + data.data);
      }
    };

    const handleLogsError = (error) => {
      if (error.containerId === containerId) {
        console.error('Logs error:', error.error);
      }
    };

    socket.on('logs:data', handleLogsData);
    socket.on('logs:error', handleLogsError);

    // Start streaming
    setIsStreaming(true);
    socket.emit('stream:logs', { serverId, containerId, tail });

    return () => {
      socket.off('logs:data', handleLogsData);
      socket.off('logs:error', handleLogsError);
      socket.emit('stream:logs:stop');
      setIsStreaming(false);
    };
  }, [socket, serverId, containerId, tail]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const clearLogs = () => {
    setLogs('');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Container Logs</span>
          {isStreaming && (
            <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            Auto-scroll
          </label>
          <button
            onClick={clearLogs}
            className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex-1 logs-container overflow-y-auto">
        <div className="log-line">{logs || 'No logs available'}</div>
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default LogsViewer;
