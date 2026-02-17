const sshService = require('./ssh.service');
const logger = require('../config/logger');

class DockerService {
  async listContainers(server, all = false) {
    // Use a simpler format that's more reliable
    const command = `docker ps ${all ? '-a' : ''} --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}'`;
    const result = await sshService.executeCommand(server, command);
    
    if (!result.stdout.trim()) {
      return [];
    }

    const lines = result.stdout.trim().split('\n').filter(line => line.trim());
    const containers = lines.map((line) => {
      const parts = line.split('|');
      if (parts.length >= 4) {
        return {
          ID: parts[0] || '',
          Names: parts[1] || '',
          Image: parts[2] || 'Unknown',
          Status: parts[3] || 'Unknown',
          Ports: parts[4] || '',
        };
      }
      // Fallback for malformed lines
      return {
        ID: line.substring(0, 12) || '',
        Names: '',
        Image: 'Unknown',
        Status: 'Unknown',
        Ports: '',
      };
    });

    return containers;
  }

  async getContainerDetails(server, containerId) {
    const command = `docker inspect ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    
    try {
      const details = JSON.parse(result.stdout);
      return details[0] || details;
    } catch (e) {
      throw new Error('Failed to parse container details');
    }
  }

  async getContainerLogs(server, containerId, options = {}) {
    const { tail = 100, follow = false, since } = options;
    let command = `docker logs ${containerId}`;
    
    if (tail) command += ` --tail ${tail}`;
    if (since) command += ` --since ${since}`;
    if (follow) command += ' --follow';

    if (follow) {
      // Return a stream handler
      return {
        stream: true,
        execute: (onData, onError) => {
          return sshService.executeStream(server, command, onData, onError);
        },
      };
    } else {
      const result = await sshService.executeCommand(server, command);
      return {
        stream: false,
        logs: result.stdout,
      };
    }
  }

  async startContainer(server, containerId) {
    const command = `docker start ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    return { success: result.code === 0, message: result.stdout || result.stderr };
  }

  async stopContainer(server, containerId) {
    const command = `docker stop ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    return { success: result.code === 0, message: result.stdout || result.stderr };
  }

  async restartContainer(server, containerId) {
    const command = `docker restart ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    return { success: result.code === 0, message: result.stdout || result.stderr };
  }

  async removeContainer(server, containerId, force = false) {
    const command = `docker rm ${force ? '-f' : ''} ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    return { success: result.code === 0, message: result.stdout || result.stderr };
  }

  async getContainerStats(server, containerId) {
    const command = `docker stats ${containerId} --no-stream --format '{"Container":"{{.Container}}","CPUPerc":"{{.CPUPerc}}","MemUsage":"{{.MemUsage}}","MemPerc":"{{.MemPerc}}","NetIO":"{{.NetIO}}","BlockIO":"{{.BlockIO}}","PIDs":"{{.PIDs}}"}'`;
    const result = await sshService.executeCommand(server, command);
    
    try {
      const stats = result.stdout.trim();
      if (!stats) {
        return null;
      }
      return JSON.parse(stats);
    } catch (e) {
      // Fallback parsing
      const stats = result.stdout.trim();
      return { raw: stats };
    }
  }

  async listImages(server) {
    const command = `docker images --format '{"Repository":"{{.Repository}}","Tag":"{{.Tag}}","ImageID":"{{.ID}}","Created":"{{.CreatedAt}}","Size":"{{.Size}}"}'`;
    const result = await sshService.executeCommand(server, command);
    
    if (!result.stdout.trim()) {
      return [];
    }

    const lines = result.stdout.trim().split('\n').filter(line => line.trim());
    return lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        const parts = line.split(/\s{2,}/);
        return {
          Repository: parts[0] || '',
          Tag: parts[1] || '',
          ImageID: parts[2] || '',
          Created: parts[3] || '',
          Size: parts[4] || '',
        };
      }
    });
  }

  async pullImage(server, imageName) {
    const command = `docker pull ${imageName}`;
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    return {
      success: result.code === 0,
      message: result.stdout || result.stderr,
    };
  }

  async removeImage(server, imageId, force = false) {
    const command = `docker rmi ${force ? '-f' : ''} ${imageId}`;
    const result = await sshService.executeCommand(server, command);
    return { success: result.code === 0, message: result.stdout || result.stderr };
  }

  async getSystemInfo(server) {
    const command = `docker system info`;
    const result = await sshService.executeCommand(server, command);
    
    return { raw: result.stdout };
  }
}

module.exports = new DockerService();
