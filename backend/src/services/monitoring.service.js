const { Server } = require('../models');
const dockerService = require('./docker.service');
const emailService = require('./email.service');
const logger = require('../config/logger');
const config = require('../config/config');

class MonitoringService {
  constructor() {
    this.containerStates = new Map(); // Track container states: Map<userId-serverId-containerId, { wasDown: boolean, lastAlert: Date }>
    this.noAutoRestartStates = new Map(); // Track containers without auto-restart: Map<userId-serverId-containerId, { lastAlert: Date }>
    this.isRunning = false;
    this.checkInterval = null;
    this.checkIntervalMs = parseInt(process.env.MONITORING_CHECK_INTERVAL_MS) || 60000; // Default: 1 minute
    this.alertCooldownMs = parseInt(process.env.MONITORING_ALERT_COOLDOWN_MS) || 300000; // Default: 5 minutes
  }

  async start() {
    if (this.isRunning) {
      logger.warn('Monitoring service is already running');
      return;
    }

    if (!config.email.enabled) {
      logger.info('Email alerts are disabled (EMAIL_ENABLED=false). Set EMAIL_ENABLED=true to enable email alerts.');
      return;
    }

    // Initialize email service if not already initialized
    if (!emailService.initialized) {
      await emailService.initialize();
    }

    if (!emailService.initialized) {
      logger.error('Email service failed to initialize, monitoring service will not start');
      logger.error('To enable email alerts:');
      logger.error('  1. Set EMAIL_ENABLED=true in your .env file');
      logger.error('  2. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASSWORD');
      return;
    }

    this.isRunning = true;
    logger.info(`Starting container monitoring service (check interval: ${this.checkIntervalMs}ms)`);

    // Run initial check
    this.checkContainers();

    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.checkContainers();
    }, this.checkIntervalMs);
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('Container monitoring service stopped');
  }

  async checkContainers() {
    try {
      // Get all servers
      const servers = await Server.findAll();
      
      for (const server of servers) {
        try {
          await this.checkServerContainers(server);
        } catch (error) {
          logger.error(`Failed to check containers for server ${server.id}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error in container monitoring check:', error);
    }
  }

  async checkServerContainers(server) {
    try {
      // Get all containers (including stopped ones)
      const containers = await dockerService.listContainers(server, true);
      
      logger.info(`Checking ${containers?.length || 0} containers on server ${server.name} (${server.id})`);
      
      if (!containers || containers.length === 0) {
        logger.info(`No containers found for server ${server.id}`);
        return;
      }
      
      // Get user email from server using the association
      const { User } = require('../models');
      const user = await User.findByPk(server.userId);
      if (!user || !user.email) {
        logger.warn(`No email found for user of server ${server.id}, skipping alerts`);
        return;
      }
      
      logger.info(`Checking containers for user ${user.email} on server ${server.name}`);

      for (const container of containers) {
        const containerId = container.ID || container.Id || '';
        if (!containerId) continue;

        const containerName = (container.Names || '').replace(/^\//, '') || 'unknown';
        const restartPolicy = container.RestartPolicy || container.restartPolicy || 'no';
        const hasAutoRestart = restartPolicy !== 'no' && restartPolicy !== '';
        
        // Check if container is running
        const status = container.Status || container['.Status'] || '';
        const isRunning = status.toLowerCase().includes('up') || 
                         status.toLowerCase().includes('running') ||
                         status.toLowerCase().startsWith('up');

        // Log all containers for debugging - especially looking for pihole
        if (containerName.toLowerCase().includes('pihole')) {
          logger.info(`[PIHOLE CHECK] Container ${containerId.substring(0, 12)} (${containerName}) on ${server.name}: running=${isRunning}, restartPolicy=${restartPolicy}, hasAutoRestart=${hasAutoRestart}`);
        }

        const stateKey = `${server.userId}-${server.id}-${containerId}`;
        const now = new Date();

        if (hasAutoRestart) {
          // Monitor containers with auto-restart enabled
          const previousState = this.containerStates.get(stateKey);

          if (!isRunning) {
            // Container is down
            if (!previousState) {
              // First time we see this container - initialize state as down and send alert
              logger.warn(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} is down (should be running)`);
              await this.sendDownAlert(server, container, user.email, stateKey);
            } else if (!previousState.wasDown) {
              // Container was running before, now it's down - state changed, send alert
              logger.warn(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} just went down (should be running)`);
              await this.sendDownAlert(server, container, user.email, stateKey);
            } else {
              // Container was already down - check if we need to resend alert (cooldown)
              const timeSinceLastAlert = now.getTime() - previousState.lastAlert.getTime();
              if (timeSinceLastAlert >= this.alertCooldownMs) {
                logger.warn(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} still down, resending alert`);
                await this.sendDownAlert(server, container, user.email, stateKey);
              }
            }
          } else {
            // Container is running
            if (!previousState) {
              // First time we see this container - initialize state as running (no alert needed)
              this.containerStates.set(stateKey, {
                wasDown: false,
                lastAlert: null,
              });
            } else if (previousState.wasDown) {
              // Container recovered - send recovery alert
              logger.info(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} recovered`);
              await this.sendUpAlert(server, container, user.email, stateKey);
            } else {
              // Container is still running - update state to ensure wasDown is false
              this.containerStates.set(stateKey, {
                wasDown: false,
                lastAlert: previousState.lastAlert,
              });
            }
          }
        } else if (isRunning) {
          // Container is running but doesn't have auto-restart - alert about this
          const previousState = this.noAutoRestartStates.get(stateKey);
          
          logger.info(`Found running container without auto-restart: ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name}, restart policy: ${restartPolicy}`);
          
          if (!previousState) {
            // First time we see this container - send alert
            logger.warn(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} is running without auto-restart enabled - sending alert`);
            await this.sendNoAutoRestartAlert(server, container, user.email, stateKey);
          } else {
            // Check if we need to resend alert (cooldown)
            const timeSinceLastAlert = now.getTime() - previousState.lastAlert.getTime();
            if (timeSinceLastAlert >= this.alertCooldownMs) {
              logger.warn(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} still running without auto-restart, resending alert`);
              await this.sendNoAutoRestartAlert(server, container, user.email, stateKey);
            } else {
              logger.debug(`Skipping alert for ${containerId.substring(0, 12)} - still in cooldown (${Math.round(timeSinceLastAlert / 1000)}s / ${this.alertCooldownMs / 1000}s)`);
            }
          }
        } else {
          // Container is stopped and doesn't have auto-restart - remove from tracking if it was tracked
          this.noAutoRestartStates.delete(stateKey);
        }
      }
    } catch (error) {
      logger.error(`Error checking containers for server ${server.id}:`, error);
    }
  }

  async sendDownAlert(server, container, recipient, stateKey) {
    try {
      const result = await emailService.sendContainerDownAlert(recipient, server, container);
      if (result.success) {
        this.containerStates.set(stateKey, {
          wasDown: true,
          lastAlert: new Date(),
        });
        logger.info(`Down alert sent for container ${container.ID?.substring(0, 12)} on server ${server.name}`);
      } else {
        logger.error(`Failed to send down alert: ${result.error}`);
      }
    } catch (error) {
      logger.error('Error sending down alert:', error);
    }
  }

  async sendUpAlert(server, container, recipient, stateKey) {
    try {
      const result = await emailService.sendContainerUpAlert(recipient, server, container);
      if (result.success) {
        this.containerStates.set(stateKey, {
          wasDown: false,
          lastAlert: new Date(),
        });
        logger.info(`Recovery alert sent for container ${container.ID?.substring(0, 12)} on server ${server.name}`);
      } else {
        logger.error(`Failed to send recovery alert: ${result.error}`);
      }
    } catch (error) {
      logger.error('Error sending recovery alert:', error);
    }
  }

  async sendNoAutoRestartAlert(server, container, recipient, stateKey) {
    try {
      const result = await emailService.sendNoAutoRestartAlert(recipient, server, container);
      if (result.success) {
        this.noAutoRestartStates.set(stateKey, {
          lastAlert: new Date(),
        });
        logger.info(`No auto-restart alert sent for container ${container.ID?.substring(0, 12)} on server ${server.name}`);
      } else {
        logger.error(`Failed to send no auto-restart alert: ${result.error}`);
      }
    } catch (error) {
      logger.error('Error sending no auto-restart alert:', error);
    }
  }
}

const monitoringService = new MonitoringService();

module.exports = monitoringService;
