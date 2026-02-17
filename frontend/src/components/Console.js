import React, { useState, useRef, useEffect } from 'react';
import { containersService } from '../services/containers.service';

const Console = ({ serverId, containerId }) => {
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState([]);
  const [loading, setLoading] = useState(false);
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [workingDirectory, setWorkingDirectory] = useState('/');
  const outputEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    // Reset state when container changes
    setWorkingDirectory('/');
    setCommandHistory([]);
    setHistoryIndex(-1);
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

  useEffect(() => {
    // Refocus input after command execution completes
    if (!loading && inputRef.current) {
      // Use setTimeout to ensure focus happens after React has finished rendering
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [loading]);

  const executeCommand = async () => {
    if (!command.trim() || loading) return;

    let cmd = command.trim();
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
      // Handle cd command specially to maintain working directory state
      if (cmd.trim().startsWith('cd ') || cmd.trim() === 'cd') {
        let targetDir = cmd.trim() === 'cd' ? '' : cmd.substring(3).trim();
        
        // Build command that handles ~ expansion, changes directory, and reports the new directory
        // Use sh -c to chain commands: expand ~, cd to target, then pwd to get the actual directory
        // Escape the target directory to handle spaces and special characters
        let cdCommand;
        if (targetDir.startsWith('~') || !targetDir) {
          // Handle ~ expansion and empty cd in one command
          const dirPart = targetDir ? targetDir.replace('~', '$HOME') : '$HOME';
          cdCommand = `cd ${dirPart} 2>&1 && pwd || (echo "cd: ${targetDir || '~'}: No such file or directory" >&2 && exit 1)`;
        } else {
          const escapedDir = targetDir.replace(/'/g, "'\\''");
          cdCommand = `cd '${escapedDir}' 2>&1 && pwd || (echo "cd: ${targetDir}: No such file or directory" >&2 && exit 1)`;
        }
        const response = await containersService.executeCommand(serverId, containerId, cdCommand);
        
        // Check if cd was successful by looking at the output
        const output = (response.data.stdout || '').trim();
        const error = (response.data.stderr || '').trim();
        const hasError = response.data.code !== 0 || error.includes('No such file') || output.includes('No such file');
        
        if (!hasError && output) {
          // Successfully changed directory - update state
          const newDir = output;
          setWorkingDirectory(newDir);
          const result = {
            type: 'output',
            content: '', // cd doesn't output anything on success
            code: 0,
            timestamp: new Date(),
          };
          setOutput([...newOutput, result]);
        } else {
          // Failed to change directory - clean up error message
          let errorMsg = error || output || `cd: ${targetDir || '~'}: No such file or directory`;
          // Remove duplicate error messages and clean up
          if (errorMsg.includes("can't cd to")) {
            errorMsg = errorMsg.split('\n').find(line => line.includes("can't cd to") || line.includes("No such file")) || errorMsg;
          }
          // Remove /bin/sh prefix if present
          errorMsg = errorMsg.replace(/^\/bin\/sh: \d+: /, '').trim();
          const result = {
            type: 'error',
            content: errorMsg || `cd: ${targetDir || '~'}: No such file or directory`,
            code: response.data.code || 1,
            timestamp: new Date(),
          };
          setOutput([...newOutput, result]);
        }
      } else {
        // Detect interactive commands and suggest alternatives
        const interactiveCommands = {
          'more': 'cat',
          'less': 'cat',
          'vi ': 'nano or use cat to view files',
          'vim ': 'nano or use cat to view files',
          'nano ': 'Use cat to view files, or edit via other means',
          'htop': 'top -b (non-interactive)',
          ' top ': 'top -b (non-interactive)',
        };
        
        const cmdLower = cmd.toLowerCase();
        let suggestion = null;
        for (const [interactive, alternative] of Object.entries(interactiveCommands)) {
          if (cmdLower.includes(interactive)) {
            suggestion = alternative;
            break;
          }
        }
        
        // For other commands, prepend cd to working directory if not already in root
        let finalCommand = cmd;
        if (workingDirectory !== '/') {
          // Execute command in the context of the working directory
          // Use sh -c to change to working directory first, then execute command
          // Escape the working directory to handle spaces
          const escapedDir = workingDirectory.replace(/'/g, "'\\''");
          finalCommand = `cd '${escapedDir}' && ${cmd}`;
        }
        
        try {
          const response = await containersService.executeCommand(serverId, containerId, finalCommand);
          
          // Check if it's a timeout error
          const output = response.data.stdout || '';
          const error = response.data.stderr || '';
          const isTimeout = output.includes('timed out') || 
                          output.includes('timeout') || 
                          error.includes('timed out') ||
                          error.includes('TIMEOUT') ||
                          response.data.code === 124; // timeout command exit code
          
          if (isTimeout && suggestion) {
            const result = {
              type: 'error',
              content: `Command timed out. Interactive commands like '${cmd.split(' ')[0]}' are not supported in this console.\nTip: Use '${suggestion}' instead.`,
              code: response.data.code || 124,
              timestamp: new Date(),
            };
            setOutput([...newOutput, result]);
          } else {
            const result = {
              type: response.data.success ? 'output' : 'error',
              content: response.data.stdout || response.data.stderr || 'No output',
              code: response.data.code,
              timestamp: new Date(),
            };
            setOutput([...newOutput, result]);
          }
        } catch (error) {
          let errorMessage = error.response?.data?.error || error.message || 'Failed to execute command';
          
          // Check if it's a timeout error
          if (errorMessage.includes('timed out') || errorMessage.includes('TIMEOUT') || error.code === 'TIMEOUT') {
            if (suggestion) {
              errorMessage = `Command timed out. Interactive commands like '${cmd.split(' ')[0]}' are not supported in this console.\nTip: Use '${suggestion}' instead.`;
            } else {
              errorMessage = `Command timed out after 10 seconds. Interactive commands are not supported.`;
            }
          }
          
          setOutput([...newOutput, {
            type: 'error',
            content: errorMessage,
            timestamp: new Date(),
          }]);
        }
      }
    } catch (error) {
      setOutput([...newOutput, {
        type: 'error',
        content: error.response?.data?.error || error.message || 'Failed to execute command',
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
      // Focus will be handled by useEffect when loading becomes false
      // But also try to focus immediately as a fallback
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  };

  const handleTabComplete = async (currentCommand) => {
    if (!currentCommand.trim()) return;
    
    try {
      // Get the last word (what we're trying to complete)
      const words = currentCommand.trim().split(/\s+/);
      const lastWord = words[words.length - 1] || '';
      const prefix = words.slice(0, -1).join(' ');
      
      if (!lastWord) return;
      
      // Build path for completion - handle relative and absolute paths
      let basePath = workingDirectory !== '/' ? workingDirectory : '';
      let searchPattern = lastWord;
      
      // If lastWord contains a path separator, split it
      if (lastWord.includes('/')) {
        const lastSlash = lastWord.lastIndexOf('/');
        const dirPart = lastWord.substring(0, lastSlash);
        searchPattern = lastWord.substring(lastSlash + 1);
        
        // Handle absolute vs relative paths
        if (dirPart.startsWith('/')) {
          basePath = dirPart;
        } else if (dirPart) {
          basePath = basePath ? `${basePath}/${dirPart}` : dirPart;
        }
      }
      
      // Escape the search pattern for shell (only escape special glob chars, not all regex chars)
      const escapedPattern = searchPattern.replace(/[*?[\\]/g, '\\$&');
      
      // Use ls to find matching files/directories
      // Simple approach: cd to base path, then ls with pattern
      const basePathPart = basePath ? `cd '${basePath.replace(/'/g, "'\\''")}' && ` : '';
      const completionCommand = `${basePathPart}ls -1 -d ${escapedPattern}* 2>/dev/null | head -20 || echo ""`;
      
      const response = await containersService.executeCommand(serverId, containerId, completionCommand);
      
      if (response.data.success && response.data.stdout && response.data.stdout.trim()) {
        const completions = response.data.stdout.trim().split('\n')
          .filter(c => c.trim() && !c.includes('Permission denied') && !c.includes('No such file'));
        
        if (completions.length === 1) {
          // Single match - auto-complete
          const completed = completions[0];
          // If we had a path, reconstruct it
          let fullPath;
          if (lastWord.includes('/')) {
            const dirPart = lastWord.substring(0, lastWord.lastIndexOf('/') + 1);
            fullPath = dirPart + completed;
          } else {
            fullPath = completed;
          }
          const newCommand = prefix ? `${prefix} ${fullPath}` : fullPath;
          // Add space if it's a file, or keep / if it's a directory
          const needsSpace = !completed.endsWith('/');
          setCommand(newCommand + (needsSpace ? ' ' : ''));
        } else if (completions.length > 1) {
          // Multiple matches - find common prefix
          let commonPrefix = completions[0];
          for (let i = 1; i < completions.length; i++) {
            const match = completions[i];
            let j = 0;
            while (j < commonPrefix.length && j < match.length && commonPrefix[j] === match[j]) {
              j++;
            }
            commonPrefix = commonPrefix.substring(0, j);
          }
          
          if (commonPrefix.length > searchPattern.length) {
            // We can complete to the common prefix
            let fullPath;
            if (lastWord.includes('/')) {
              const dirPart = lastWord.substring(0, lastWord.lastIndexOf('/') + 1);
              fullPath = dirPart + commonPrefix;
            } else {
              fullPath = commonPrefix;
            }
            const newCommand = prefix ? `${prefix} ${fullPath}` : fullPath;
            setCommand(newCommand);
          } else {
            // Show all matches in console
            const matchesList = completions.join('  ');
            setOutput(prev => [...prev, {
              type: 'system',
              content: `Possible completions: ${matchesList}`,
              timestamp: new Date(),
            }]);
          }
        }
      }
    } catch (error) {
      // Silently fail tab completion - don't show errors
      console.debug('Tab completion failed:', error);
    }
  };

  const handleKeyDown = async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCommand();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      await handleTabComplete(command);
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
          <span className="text-green-400 dark:text-green-500 font-mono text-sm">
            {workingDirectory === '/' ? '~' : workingDirectory}$
          </span>
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
            onClick={(e) => {
              e.preventDefault();
              executeCommand();
              // Ensure input retains focus after button click
              setTimeout(() => {
                inputRef.current?.focus();
              }, 0);
            }}
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
          <span className="ml-4">Tab: Auto-complete</span>
          <span className="ml-4">Enter: Execute command</span>
        </div>
      </div>
    </div>
  );
};

export default Console;
