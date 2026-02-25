const { Client } = require('ssh2');
const logger = require('../config/logger');

class SSHService {
  constructor() {
    this.connections = new Map();
  }

  async connect(server) {
    const connectionKey = `${server.id}`;

    // Return existing connection if available
    if (this.connections.has(connectionKey)) {
      const existingConnection = this.connections.get(connectionKey);
      if (existingConnection.isConnected) {
        return existingConnection.ssh;
      }
    }

    const effectiveHost = typeof server.getEffectiveHost === 'function' ? server.getEffectiveHost() : server.host;
    const canFallback = server.tailscaleEnabled &&
      server.tailscaleIp &&
      effectiveHost !== server.host;

    return new Promise((resolve, reject) => {
      const privateKey = server.getDecryptedKey();
      let triedFallback = false;

      const tryConnect = (host, isFallback = false) => {
        const ssh = new Client();

        ssh.on('ready', () => {
          this.connections.set(connectionKey, {
            ssh,
            isConnected: true,
            serverId: server.id,
          });
          logger.info(`SSH connection established to ${host}:${server.port}${isFallback ? ' (fallback from Tailscale IP)' : ''}`);
          resolve(ssh);
        });

        ssh.on('error', (err) => {
          logger.error(`SSH connection error for ${server.id}:`, {
            message: err.message,
            code: err.code,
            host,
            port: server.port,
            username: server.username,
          });
          this.connections.delete(connectionKey);
          if (isFallback || !canFallback || triedFallback) {
            reject(new Error(`SSH connection failed: ${err.message}`));
            return;
          }
          triedFallback = true;
          logger.warn(`Tailscale IP unreachable for ${server.id}, falling back to management host ${server.host}`, { message: err.message });
          tryConnect(server.host, true);
        });

        ssh.on('close', () => {
          logger.info(`SSH connection closed for ${server.id}`);
          this.connections.delete(connectionKey);
        });

        ssh.connect({
          host,
          port: server.port,
          username: server.username,
          privateKey,
          readyTimeout: 10000,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
        });
      };

      tryConnect(effectiveHost);
    });
  }

  async executeCommand(server, command, options = {}) {
    const ssh = await this.connect(server);
    const timeout = options.timeout || 30000; // Default 30 seconds timeout
    
    return new Promise((resolve, reject) => {
      let timeoutId = null;
      let streamClosed = false;

      ssh.exec(command, {
        cwd: options.cwd || '/',
        pty: options.pty !== false, // Allow disabling pty if needed
      }, (err, stream) => {
        if (err) {
          const host = typeof server.getEffectiveHost === 'function' ? server.getEffectiveHost() : server.host;
          logger.error(`Command execution failed on ${host}:`, err);
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        // Set up timeout (log for debugging when it fires)
        timeoutId = setTimeout(() => {
          if (!streamClosed) {
            streamClosed = true;
            stream.close();
            const cmdPreview = typeof command === 'string' ? command.substring(0, 300) : String(command).substring(0, 300);
            const host = typeof server.getEffectiveHost === 'function' ? server.getEffectiveHost() : server.host;
            logger.warn('SSH command timed out', {
              host,
              timeoutMs: timeout,
              commandPreview: cmdPreview,
              stdoutTail: stdout.slice(-800),
              stderrTail: stderr.slice(-800),
            });
            const timeoutError = new Error(`Command timed out after ${timeout}ms. If this was a long-running step (e.g. apt install), try again; otherwise avoid interactive commands like 'more', 'less', 'vi', 'nano'.`);
            timeoutError.code = 'TIMEOUT';
            reject(timeoutError);
          }
        }, timeout);

        stream.on('close', (code, signal) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          
          if (streamClosed) {
            return; // Already handled by timeout
          }
          
          streamClosed = true;

          if (code !== 0 && !options.allowFailure) {
            reject(new Error(`Command failed: ${stderr || stdout}`));
            return;
          }

          resolve({
            stdout,
            stderr,
            code,
          });
        });

        stream.on('data', (data) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      });
    });
  }

  /**
   * Execute a command with stdin data (e.g. pipe tar to docker load).
   * @param {object} server - Server model
   * @param {string} command - Command to run
   * @param {Buffer} stdinData - Data to write to stdin
   * @param {{ timeout?: number }} options - timeout in ms (default 120000 for large payloads)
   */
  async executeCommandWithStdin(server, command, stdinData, options = {}) {
    const ssh = await this.connect(server);
    const timeout = options.timeout || 120000;

    return new Promise((resolve, reject) => {
      let timeoutId = null;
      let streamClosed = false;

      ssh.exec(command, { cwd: '/', pty: false }, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        timeoutId = setTimeout(() => {
          if (!streamClosed) {
            streamClosed = true;
            stream.close();
            reject(new Error(`Command timed out after ${timeout}ms`));
          }
        }, timeout);

        let stdout = '';
        let stderr = '';

        stream.on('close', (code, signal) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (streamClosed) return;
          streamClosed = true;
          if (code !== 0 && !options.allowFailure) {
            reject(new Error(`Command failed: ${stderr || stdout}`));
            return;
          }
          resolve({ stdout, stderr, code });
        });

        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });

        stream.write(stdinData, (err) => {
          if (err) {
            if (timeoutId) clearTimeout(timeoutId);
            reject(err);
            return;
          }
          stream.end();
        });
      });
    });
  }

  async executeStream(server, command, onData, onError) {
    const ssh = await this.connect(server);
    
    return new Promise((resolve, reject) => {
      ssh.exec(command, {
        pty: true,
      }, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        stream.on('data', (data) => {
          if (onData) onData(data.toString());
        });

        stream.stderr.on('data', (data) => {
          if (onError) onError(data.toString());
        });

        stream.on('close', (code) => {
          resolve({ code });
        });
      });
    });
  }

  disconnect(serverId) {
    const connectionKey = `${serverId}`;
    const connection = this.connections.get(connectionKey);
    
    if (connection && connection.ssh) {
      connection.ssh.end();
      this.connections.delete(connectionKey);
      logger.info(`SSH connection disconnected for ${serverId}`);
    }
  }

  disconnectAll() {
    for (const [key, connection] of this.connections.entries()) {
      if (connection.ssh) {
        connection.ssh.end();
      }
    }
    this.connections.clear();
    logger.info('All SSH connections closed');
  }
}

module.exports = new SSHService();
