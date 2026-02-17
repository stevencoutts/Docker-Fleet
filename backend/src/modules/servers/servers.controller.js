const { body } = require('express-validator');
const { Server } = require('../../models');
const sshService = require('../../services/ssh.service');
const logger = require('../../config/logger');

const getAllServers = async (req, res, next) => {
  try {
    const servers = await Server.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
    });

    res.json({ servers });
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

    res.json({ server });
  } catch (error) {
    next(error);
  }
};

const createServer = async (req, res, next) => {
  try {
    const { name, host, port, username, privateKey } = req.body;

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
      return res.status(400).json({ 
        error: 'Failed to connect to server',
        details: error.message,
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

    res.status(201).json({ server });
  } catch (error) {
    next(error);
  }
};

const updateServer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, host, port, username, privateKey } = req.body;

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

    await server.save();

    res.json({ server });
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

// Validation rules
const serverValidation = [
  body('name').notEmpty().withMessage('Name is required'),
  body('host').notEmpty().withMessage('Host is required'),
  body('port').optional().isInt({ min: 1, max: 65535 }),
  body('username').notEmpty().withMessage('Username is required'),
  body('privateKey').notEmpty().withMessage('Private key is required'),
];

module.exports = {
  getAllServers,
  getServerById,
  createServer,
  updateServer,
  deleteServer,
  testConnection,
  serverValidation,
};
