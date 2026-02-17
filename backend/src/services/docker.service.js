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
    const containers = [];
    const containerIds = [];
    
    // First pass: parse container data
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length >= 4) {
        const containerId = parts[0] || '';
        containerIds.push(containerId);
        containers.push({
          ID: containerId,
          Names: parts[1] || '',
          Image: parts[2] || 'Unknown',
          Status: parts[3] || 'Unknown',
          Ports: parts[4] || '',
          RestartPolicy: 'no', // Default, will be updated
        });
      } else {
        // Fallback for malformed lines
        containers.push({
          ID: line.substring(0, 12) || '',
          Names: '',
          Image: 'Unknown',
          Status: 'Unknown',
          Ports: '',
          RestartPolicy: 'no',
        });
      }
    }

    // Batch fetch restart policies for all containers at once
    if (containerIds.length > 0) {
      try {
        // Use docker inspect with multiple IDs to get all restart policies in one command
        const idsString = containerIds.join(' ');
        const inspectCommand = `docker inspect ${idsString} --format '{{.Id}}|{{.HostConfig.RestartPolicy.Name}}'`;
        const inspectResult = await sshService.executeCommand(server, inspectCommand, { allowFailure: true });
        
        if (inspectResult && inspectResult.stdout) {
          const policyLines = inspectResult.stdout.trim().split('\n').filter(line => line.trim());
          const policyMap = {};
          
          for (const policyLine of policyLines) {
            const [id, policy] = policyLine.split('|');
            if (id && policy) {
              // Docker inspect returns full ID, but we need to match with short ID
              const shortId = id.substring(0, 12);
              policyMap[shortId] = policy.trim() || 'no';
            }
          }
          
          // Update containers with restart policies
          containers.forEach(container => {
            const shortId = container.ID.substring(0, 12);
            if (policyMap[shortId]) {
              container.RestartPolicy = policyMap[shortId];
            }
          });
        }
      } catch (error) {
        logger.debug('Failed to batch fetch restart policies:', error.message);
        // Fallback: try individual fetches for first few containers only
        for (let i = 0; i < Math.min(containers.length, 5); i++) {
          try {
            const inspectCommand = `docker inspect ${containers[i].ID} --format '{{.HostConfig.RestartPolicy.Name}}'`;
            const inspectResult = await sshService.executeCommand(server, inspectCommand, { allowFailure: true });
            if (inspectResult && inspectResult.stdout) {
              containers[i].RestartPolicy = inspectResult.stdout.trim() || 'no';
            }
          } catch (e) {
            // Ignore individual failures
          }
        }
      }
    }

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

  async updateRestartPolicy(server, containerId, policy = 'unless-stopped') {
    // Valid policies: no, always, on-failure, unless-stopped
    const validPolicies = ['no', 'always', 'on-failure', 'unless-stopped'];
    if (!validPolicies.includes(policy)) {
      throw new Error(`Invalid restart policy: ${policy}. Must be one of: ${validPolicies.join(', ')}`);
    }

    // Use docker update to change restart policy
    const command = `docker update --restart=${policy} ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    
    if (result.code !== 0) {
      throw new Error(`Failed to update restart policy: ${result.stderr || result.stdout}`);
    }
    
    return { 
      success: true, 
      message: `Restart policy updated to: ${policy}`,
      restartPolicy: policy
    };
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

  async getHostInfo(server) {
    const results = {};
    
    // Basic system info - simple commands first
    try {
      const archResult = await sshService.executeCommand(server, 'uname -m', { allowFailure: true });
      results.architecture = (archResult && archResult.stdout) ? archResult.stdout.trim() : 'Unknown';
    } catch (error) {
      logger.warn('Architecture command failed:', error.message);
      results.architecture = 'Unknown';
    }

    try {
      const kernelResult = await sshService.executeCommand(server, 'uname -r', { allowFailure: true });
      results.kernel = (kernelResult && kernelResult.stdout) ? kernelResult.stdout.trim() : 'Unknown';
    } catch (error) {
      logger.debug('Kernel command failed:', error.message);
      results.kernel = 'Unknown';
    }

    try {
      const osResult = await sshService.executeCommand(server, 'uname -s', { allowFailure: true });
      results.os = (osResult && osResult.stdout) ? osResult.stdout.trim() : 'Unknown';
    } catch (error) {
      logger.debug('OS command failed:', error.message);
      results.os = 'Unknown';
    }

    try {
      const hostnameResult = await sshService.executeCommand(server, 'hostname', { allowFailure: true });
      results.hostname = (hostnameResult && hostnameResult.stdout) ? hostnameResult.stdout.trim() : 'Unknown';
    } catch (error) {
      logger.debug('Hostname command failed:', error.message);
      results.hostname = 'Unknown';
    }

    // CPU info
    try {
      const cpuCoresResult = await sshService.executeCommand(server, 'nproc', { allowFailure: true });
      results.cpuCores = (cpuCoresResult && cpuCoresResult.stdout) ? cpuCoresResult.stdout.trim() : 'Unknown';
    } catch (error) {
      logger.debug('CPU cores command failed:', error.message);
      results.cpuCores = 'Unknown';
    }

    try {
      const cpuModelResult = await sshService.executeCommand(server, 'cat /proc/cpuinfo | grep "model name" | head -1', { allowFailure: true });
      if (cpuModelResult && cpuModelResult.stdout) {
        const modelLine = cpuModelResult.stdout.trim();
        results.cpuModel = modelLine ? (modelLine.split(':')[1]?.trim() || 'Unknown') : 'Unknown';
      } else {
        results.cpuModel = 'Unknown';
      }
    } catch (error) {
      logger.debug('CPU model command failed:', error.message);
      results.cpuModel = 'Unknown';
    }

    // Memory info - using simpler commands
    try {
      const memResult = await sshService.executeCommand(server, 'free -h', { allowFailure: true });
      if (memResult && memResult.stdout) {
        const memLines = memResult.stdout.split('\n');
        const memLine = memLines.find(line => line.includes('Mem:'));
        if (memLine) {
          const parts = memLine.split(/\s+/);
          results.totalMemory = parts[1] || 'Unknown';
          results.usedMemory = parts[2] || 'Unknown';
          results.availableMemory = parts[6] || parts[3] || 'Unknown';
        } else {
          results.totalMemory = 'Unknown';
          results.usedMemory = 'Unknown';
          results.availableMemory = 'Unknown';
        }
      } else {
        results.totalMemory = 'Unknown';
        results.usedMemory = 'Unknown';
        results.availableMemory = 'Unknown';
      }
    } catch (error) {
      logger.debug('Memory command failed:', error.message);
      results.totalMemory = 'Unknown';
      results.usedMemory = 'Unknown';
      results.availableMemory = 'Unknown';
    }

    // Disk usage
    try {
      const diskResult = await sshService.executeCommand(server, 'df -h /', { allowFailure: true });
      if (diskResult && diskResult.stdout) {
        const diskLines = diskResult.stdout.split('\n');
        if (diskLines.length > 1) {
          const parts = diskLines[1].split(/\s+/);
          if (parts.length >= 5) {
            results.diskUsage = `${parts[2]} / ${parts[1]} (${parts[4]} used)`;
          } else {
            results.diskUsage = 'Unknown';
          }
        } else {
          results.diskUsage = 'Unknown';
        }
      } else {
        results.diskUsage = 'Unknown';
      }
    } catch (error) {
      logger.debug('Disk usage command failed:', error.message);
      results.diskUsage = 'Unknown';
    }

    // Uptime
    try {
      const uptimeResult = await sshService.executeCommand(server, 'uptime -p', { allowFailure: true });
      if (uptimeResult && uptimeResult.code === 0 && uptimeResult.stdout && uptimeResult.stdout.trim()) {
        results.uptime = uptimeResult.stdout.trim();
      } else {
        // Fallback to regular uptime
        try {
          const uptimeFallback = await sshService.executeCommand(server, 'uptime', { allowFailure: true });
          if (uptimeFallback && uptimeFallback.stdout) {
            const uptimeStr = uptimeFallback.stdout.trim();
            const match = uptimeStr.match(/up\s+(.+?)(?:,\s+\d+\s+users)?/);
            results.uptime = match ? match[1].trim() : 'Unknown';
          } else {
            results.uptime = 'Unknown';
          }
        } catch {
          results.uptime = 'Unknown';
        }
      }
    } catch (error) {
      logger.debug('Uptime command failed:', error.message);
      results.uptime = 'Unknown';
    }

    // Docker version
    try {
      const dockerResult = await sshService.executeCommand(server, 'docker --version', { allowFailure: true });
      results.dockerVersion = (dockerResult && dockerResult.stdout) ? dockerResult.stdout.trim() : 'Unknown';
    } catch (error) {
      logger.debug('Docker version command failed:', error.message);
      results.dockerVersion = 'Unknown';
    }

    // CPU usage - simplified
    try {
      const cpuUsageResult = await sshService.executeCommand(server, "grep '^cpu ' /proc/stat | awk '{usage=($2+$4)*100/($2+$4+$5)} END {print usage}'", { allowFailure: true });
      if (cpuUsageResult && cpuUsageResult.stdout) {
        const cpuUsage = parseFloat(cpuUsageResult.stdout.trim());
        results.cpuUsage = !isNaN(cpuUsage) ? `${cpuUsage.toFixed(1)}%` : 'Unknown';
      } else {
        results.cpuUsage = 'Unknown';
      }
    } catch (error) {
      logger.debug('CPU usage command failed:', error.message);
      results.cpuUsage = 'Unknown';
    }

    // Load average
    try {
      const loadResult = await sshService.executeCommand(server, 'cat /proc/loadavg', { allowFailure: true });
      if (loadResult && loadResult.stdout) {
        const parts = loadResult.stdout.trim().split(/\s+/);
        if (parts.length >= 3) {
          results.loadAverage = `${parts[0]} ${parts[1]} ${parts[2]}`;
        } else {
          results.loadAverage = 'Unknown';
        }
      } else {
        results.loadAverage = 'Unknown';
      }
    } catch (error) {
      logger.debug('Load average command failed:', error.message);
      results.loadAverage = 'Unknown';
    }

    return results;
  }
}

module.exports = new DockerService();
