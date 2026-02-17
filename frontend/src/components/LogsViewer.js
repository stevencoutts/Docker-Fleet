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
          {isStreaming && (
            <span className="px-2 py-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded-full flex items-center gap-1">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded text-primary-600 dark:text-primary-400 focus:ring-primary-500 dark:focus:ring-primary-400"
            />
            Auto-scroll
          </label>
          <button
            onClick={clearLogs}
            className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex-1 logs-container overflow-y-auto rounded border border-gray-200 dark:border-gray-700">
        <div className="log-line p-2">{logs || 'No logs available. Waiting for logs...'}</div>
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

export default LogsViewer;
