import React, { useState, useRef, useEffect } from 'react';
import { containersService } from '../services/containers.service';

const Console = ({ serverId, containerId }) => {
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState([]);
  const [loading, setLoading] = useState(false);
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    // Add welcome message
    setOutput([{
      type: 'system',
      content: `Connected to container console. Type commands and press Enter to execute.`,
      timestamp: new Date(),
    }]);
  }, [containerId]);

  useEffect(() => {
    // Auto-scroll to bottom when output changes
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [output]);

  const executeCommand = async () => {
    if (!command.trim() || loading) return;

    const cmd = command.trim();
    setCommand('');
    setLoading(true);

    // Add command to output
    const newOutput = [...output, {
      type: 'command',
      content: `$ ${cmd}`,
      timestamp: new Date(),
    }];
    setOutput(newOutput);

    // Add to history
    setCommandHistory(prev => {
      const updated = [...prev, cmd];
      return updated.slice(-50); // Keep last 50 commands
    });
    setHistoryIndex(-1);

    try {
      const response = await containersService.executeCommand(serverId, containerId, cmd);
      
      const result = {
        type: response.data.success ? 'output' : 'error',
        content: response.data.stdout || response.data.stderr || 'No output',
        code: response.data.code,
        timestamp: new Date(),
      };

      setOutput([...newOutput, result]);
    } catch (error) {
      setOutput([...newOutput, {
        type: 'error',
        content: error.response?.data?.error || error.message || 'Failed to execute command',
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex === -1 
          ? commandHistory.length - 1 
          : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex >= 0) {
        const newIndex = historyIndex + 1;
        if (newIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setCommand('');
        } else {
          setHistoryIndex(newIndex);
          setCommand(commandHistory[newIndex]);
        }
      }
    }
  };

  const clearOutput = () => {
    setOutput([{
      type: 'system',
      content: 'Console cleared.',
      timestamp: new Date(),
    }]);
  };

  const formatTimestamp = (date) => {
    return date.toLocaleTimeString();
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 dark:bg-black rounded-lg overflow-hidden">
      {/* Output Area */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-sm" style={{ maxHeight: '600px' }}>
        {output.map((item, index) => (
          <div key={index} className="mb-2">
            <div className="flex items-start gap-2">
              <span className="text-gray-500 dark:text-gray-500 text-xs flex-shrink-0">
                [{formatTimestamp(item.timestamp)}]
              </span>
              <div className="flex-1">
                {item.type === 'command' && (
                  <div className="text-green-400 dark:text-green-500">
                    {item.content}
                  </div>
                )}
                {item.type === 'output' && (
                  <div className="text-gray-100 dark:text-gray-200 whitespace-pre-wrap break-words">
                    {item.content}
                    {item.code !== undefined && item.code !== 0 && (
                      <span className="text-yellow-400 ml-2">[Exit code: {item.code}]</span>
                    )}
                  </div>
                )}
                {item.type === 'error' && (
                  <div className="text-red-400 dark:text-red-500 whitespace-pre-wrap break-words">
                    {item.content}
                  </div>
                )}
                {item.type === 'system' && (
                  <div className="text-blue-400 dark:text-blue-500 italic">
                    {item.content}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="text-gray-500 dark:text-gray-400">
            <span className="animate-pulse">Executing...</span>
          </div>
        )}
        <div ref={outputEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-700 dark:border-gray-800 p-4 bg-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2">
          <span className="text-green-400 dark:text-green-500 font-mono text-sm">$</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter command..."
            disabled={loading}
            className="flex-1 bg-gray-900 dark:bg-black text-gray-100 dark:text-gray-200 border border-gray-700 dark:border-gray-700 rounded px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400 focus:border-transparent disabled:opacity-50"
            autoFocus
          />
          <button
            onClick={executeCommand}
            disabled={loading || !command.trim()}
            className="px-4 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded hover:bg-primary-700 dark:hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            Execute
          </button>
          <button
            onClick={clearOutput}
            className="px-3 py-2 bg-gray-700 dark:bg-gray-800 text-gray-300 dark:text-gray-400 rounded hover:bg-gray-600 dark:hover:bg-gray-700 transition-colors"
            title="Clear console"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          <span>↑/↓: Navigate history</span>
          <span className="ml-4">Enter: Execute command</span>
        </div>
      </div>
    </div>
  );
};

export default Console;
