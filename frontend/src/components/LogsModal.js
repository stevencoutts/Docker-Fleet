import React from 'react';
import LogsViewer from './LogsViewer';

const LogsModal = ({ isOpen, onClose, serverId, containerId, containerName }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-gray-500 dark:bg-gray-900 bg-opacity-75 dark:bg-opacity-75 transition-opacity"
        onClick={onClose}
      ></div>

      {/* Modal */}
      <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
        <div className="relative transform overflow-hidden rounded-lg bg-white dark:bg-gray-800 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-4xl w-full">
          {/* Header */}
          <div className="bg-white dark:bg-gray-800 px-4 pb-4 pt-5 sm:p-6 sm:pb-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold leading-6 text-gray-900 dark:text-gray-100" id="modal-title">
                  Container Logs: {containerName}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Live streaming logs for container {containerId.substring(0, 12)}
                </p>
              </div>
              <button
                onClick={onClose}
                className="rounded-md bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                <span className="sr-only">Close</span>
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Logs Content */}
          <div className="bg-white dark:bg-gray-800 px-4 pb-4 pt-5 sm:p-6" style={{ height: '70vh' }}>
            <LogsViewer serverId={serverId} containerId={containerId} tail={100} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogsModal;
