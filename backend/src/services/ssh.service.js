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

    const ssh = new Client();
    
    return new Promise((resolve, reject) => {
      const privateKey = server.getDecryptedKey();
      
      ssh.on('ready', () => {
        this.connections.set(connectionKey, {
          ssh,
          isConnected: true,
          serverId: server.id,
        });

        logger.info(`SSH connection established to ${server.host}:${server.port}`);
        resolve(ssh);
      });

      ssh.on('error', (err) => {
        // Never log private keys - only log error without sensitive data
        logger.error(`SSH connection error for ${server.id}:`, {
          message: err.message,
          code: err.code,
          host: server.host,
          port: server.port,
          username: server.username,
          // Explicitly do NOT log privateKey
        });
        this.connections.delete(connectionKey);
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      ssh.on('close', () => {
        logger.info(`SSH connection closed for ${server.id}`);
        this.connections.delete(connectionKey);
      });

      ssh.connect({
        host: server.host,
        port: server.port,
        username: server.username,
        privateKey: privateKey,
        readyTimeout: 10000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      });
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
          logger.error(`Command execution failed on ${server.host}:`, err);
          reject(err);
          return;
        }

        // Set up timeout
        timeoutId = setTimeout(() => {
          if (!streamClosed) {
            streamClosed = true;
            stream.close();
            const timeoutError = new Error(`Command timed out after ${timeout}ms. Interactive commands like 'more', 'less', 'vi', 'nano' are not supported. Use 'cat' instead of 'more' or 'less'.`);
            timeoutError.code = 'TIMEOUT';
            reject(timeoutError);
          }
        }, timeout);

        let stdout = '';
        let stderr = '';

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
