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

  async executeCommand(server, containerId, command, options = {}) {
    // Execute a command inside a container using docker exec
    // Default to /bin/sh if no shell is specified
    const shell = options.shell || '/bin/sh';
    
    // Detect interactive commands and wrap with timeout
    // Interactive commands: more, less, vi, vim, nano, emacs, htop, top (without -b), etc.
    const interactiveCommands = ['more', 'less', 'vi ', 'vim ', 'nano ', 'emacs ', 'htop', ' top '];
    const commandLower = command.toLowerCase();
    const isInteractive = interactiveCommands.some(cmd => commandLower.includes(cmd));
    
    let finalCommand = command;
    
    // If it's an interactive command, wrap it with timeout to prevent hanging
    // Use timeout command if available, otherwise rely on SSH timeout
    if (isInteractive) {
      // Try to use timeout command (available on most Linux systems)
      // timeout 5s will kill the command after 5 seconds
      finalCommand = `timeout 5s sh -c '${command.replace(/'/g, "'\\''")}' 2>&1 || echo "Command timed out or is interactive. Use 'cat' instead of 'more' or 'less'."`;
    }
    
    // Build docker exec command - use sh -c to execute the command
    // Escape single quotes in the command
    const escapedCommand = finalCommand.replace(/'/g, "'\\''");
    const dockerCommand = `docker exec -i ${containerId} ${shell} -c '${escapedCommand}'`;
    
    const result = await sshService.executeCommand(server, dockerCommand, {
      allowFailure: true,
      timeout: options.timeout || 10000, // 10 second timeout for console commands
      ...options,
    });
    
    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      code: result.code || 0,
      success: result.code === 0,
    };
  }

  async getContainerStats(server, containerId) {
    // Try Docker API first (most reliable for full stats)
    try {
      const apiCommand = `curl -s --unix-socket /var/run/docker.sock http://localhost/containers/${containerId}/stats?stream=false 2>/dev/null`;
      const apiResult = await sshService.executeCommand(server, apiCommand, { allowFailure: true });
      
      if (apiResult.code === 0 && apiResult.stdout.trim()) {
        try {
          const stats = JSON.parse(apiResult.stdout.trim());
          // Validate we got proper stats structure
          if (stats && (stats.memory_stats || stats.cpu_stats)) {
            // Log network stats for debugging
            logger.debug('Docker API stats networks:', stats.networks ? Object.keys(stats.networks) : 'none');
            if (stats.networks) {
              Object.entries(stats.networks).forEach(([iface, data]) => {
                logger.debug(`Network ${iface}: rx_bytes=${data.rx_bytes}, tx_bytes=${data.tx_bytes}`);
              });
            }
            
            // Ensure networks object exists and has proper structure with actual stats
            if (!stats.networks || Object.keys(stats.networks).length === 0 || 
                Object.values(stats.networks).every(net => (net.rx_bytes || 0) === 0 && (net.tx_bytes || 0) === 0)) {
              // Try to get network stats from /proc/net/dev (most reliable for cumulative stats)
              try {
                const pidCommand = `docker inspect ${containerId} --format '{{.State.Pid}}'`;
                const pidResult = await sshService.executeCommand(server, pidCommand, { allowFailure: true });
                
                if (pidResult.code === 0 && pidResult.stdout.trim()) {
                  const pid = pidResult.stdout.trim();
                  // Read network stats from /proc/net/dev (cumulative since container start)
                  const procNetCommand = `cat /proc/${pid}/net/dev 2>/dev/null | grep -E 'eth0|veth' | head -1`;
                  const procNetResult = await sshService.executeCommand(server, procNetCommand, { allowFailure: true });
                  
                  // Get network interface names from docker inspect
                  const networkCommand = `docker inspect ${containerId} --format '{{json .NetworkSettings.Networks}}'`;
                  const networkResult = await sshService.executeCommand(server, networkCommand, { allowFailure: true });
                  
                  let netRxBytes = 0;
                  let netTxBytes = 0;
                  
                  if (procNetResult.code === 0 && procNetResult.stdout.trim()) {
                    // Parse /proc/net/dev format: interface: rx_bytes rx_packets ... tx_bytes tx_packets ...
                    const parts = procNetResult.stdout.trim().split(/\s+/);
                    if (parts.length >= 10) {
                      netRxBytes = parseInt(parts[1]) || 0;
                      netTxBytes = parseInt(parts[9]) || 0;
                    }
                  }
                  
                  if (networkResult.code === 0 && networkResult.stdout.trim()) {
                    const networkData = JSON.parse(networkResult.stdout.trim());
                    if (networkData && typeof networkData === 'object') {
                      stats.networks = {};
                      Object.keys(networkData).forEach(iface => {
                        stats.networks[iface] = {
                          rx_bytes: netRxBytes,
                          tx_bytes: netTxBytes,
                          rx_packets: 0,
                          tx_packets: 0,
                          rx_errors: 0,
                          tx_errors: 0,
                          rx_dropped: 0,
                          tx_dropped: 0,
                        };
                      });
                    }
                  } else if (netRxBytes > 0 || netTxBytes > 0) {
                    // If we have stats but no interface names, create default
                    stats.networks = {
                      eth0: {
                        rx_bytes: netRxBytes,
                        tx_bytes: netTxBytes,
                        rx_packets: 0,
                        tx_packets: 0,
                        rx_errors: 0,
                        tx_errors: 0,
                        rx_dropped: 0,
                        tx_dropped: 0,
                      }
                    };
                  }
                }
              } catch (e) {
                logger.debug('Failed to get network stats from /proc:', e.message);
              }
            }
            return stats;
          }
        } catch (parseError) {
          logger.debug('Failed to parse Docker API response, trying fallback');
        }
      }
    } catch (apiError) {
      logger.debug('Docker API not available, using fallback method');
    }
    
    // Fallback: Use docker stats and docker inspect to build stats object
    try {
      // Get basic stats from docker stats
      const statsCommand = `docker stats ${containerId} --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}'`;
      const statsResult = await sshService.executeCommand(server, statsCommand, { allowFailure: true });
      
      // Get detailed info from docker inspect
      const inspectCommand = `docker inspect ${containerId} --format '{{json .HostConfig.Memory}}|{{json .State.Pid}}'`;
      const inspectResult = await sshService.executeCommand(server, inspectCommand, { allowFailure: true });
      
      let cpuPercent = 0;
      let memUsage = 0;
      let memLimit = 0;
      let memPercent = 0;
      let pids = 0;
      let netRx = 0;
      let netTx = 0;
      
      if (statsResult.code === 0 && statsResult.stdout.trim()) {
        const parts = statsResult.stdout.trim().split('|');
        if (parts.length >= 6) {
          cpuPercent = parseFloat(parts[0].replace('%', '').trim()) || 0;
          pids = parseInt(parts[5] || '0') || 0;
          
          // Parse memory (e.g., "1.2GiB / 15.62GiB")
          const memStr = parts[1].trim();
          const memParts = memStr.split('/');
          if (memParts.length === 2) {
            memUsage = this.parseSize(memParts[0].trim());
            memLimit = this.parseSize(memParts[1].trim());
          }
          memPercent = parseFloat(parts[2].replace('%', '').trim()) || 0;
          
          // Parse NetIO (e.g., "1.2MB / 500KB" or "1.2MiB / 500KiB")
          if (parts[3]) {
            const netParts = parts[3].trim().split('/');
            if (netParts.length === 2) {
              netRx = this.parseSize(netParts[0].trim());
              netTx = this.parseSize(netParts[1].trim());
            }
          }
        }
      }
      
      // Get memory limit from inspect if available
      if (inspectResult.code === 0 && inspectResult.stdout.trim()) {
        const inspectParts = inspectResult.stdout.trim().split('|');
        if (inspectParts[0] && inspectParts[0] !== 'null' && inspectParts[0] !== '0') {
          try {
            const memoryLimit = parseInt(inspectParts[0]);
            if (memoryLimit > 0) {
              memLimit = memoryLimit;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
      
      // If we still don't have memLimit, try to get it from the container
      if (memLimit === 0) {
        try {
          const memInfoCommand = `docker inspect ${containerId} --format '{{.HostConfig.Memory}}'`;
          const memInfoResult = await sshService.executeCommand(server, memInfoCommand, { allowFailure: true });
          if (memInfoResult.code === 0 && memInfoResult.stdout.trim()) {
            const limit = parseInt(memInfoResult.stdout.trim());
            if (limit > 0) {
              memLimit = limit;
            }
          }
        } catch (e) {
          // Ignore
        }
      }
      
      // Get network interface details and actual stats from container's network namespace
      let networks = {};
      try {
        // First, get network interface names
        const networkCommand = `docker inspect ${containerId} --format '{{json .NetworkSettings.Networks}}'`;
        const networkResult = await sshService.executeCommand(server, networkCommand, { allowFailure: true });
        
        if (networkResult.code === 0 && networkResult.stdout.trim()) {
          try {
            const networkData = JSON.parse(networkResult.stdout.trim());
            if (networkData && typeof networkData === 'object') {
              // Get the container's PID to access /proc/net/dev
              const pidCommand = `docker inspect ${containerId} --format '{{.State.Pid}}'`;
              const pidResult = await sshService.executeCommand(server, pidCommand, { allowFailure: true });
              
              if (pidResult.code === 0 && pidResult.stdout.trim()) {
                const pid = pidResult.stdout.trim();
                // Read network stats from /proc/net/dev (cumulative since container start)
                const procNetCommand = `cat /proc/${pid}/net/dev 2>/dev/null | grep -E 'eth0|veth' | head -1`;
                const procNetResult = await sshService.executeCommand(server, procNetCommand, { allowFailure: true });
                
                let actualRxBytes = netRx || 0;
                let actualTxBytes = netTx || 0;
                
                if (procNetResult.code === 0 && procNetResult.stdout.trim()) {
                  // Parse /proc/net/dev format: interface: rx_bytes rx_packets ... tx_bytes tx_packets ...
                  const parts = procNetResult.stdout.trim().split(/\s+/);
                  if (parts.length >= 10) {
                    actualRxBytes = parseInt(parts[1]) || 0;
                    actualTxBytes = parseInt(parts[9]) || 0;
                  }
                }
                
                // Create network objects with cumulative stats
                Object.keys(networkData).forEach(iface => {
                  networks[iface] = {
                    rx_bytes: actualRxBytes,
                    tx_bytes: actualTxBytes,
                    rx_packets: 0,
                    tx_packets: 0,
                    rx_errors: 0,
                    tx_errors: 0,
                    rx_dropped: 0,
                    tx_dropped: 0,
                  };
                });
              } else {
                // Fallback: use NetIO from docker stats if we can't get /proc/net/dev
                Object.keys(networkData).forEach(iface => {
                  networks[iface] = {
                    rx_bytes: netRx || 0,
                    tx_bytes: netTx || 0,
                    rx_packets: 0,
                    tx_packets: 0,
                    rx_errors: 0,
                    tx_errors: 0,
                    rx_dropped: 0,
                    tx_dropped: 0,
                  };
                });
              }
            }
          } catch (e) {
            logger.debug('Failed to parse network data:', e.message);
          }
        }
      } catch (e) {
        logger.debug('Failed to get network data:', e.message);
      }
      
      // If we have network stats but no network interfaces, create a default one
      if (Object.keys(networks).length === 0) {
        // Try to get actual network stats from /proc/net/dev
        try {
          const pidCommand = `docker inspect ${containerId} --format '{{.State.Pid}}'`;
          const pidResult = await sshService.executeCommand(server, pidCommand, { allowFailure: true });
          
          if (pidResult.code === 0 && pidResult.stdout.trim()) {
            const pid = pidResult.stdout.trim();
            const procNetCommand = `cat /proc/${pid}/net/dev 2>/dev/null | grep -E 'eth0|veth' | head -1`;
            const procNetResult = await sshService.executeCommand(server, procNetCommand, { allowFailure: true });
            
            let actualRxBytes = netRx || 0;
            let actualTxBytes = netTx || 0;
            
            if (procNetResult.code === 0 && procNetResult.stdout.trim()) {
              const parts = procNetResult.stdout.trim().split(/\s+/);
              if (parts.length >= 10) {
                actualRxBytes = parseInt(parts[1]) || 0;
                actualTxBytes = parseInt(parts[9]) || 0;
              }
            }
            
            networks.eth0 = {
              rx_bytes: actualRxBytes,
              tx_bytes: actualTxBytes,
              rx_packets: 0,
              tx_packets: 0,
              rx_errors: 0,
              tx_errors: 0,
              rx_dropped: 0,
              tx_dropped: 0,
            };
          } else {
            // Last resort: use NetIO from docker stats
            networks.eth0 = {
              rx_bytes: netRx || 0,
              tx_bytes: netTx || 0,
              rx_packets: 0,
              tx_packets: 0,
              rx_errors: 0,
              tx_errors: 0,
              rx_dropped: 0,
              tx_dropped: 0,
            };
          }
        } catch (e) {
          logger.debug('Failed to get network stats from /proc:', e.message);
          // Last resort
          if (netRx > 0 || netTx > 0) {
            networks.eth0 = {
              rx_bytes: netRx,
              tx_bytes: netTx,
              rx_packets: 0,
              tx_packets: 0,
              rx_errors: 0,
              tx_errors: 0,
              rx_dropped: 0,
              tx_dropped: 0,
            };
          }
        }
      }
      
      // Construct stats object compatible with frontend expectations
      return {
        memory_stats: {
          usage: memUsage,
          limit: memLimit || (memUsage > 0 ? Math.round(memUsage / (memPercent / 100)) : 0),
          max_usage: memUsage,
        },
        cpu_stats: {
          cpu_usage: {
            total_usage: 0,
          },
          system_cpu_usage: 0,
          online_cpus: 1,
        },
        precpu_stats: {
          cpu_usage: {
            total_usage: 0,
          },
          system_cpu_usage: 0,
        },
        networks: networks,
        blkio_stats: {
          io_service_bytes_recursive: [],
        },
        pids_stats: {
          current: pids,
        },
        _cpuPercent: cpuPercent,
        _memPercent: memPercent,
      };
    } catch (e) {
      logger.error('Failed to get container stats:', e);
      return null;
    }
  }

  parseSize(sizeStr) {
    // Parse size strings like "1.2GiB", "500MiB", "1024B" to bytes
    if (!sizeStr) return 0;
    
    const units = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'TB': 1024 * 1024 * 1024 * 1024,
      'KiB': 1024,
      'MiB': 1024 * 1024,
      'GiB': 1024 * 1024 * 1024,
      'TiB': 1024 * 1024 * 1024 * 1024,
    };
    
    const match = sizeStr.trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2];
      return Math.round(value * (units[unit] || 1));
    }
    
    return 0;
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

  async commitContainer(server, containerId, imageName, tag = 'snapshot') {
    // Commit container to an image
    // Format: imageName:tag
    const fullImageName = tag ? `${imageName}:${tag}` : imageName;
    const command = `docker commit ${containerId} ${fullImageName}`;
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    
    if (result.code !== 0) {
      throw new Error(`Failed to commit container: ${result.stderr || result.stdout}`);
    }
    
    return {
      success: true,
      imageName: fullImageName,
      message: `Container committed to image: ${fullImageName}`,
    };
  }

  async exportImage(server, imageName, outputPath) {
    // Export image to a tar file
    // docker save -o outputPath imageName
    const command = `docker save -o ${outputPath} ${imageName}`;
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    
    if (result.code !== 0) {
      throw new Error(`Failed to export image: ${result.stderr || result.stdout}`);
    }
    
    return {
      success: true,
      filePath: outputPath,
      message: `Image exported to: ${outputPath}`,
    };
  }

  async downloadFile(server, remotePath) {
    // Download a file from the remote server using SSH SFTP
    const ssh = await sshService.connect(server);
    
    return new Promise((resolve, reject) => {
      ssh.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP connection failed: ${err.message}`));
          return;
        }

        sftp.readFile(remotePath, (err, data) => {
          if (err) {
            reject(new Error(`Failed to read file ${remotePath}: ${err.message}`));
            return;
          }
          resolve(data);
        });
      });
    });
  }

  async deleteFile(server, filePath) {
    // Delete a file from the remote server
    const command = `rm -f ${filePath}`;
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    return { success: result.code === 0 };
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

  async getSnapshotsForContainer(server, containerId) {
    // Get container details to extract the container name
    let containerName = '';
    try {
      const containerDetails = await this.getContainerDetails(server, containerId);
      // Extract container name - Docker returns it with leading slash
      containerName = containerDetails.Name?.replace(/^\//, '') || 
                      containerDetails.Name || 
                      containerDetails.Config?.Hostname || 
                      '';
      
      // Also try alternative name fields
      if (!containerName) {
        containerName = containerDetails.Config?.Labels?.['com.docker.compose.service'] ||
                       containerDetails.Config?.Labels?.['io.kubernetes.container.name'] ||
                       '';
      }
      
      logger.debug(`Container name extracted for ${containerId}: "${containerName}"`);
    } catch (error) {
      logger.error('Failed to get container details for snapshot filtering:', error);
    }

    if (!containerName) {
      logger.warn(`Could not extract container name for ${containerId}, returning empty snapshots list`);
      return [];
    }

    // Get all images
    const command = `docker images --format '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.CreatedAt}}'`;
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    
    if (!result.stdout.trim()) {
      logger.debug('No images found on server');
      return [];
    }

    const lines = result.stdout.trim().split('\n').filter(line => line.trim());
    const images = [];
    
    // Normalize container name for matching (lowercase, no special chars)
    const normalizedContainerName = containerName.toLowerCase().trim();
    const snapshotPrefix = `${normalizedContainerName}-snapshot`;
    
    logger.debug(`Looking for snapshots with prefix: "${snapshotPrefix}"`);
    logger.debug(`Total images to check: ${lines.length}`);
    
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length >= 3) {
        const fullImageName = parts[0]; // Format: repository:tag
        const [repository, tag] = fullImageName.split(':');
        const normalizedRepository = repository.toLowerCase().trim();
        const normalizedFullName = fullImageName.toLowerCase();
        
        // Check if repository matches the pattern: <containerName>-snapshot
        // The repository should start with the snapshot prefix
        // Examples: "dispatcharr-snapshot" or "dispatcharr-snapshot-v1" should match
        const matchesRepository = normalizedRepository === snapshotPrefix || 
                                  normalizedRepository.startsWith(`${snapshotPrefix}-`) ||
                                  normalizedRepository.startsWith(`${snapshotPrefix}:`);
        
        // Also check the full image name as fallback (repository:tag format)
        const matchesFullName = normalizedFullName.startsWith(`${snapshotPrefix}:`) ||
                               normalizedFullName.startsWith(`${snapshotPrefix}-`);
        
        if (matchesRepository || matchesFullName) {
          logger.debug(`Found matching snapshot: ${fullImageName} (repository: ${repository}, matches: ${matchesRepository || matchesFullName})`);
          images.push({
            name: fullImageName,
            id: parts[1],
            created: parts[2],
          });
        } else {
          logger.debug(`Skipping image ${fullImageName} (repository: ${repository}, expected prefix: ${snapshotPrefix})`);
        }
      }
    }

    logger.debug(`Returning ${images.length} snapshots for container ${containerName}`);
    return images;
  }

  async createContainerFromImage(server, imageName, containerName, options = {}) {
    // Create a new container from an image
    // docker create --name containerName imageName
    let command = `docker create`;
    
    if (containerName) {
      command += ` --name ${containerName}`;
    }
    
    // Add port mappings if provided
    if (options.ports && options.ports.length > 0) {
      options.ports.forEach(port => {
        command += ` -p ${port}`;
      });
    }
    
    // Add environment variables if provided
    if (options.env && options.env.length > 0) {
      options.env.forEach(env => {
        command += ` -e ${env}`;
      });
    }
    
    // Add restart policy
    if (options.restart) {
      command += ` --restart=${options.restart}`;
    }
    
    command += ` ${imageName}`;
    
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    
    if (result.code !== 0) {
      throw new Error(`Failed to create container: ${result.stderr || result.stdout}`);
    }
    
    // Extract container ID from output
    const containerId = result.stdout.trim();
    
    return {
      success: true,
      containerId: containerId,
      message: `Container created from image ${imageName}`,
    };
  }
}

module.exports = new DockerService();
