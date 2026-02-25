const { body } = require('express-validator');
const { Server } = require('../../models');
const sshService = require('../../services/ssh.service');
const pollingService = require('../../services/polling.service');
const { configureFirewall } = require('../../services/public-www.service');
const tailscaleService = require('../../services/tailscale.service');
const { encrypt } = require('../../utils/encryption');
const logger = require('../../config/logger');

const TAILSCALE_KEY_STORAGE_DAYS = 90;

function toServerResponse(server) {
  const serverData = server.toJSON();
  delete serverData.privateKeyEncrypted;
  delete serverData.tailscaleAuthKeyEncrypted;
  return serverData;
}

const getAllServers = async (req, res, next) => {
  try {
    const servers = await Server.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
    });

    const serversData = servers.map(server => {
      const serverData = toServerResponse(server);
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

    const serverData = toServerResponse(server);
    const lastSyncError = pollingService.getLastSyncError(id);
    if (lastSyncError) serverData.lastSyncError = lastSyncError;

    res.json({ server: serverData });
  } catch (error) {
    next(error);
  }
};

const createServer = async (req, res, next) => {
  try {
    const { name, host, port, username, privateKey, publicHost } = req.body;

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
      publicHost: publicHost && String(publicHost).trim() ? String(publicHost).trim() : null,
    });

    logger.info(`Server ${server.id} created by user ${req.user.id}`);

    // Never send the encrypted private key in the response for security
    res.status(201).json({ server: toServerResponse(server) });
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
    const { name, host, port, username, privateKey, sshAllowedIps, publicWwwEnabled, publicHost } = req.body;

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
    if (publicWwwEnabled !== undefined) {
      server.publicWwwEnabled = !!publicWwwEnabled;
    }
    if (publicHost !== undefined) {
      server.publicHost = publicHost === '' || publicHost == null ? null : String(publicHost).trim() || null;
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
    res.json({ server: toServerResponse(server) });
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

/** Turn raw Tailscale install stderr into a short user message and optional full details. */
function tailscaleInstallErrorMessage(rawMessage) {
  const msg = String(rawMessage || '');
  if (/Could not get lock|dpkg.*lock|Unable to acquire.*dpkg|is held by process/.test(msg)) {
    return { error: 'Another package manager (apt) is running on the server. Wait for it to finish, then try again.', details: msg };
  }
  if (/Signing key|SHA1 is not considered secure|not bound|Policy rejected|PositiveCertification/.test(msg)) {
    return {
      error: 'Package signing verification failed (common on newer Debian). Install Tailscale manually on the server (see tailscale.com), then click "Enable Tailscale" here to use the existing install.',
      details: msg,
    };
  }
  if (msg.length > 500) return { error: 'Tailscale installation failed.', details: msg };
  return { error: msg || 'Enable failed' };
}

const tailscaleEnable = async (req, res, next) => {
  const { id } = req.params;
  const { authKey: bodyAuthKey, storeAuthKey } = req.body || {};
  const stream = req.query.stream === '1' || req.get('Accept')?.includes('text/event-stream');

  const resolveKeyAndPersist = async (server) => {
    const effectiveKey = typeof bodyAuthKey === 'string' && bodyAuthKey.trim()
      ? bodyAuthKey.trim()
      : server.getDecryptedTailscaleAuthKey();
    const expiresAt = new Date(Date.now() + TAILSCALE_KEY_STORAGE_DAYS * 24 * 60 * 60 * 1000);
    if (storeAuthKey && effectiveKey) {
      await server.update({
        tailscaleAuthKeyEncrypted: encrypt(effectiveKey),
        tailscaleAuthKeyExpiresAt: expiresAt,
      });
    } else if (!storeAuthKey) {
      await server.update({
        tailscaleAuthKeyEncrypted: null,
        tailscaleAuthKeyExpiresAt: null,
      });
    }
  };

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      try { res.flush?.(); } catch (e) { /* ignore */ }
    };
    try {
      const server = await Server.findOne({ where: { id, userId: req.user.id } });
      if (!server) {
        send({ step: 'done', success: false, error: 'Server not found' });
        res.end();
        return;
      }
      const effectiveKey = typeof bodyAuthKey === 'string' && bodyAuthKey.trim()
        ? bodyAuthKey.trim()
        : server.getDecryptedTailscaleAuthKey();
      const result = await tailscaleService.enableTailscale(server, effectiveKey, {
        onProgress: (step, message, status) => send({ step, message, status }),
      });
      const { tailscaleIp, imported } = result;
      await server.update({ tailscaleEnabled: true, tailscaleIp });
      await resolveKeyAndPersist(server);
      sshService.disconnect(id);
      const serverData = toServerResponse(server);
      const message = imported
        ? 'Existing Tailscale detected; management will use its IP.'
        : 'Tailscale enabled; management will use Tailscale IP.';
      send({ step: 'done', success: true, server: serverData, message, imported: !!imported });
    } catch (err) {
      if (err.code === 'TAILSCALE_AUTH_KEY_REQUIRED') {
        send({ step: 'done', success: false, error: err.message, requireAuthKey: true });
      } else if (err.code === 'TIMEOUT') {
        send({ step: 'done', success: false, error: err.message || 'Tailscale install or join timed out' });
      } else {
        const { error, details } = tailscaleInstallErrorMessage(err.message);
        send({ step: 'done', success: false, error, ...(details && { details }) });
      }
    }
    res.end();
    return;
  }

  try {
    const server = await Server.findOne({ where: { id, userId: req.user.id } });
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const effectiveKey = typeof bodyAuthKey === 'string' && bodyAuthKey.trim()
      ? bodyAuthKey.trim()
      : server.getDecryptedTailscaleAuthKey();
    const result = await tailscaleService.enableTailscale(server, effectiveKey);
    const { tailscaleIp, imported } = result;
    await server.update({ tailscaleEnabled: true, tailscaleIp });
    await resolveKeyAndPersist(server);
    sshService.disconnect(id);
    const serverData = toServerResponse(server);
    const message = imported
      ? 'Existing Tailscale detected; management will use its IP.'
      : 'Tailscale enabled; management will use Tailscale IP.';
    res.json({ server: serverData, message, imported: !!imported });
  } catch (err) {
    if (err.code === 'TAILSCALE_AUTH_KEY_REQUIRED') {
      return res.status(400).json({
        error: err.message,
        requireAuthKey: true,
      });
    }
    if (err.code === 'TIMEOUT') {
      return res.status(504).json({
        error: 'Tailscale install or join timed out',
        details: err.message,
      });
    }
    next(err);
  }
};

const tailscaleDisable = async (req, res, next) => {
  try {
    const { id } = req.params;
    const server = await Server.findOne({ where: { id, userId: req.user.id } });
    if (!server) return res.status(404).json({ error: 'Server not found' });
    await tailscaleService.disableTailscale(server);
    await server.update({ tailscaleEnabled: false, tailscaleIp: null });
    sshService.disconnect(id);
    res.json({ server: toServerResponse(server), message: 'Tailscale disabled; management will use original host.' });
  } catch (err) {
    next(err);
  }
};

const clearTailscaleStoredKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    const server = await Server.findOne({ where: { id, userId: req.user.id } });
    if (!server) return res.status(404).json({ error: 'Server not found' });
    await server.update({ tailscaleAuthKeyEncrypted: null, tailscaleAuthKeyExpiresAt: null });
    res.json({ server: toServerResponse(server), message: 'Stored Tailscale auth key cleared.' });
  } catch (err) {
    next(err);
  }
};

const tailscaleStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const server = await Server.findOne({ where: { id, userId: req.user.id } });
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const status = await tailscaleService.getTailscaleStatus(server);
    res.json({
      tailscaleEnabled: server.tailscaleEnabled,
      tailscaleIp: server.tailscaleIp,
      nodeStatus: status,
    });
  } catch (err) {
    next(err);
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
  body('publicWwwEnabled').optional().isBoolean().withMessage('publicWwwEnabled must be a boolean'),
  body('publicHost').optional().isString().withMessage('publicHost must be a string'),
];

module.exports = {
  getAllServers,
  getServerById,
  createServer,
  updateServer,
  deleteServer,
  testConnection,
  tailscaleEnable,
  tailscaleDisable,
  clearTailscaleStoredKey,
  tailscaleStatus,
  serverValidation: createServerValidation, // Keep for backward compatibility
  createServerValidation,
  updateServerValidation,
};
