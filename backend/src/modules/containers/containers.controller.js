const { Server } = require('../../models');
const dockerService = require('../../services/docker.service');
const sshService = require('../../services/ssh.service');
const logger = require('../../config/logger');

const getContainers = async (req, res, next) => {
  try {
    const { serverId } = req.params;
    const { all = 'false' } = req.query;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const containers = await dockerService.listContainers(server, all === 'true');
    res.json({ containers });
  } catch (error) {
    next(error);
  }
};

const getContainerDetails = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const details = await dockerService.getContainerDetails(server, containerId);
    res.json({ container: details });
  } catch (error) {
    next(error);
  }
};

const getContainerLogs = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;
    const { tail = 100, follow = false, since } = req.query;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const logs = await dockerService.getContainerLogs(server, containerId, {
      tail: parseInt(tail),
      follow: follow === 'true',
      since,
    });

    if (logs.stream) {
      // For streaming, we'll handle it via WebSocket
      res.json({ message: 'Use WebSocket for streaming logs' });
    } else {
      res.json({ logs: logs.logs });
    }
  } catch (error) {
    next(error);
  }
};

const startContainer = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.startContainer(server, containerId);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const stopContainer = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.stopContainer(server, containerId);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const restartContainer = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.restartContainer(server, containerId);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const removeContainer = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;
    const { force = 'false' } = req.query;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.removeContainer(server, containerId, force === 'true');
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const getContainerStats = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const stats = await dockerService.getContainerStats(server, containerId);
    res.json({ stats });
  } catch (error) {
    next(error);
  }
};

const updateRestartPolicy = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;
    const { policy = 'unless-stopped' } = req.body;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.updateRestartPolicy(server, containerId, policy);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getContainers,
  getContainerDetails,
  getContainerLogs,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  getContainerStats,
  updateRestartPolicy,
};
