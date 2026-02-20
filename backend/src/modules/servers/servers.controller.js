const { body } = require('express-validator');
const { Server } = require('../../models');
const sshService = require('../../services/ssh.service');
const pollingService = require('../../services/polling.service');
const { configureFirewall } = require('../../services/public-www.service');
const logger = require('../../config/logger');

const getAllServers = async (req, res, next) => {
  try {
    const servers = await Server.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
    });

    // Never send encrypted private keys in the response for security
    const serversData = servers.map(server => {
      const serverData = server.toJSON();
      delete serverData.privateKeyEncrypted;
      const lastSyncError = pollingService.getLastSyncError(server.id);
      if (lastSyncError) serverData.lastSyncError = lastSyncError;
      return serverData;
    });

    res.json({ servers: serversData });
  } catch (error) {
    next(error);
  }
};

const getServerById = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const server = await Server.findOne({
      where: { id, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    // Never send the encrypted private key in the response for security
    const serverData = server.toJSON();
    delete serverData.privateKeyEncrypted;
    const lastSyncError = pollingService.getLastSyncError(id);
    if (lastSyncError) serverData.lastSyncError = lastSyncError;

    res.json({ server: serverData });
  } catch (error) {
    next(error);
  }
};

const createServer = async (req, res, next) => {
  try {
    const { name, host, port, username, privateKey } = req.body;

    // Validate required fields
    if (!name || !host || !username || !privateKey) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: 'Name, host, username, and private key are required',
      });
    }

    // Validate that this is a private key, not a public key
    const keyTrimmed = privateKey.trim();
    
    // Check if it's a public key (common mistake)
    if (keyTrimmed.startsWith('ssh-ed25519') || 
        keyTrimmed.startsWith('ssh-rsa') || 
        keyTrimmed.startsWith('ssh-dss') ||
        keyTrimmed.startsWith('ecdsa-sha2')) {
      return res.status(400).json({ 
        error: 'Invalid private key format',
        details: 'You have pasted a PUBLIC key. Please use your PRIVATE key instead. Private keys typically start with "-----BEGIN OPENSSH PRIVATE KEY-----" or "-----BEGIN RSA PRIVATE KEY-----".',
      });
    }
    
    // Check if it's a valid private key format
    if (!keyTrimmed.includes('-----BEGIN') && keyTrimmed.length < 100) {
      return res.status(400).json({ 
        error: 'Invalid private key format',
        details: 'Private key should start with "-----BEGIN OPENSSH PRIVATE KEY-----" or "-----BEGIN RSA PRIVATE KEY-----" or similar. Make sure you are using your private key file, not the public key.',
      });
    }

    // Test SSH connection before saving
    const testServer = {
      id: 'test',
      host,
      port: port || 22,
      username,
      getDecryptedKey: () => privateKey,
    };

    try {
      await sshService.connect(testServer);
      sshService.disconnect('test');
    } catch (error) {
      // Never log private keys - only log error message without sensitive data
      logger.error('SSH connection test failed:', {
        message: error.message,
        host: host,
        port: port || 22,
        username: username,
        // Explicitly do NOT log privateKey
      });
      return res.status(400).json({ 
        error: 'Failed to connect to server',
        details: error.message || 'Unable to establish SSH connection. Please verify your credentials and network connectivity.',
      });
    }

    const server = await Server.create({
      userId: req.user.id,
      name,
      host,
      port: port || 22,
      username,
      privateKeyEncrypted: privateKey,
    });

    logger.info(`Server ${server.id} created by user ${req.user.id}`);

    // Never send the encrypted private key in the response for security
    const serverData = server.toJSON();
    delete serverData.privateKeyEncrypted;

    res.status(201).json({ server: serverData });
  } catch (error) {
    // Never log private keys in error messages
    logger.error('Server creation error:', {
      message: error.message,
      name: error.name,
      // Explicitly do NOT log request body which contains privateKey
    });
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({ 
        error: 'Validation error',
        details: error.errors.map(e => e.message).join(', '),
      });
    }
    next(error);
  }
};

const updateServer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, host, port, username, privateKey, sshAllowedIps } = req.body;

    const server = await Server.findOne({
      where: { id, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    // If connection details changed, test connection
    if (host || port || username || privateKey) {
      const testServer = {
        id: 'test',
        host: host || server.host,
        port: port || server.port,
        username: username || server.username,
        getDecryptedKey: () => privateKey || server.getDecryptedKey(),
      };

      try {
        await sshService.connect(testServer);
        sshService.disconnect('test');
      } catch (error) {
        // Never log private keys - only log error message without sensitive data
        logger.error('SSH connection test failed during update:', {
          message: error.message,
          serverId: id,
          host: host || server.host,
          port: port || server.port,
          username: username || server.username,
          // Explicitly do NOT log privateKey
        });
        return res.status(400).json({ 
          error: 'Failed to connect to server',
          details: error.message,
        });
      }
    }

    if (name) server.name = name;
    if (host) server.host = host;
    if (port) server.port = port;
    if (username) server.username = username;
    if (privateKey) server.privateKeyEncrypted = privateKey;
    if (sshAllowedIps !== undefined) {
      server.sshAllowedIps = sshAllowedIps === '' || sshAllowedIps == null ? null : String(sshAllowedIps).trim() || null;
    }

    await server.save();

    if (server.publicWwwEnabled && sshAllowedIps !== undefined) {
      try {
        await configureFirewall(server);
      } catch (e) {
        logger.warn('Public WWW: re-apply firewall after SSH restriction change failed', { serverId: id, message: e.message });
      }
    }

    // Never send the encrypted private key in the response for security
    const serverData = server.toJSON();
    delete serverData.privateKeyEncrypted;

    res.json({ server: serverData });
  } catch (error) {
    next(error);
  }
};

const deleteServer = async (req, res, next) => {
  try {
    const { id } = req.params;

    const server = await Server.findOne({
      where: { id, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    // Disconnect SSH connection if active
    sshService.disconnect(id);

    await server.destroy();

    logger.info(`Server ${id} deleted by user ${req.user.id}`);

    res.json({ message: 'Server deleted successfully' });
  } catch (error) {
    next(error);
  }
};

const testConnection = async (req, res, next) => {
  try {
    const { id } = req.params;

    const server = await Server.findOne({
      where: { id, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    try {
      await sshService.connect(server);
      sshService.disconnect(id);
      res.json({ success: true, message: 'Connection successful' });
    } catch (error) {
      res.status(400).json({ 
        success: false,
        error: 'Connection failed',
        details: error.message,
      });
    }
  } catch (error) {
    next(error);
  }
};

// Validation rules for creating a server (all fields required)
const createServerValidation = [
  body('name').notEmpty().withMessage('Name is required'),
  body('host').notEmpty().withMessage('Host is required'),
  body('port').optional().isInt({ min: 1, max: 65535 }),
  body('username').notEmpty().withMessage('Username is required'),
  body('privateKey').notEmpty().withMessage('Private key is required'),
];

// Validation rules for updating a server (private key is optional)
const updateServerValidation = [
  body('name').optional().notEmpty().withMessage('Name cannot be empty'),
  body('host').optional().notEmpty().withMessage('Host cannot be empty'),
  body('port').optional().isInt({ min: 1, max: 65535 }),
  body('username').optional().notEmpty().withMessage('Username cannot be empty'),
  body('privateKey').optional(), // Private key is optional when updating
  body('sshAllowedIps').optional().isString().withMessage('SSH allowed IPs must be a string'),
];

module.exports = {
  getAllServers,
  getServerById,
  createServer,
  updateServer,
  deleteServer,
  testConnection,
  serverValidation: createServerValidation, // Keep for backward compatibility
  createServerValidation,
  updateServerValidation,
};
