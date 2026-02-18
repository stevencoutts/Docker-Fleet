const fs = require('fs');
const path = require('path');
const { Server } = require('../../models');
const dockerService = require('../../services/docker.service');
const { groupContainers } = require('../grouping/grouping.controller');
const sshService = require('../../services/ssh.service');
const logger = require('../../config/logger');

const CONTAINER_UPDATES_LOG = path.join(process.cwd(), 'logs', 'container-updates.log');
function appendContainerUpdateLog(entry) {
  try {
    const dir = path.dirname(CONTAINER_UPDATES_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(CONTAINER_UPDATES_LOG, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    logger.warn('Could not write container-updates.log', e.message);
  }
}

const getContainers = async (req, res, next) => {
  try {
    const { serverId } = req.params;
    const { all = 'false', grouped = 'false' } = req.query;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const containers = await dockerService.listContainers(server, all === 'true');
    
    // If grouping is requested, group the containers
    if (grouped === 'true') {
      const { grouped: groupedContainers, ungrouped } = await groupContainers(req.user.id, containers);
      return res.json({ 
        containers,
        grouped: groupedContainers,
        ungrouped,
      });
    }
    
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

const getContainerUpdateStatus = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const status = await dockerService.getContainerUpdateStatus(server, containerId);
    res.json({ updateStatus: status });
  } catch (error) {
    next(error);
  }
};

const pullAndRecreateContainer = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;
    const socketIO = require('../../config/socket').getIO();

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const onStep = (step, success, detail) => {
      if (socketIO) socketIO.emit('container:update:progress', { serverId, containerId, step, success, detail });
    };
    const result = await dockerService.pullAndRecreateContainer(server, containerId, { onStep });

    if (result.success && result.containerName) {
      appendContainerUpdateLog({
        timestamp: new Date().toISOString(),
        serverId,
        previousContainerId: containerId,
        newContainerId: result.newContainerId,
        containerName: result.containerName,
        previousImageRef: result.previousImageRef,
        newImageRef: result.newImageRef,
        previousVersion: result.previousVersion,
        newVersion: result.newVersion,
      });
    }

    if (socketIO && result.success) {
      socketIO.emit('container:status:changed', {
        serverId,
        containerId: result.newContainerId || containerId,
        action: 'recreated',
        userId: req.user.id,
      });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
};

const recreateContainer = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;
    const socketIO = require('../../config/socket').getIO();

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const onStep = (step, success, detail) => {
      if (socketIO) socketIO.emit('container:update:progress', { serverId, containerId, step, success, detail });
    };
    const result = await dockerService.recreateContainer(server, containerId, { onStep });

    if (socketIO && result.success) {
      socketIO.emit('container:status:changed', {
        serverId,
        containerId: result.newContainerId || containerId,
        action: 'recreated',
        userId: req.user.id,
      });
    }

    res.json(result);
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
    const socketIO = require('../../config/socket').getIO();

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.startContainer(server, containerId);
    
    // Emit WebSocket event to notify all clients of status change
    if (socketIO && result.success !== false) {
      socketIO.emit('container:status:changed', {
        serverId,
        containerId,
        action: 'started',
        userId: req.user.id,
      });
    }
    
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const stopContainer = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;
    const socketIO = require('../../config/socket').getIO();

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.stopContainer(server, containerId);
    
    // Emit WebSocket event to notify all clients of status change
    if (socketIO && result.success !== false) {
      socketIO.emit('container:status:changed', {
        serverId,
        containerId,
        action: 'stopped',
        userId: req.user.id,
      });
    }
    
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const restartContainer = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;
    const socketIO = require('../../config/socket').getIO();

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.restartContainer(server, containerId);
    
    // Emit WebSocket event to notify all clients of status change
    if (socketIO && result.success !== false) {
      socketIO.emit('container:status:changed', {
        serverId,
        containerId,
        action: 'restarted',
        userId: req.user.id,
      });
    }
    
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
    const socketIO = require('../../config/socket').getIO();

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.updateRestartPolicy(server, containerId, policy);
    
    // Emit WebSocket event to notify all clients of restart policy change
    if (socketIO && result.success !== false) {
      socketIO.emit('container:status:changed', {
        serverId,
        containerId,
        action: 'restart-policy-updated',
        userId: req.user.id,
      });
    }
    
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const executeCommand = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;
    const { command, shell } = req.body;

    if (!command || !command.trim()) {
      return res.status(400).json({ error: 'Command is required' });
    }

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.executeCommand(server, containerId, command, {
      shell: shell || '/bin/sh',
      interactive: false,
      tty: false,
    });

    res.json({
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    });
  } catch (error) {
    logger.error(`Failed to execute command in container ${req.params.containerId}:`, error);
    next(error);
  }
};

const getSnapshots = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const snapshots = await dockerService.getSnapshotsForContainer(server, containerId);
    res.json({ snapshots });
  } catch (error) {
    logger.error(`Failed to get snapshots for container ${req.params.containerId}:`, error);
    next(error);
  }
};

const restoreSnapshot = async (req, res, next) => {
  try {
    const { serverId: sourceServerId } = req.params;
    const { imageName, containerName, ports, env, restart, targetServerId } = req.body;

    if (!imageName || !imageName.trim()) {
      return res.status(400).json({ error: 'Image name is required' });
    }

    const sourceServer = await Server.findOne({
      where: { id: sourceServerId, userId: req.user.id },
    });
    if (!sourceServer) {
      return res.status(404).json({ error: 'Source server not found' });
    }

    const targetId = targetServerId && targetServerId.trim() ? targetServerId.trim() : sourceServerId;
    const isCrossServer = targetId !== sourceServerId;

    let targetServer = sourceServer;
    if (isCrossServer) {
      targetServer = await Server.findOne({
        where: { id: targetId, userId: req.user.id },
      });
      if (!targetServer) {
        return res.status(404).json({ error: 'Target server not found' });
      }
      // Export image from source, then load on target and create container
      const exportFileName = `/tmp/dockerfleet-restore-${Date.now()}-${Math.random().toString(36).slice(2)}.tar`;
      try {
        await dockerService.exportImage(sourceServer, imageName.trim(), exportFileName);
        const fileData = await dockerService.downloadFile(sourceServer, exportFileName);
        await dockerService.deleteFile(sourceServer, exportFileName);
        await dockerService.loadImageFromTar(targetServer, fileData);
      } catch (transferError) {
        logger.error('Snapshot transfer to target server failed:', transferError);
        throw transferError;
      }
    }

    const result = await dockerService.createContainerFromImage(targetServer, imageName.trim(), containerName, {
      ports,
      env,
      restart: restart || 'unless-stopped',
    });

    res.json(result);
  } catch (error) {
    logger.error(`Failed to restore snapshot:`, error);
    next(error);
  }
};

const createSnapshot = async (req, res, next) => {
  try {
    const { serverId, containerId } = req.params;
    const { imageName, tag, download = false } = req.body;

    if (!imageName || !imageName.trim()) {
      return res.status(400).json({ error: 'Image name is required' });
    }

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const snapshotTag = tag || 'snapshot';
    const fullImageName = `${imageName}:${snapshotTag}`;

    // Step 1: Commit container to image (this keeps it on the server)
    logger.info(`Committing container ${containerId} to image ${fullImageName}`);
    const commitResult = await dockerService.commitContainer(server, containerId, imageName, snapshotTag);

    let fileData = null;
    let downloadFileName = null;

    // Step 2: If download is requested, export and download the image
    if (download === true || download === 'true') {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const exportFileName = `/tmp/${imageName}-${snapshotTag}-${timestamp}.tar`;

      try {
        // Export image to tar file
        logger.info(`Exporting image ${commitResult.imageName} to ${exportFileName}`);
        await dockerService.exportImage(server, commitResult.imageName, exportFileName);

        // Download the file
        logger.info(`Downloading file ${exportFileName} from server`);
        fileData = await dockerService.downloadFile(server, exportFileName);

        // Clean up the file on remote server
        await dockerService.deleteFile(server, exportFileName);

        downloadFileName = `${imageName}-${snapshotTag}-${timestamp}.tar`;
      } catch (exportError) {
        logger.error('Failed to export/download snapshot, but image is saved on server:', exportError);
        // Continue even if export fails - the image is still saved on the server
      }
    }

    // If download was requested and successful, send file
    if (fileData && downloadFileName) {
      res.setHeader('Content-Type', 'application/x-tar');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);
      res.setHeader('Content-Length', fileData.length);
      res.send(fileData);
    } else {
      // Otherwise, just return success with image info
      res.json({
        success: true,
        message: `Snapshot created successfully. Image saved as ${fullImageName}`,
        imageName: fullImageName,
        image: commitResult.imageName,
      });
    }
  } catch (error) {
    logger.error(`Failed to create snapshot for container ${req.params.containerId}:`, error);
    next(error);
  }
};

const deployContainer = async (req, res, next) => {
  try {
    const { serverId } = req.params;
    const { imageName, containerName, ports, env, restart, pullFirst } = req.body;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.deployContainer(server, {
      imageName,
      containerName,
      ports: Array.isArray(ports) ? ports : undefined,
      env: Array.isArray(env) ? env : undefined,
      restart: restart || 'unless-stopped',
      pullFirst: pullFirst !== false,
    });

    const socketIO = require('../../config/socket').getIO();
    if (socketIO && result.success) {
      socketIO.emit('container:status:changed', {
        serverId,
        containerId: result.containerId,
        action: 'deployed',
        userId: req.user.id,
      });
    }

    res.status(201).json(result);
  } catch (error) {
    logger.error('Deploy container failed:', error);
    next(error);
  }
};

module.exports = {
  getContainers,
  getContainerDetails,
  getContainerUpdateStatus,
  pullAndRecreateContainer,
  recreateContainer,
  deployContainer,
  getContainerLogs,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  getContainerStats,
  updateRestartPolicy,
  executeCommand,
  createSnapshot,
  getSnapshots,
  restoreSnapshot,
};
