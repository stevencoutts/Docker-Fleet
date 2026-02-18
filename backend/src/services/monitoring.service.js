const { Server, MonitoringSettings } = require('../models');
const dockerService = require('./docker.service');
const emailService = require('./email.service');
const logger = require('../config/logger');
const config = require('../config/config');

class MonitoringService {
  constructor() {
    this.containerStates = new Map(); // Track container states: Map<userId-serverId-containerId, { wasDown: boolean, lastAlert: Date, firstDownTime: Date }>
    this.noAutoRestartStates = new Map(); // Track containers without auto-restart: Map<userId-serverId-containerId, { lastAlert: Date }>
    this.isRunning = false;
    this.checkInterval = null;
    this.checkIntervalMs = config.monitoring.checkIntervalMs;
    this.alertCooldownMs = config.monitoring.alertCooldownMs;
    this.noAutoRestartCooldownMs = config.monitoring.noAutoRestartCooldownMs;
    this.alertOnContainerDown = config.monitoring.alertOnContainerDown;
    this.alertOnContainerRecovery = config.monitoring.alertOnContainerRecovery;
    this.alertOnNoAutoRestart = config.monitoring.alertOnNoAutoRestart;
    this.minDownTimeBeforeAlertMs = config.monitoring.minDownTimeBeforeAlertMs;
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
    logger.info(`Starting container monitoring service (check interval: ${this.checkIntervalMs}ms, alert cooldown: ${Math.round(this.alertCooldownMs / 3600000)}h)`);
    logger.info(`Alert settings: down=${this.alertOnContainerDown}, recovery=${this.alertOnContainerRecovery}, no-auto-restart=${this.alertOnNoAutoRestart}`);
    if (this.minDownTimeBeforeAlertMs > 0) {
      logger.info(`Minimum down time before alert: ${Math.round(this.minDownTimeBeforeAlertMs / 1000)}s`);
    }

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
      
      // Get user-specific monitoring settings (with fallback to config defaults)
      let userSettings = await MonitoringSettings.findOne({
        where: { userId: user.id },
      });
      
      // Use user settings if available, otherwise fall back to config defaults
      const alertOnContainerDown = userSettings?.alertOnContainerDown ?? this.alertOnContainerDown;
      const alertOnContainerRecovery = userSettings?.alertOnContainerRecovery ?? this.alertOnContainerRecovery;
      const alertOnNoAutoRestart = userSettings?.alertOnNoAutoRestart ?? this.alertOnNoAutoRestart;
      const alertCooldownMs = userSettings?.alertCooldownMs ?? this.alertCooldownMs;
      const noAutoRestartCooldownMs = userSettings?.noAutoRestartCooldownMs ?? this.noAutoRestartCooldownMs;
      const minDownTimeBeforeAlertMs = userSettings?.minDownTimeBeforeAlertMs ?? this.minDownTimeBeforeAlertMs;
      
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
              // First time we see this container - initialize state as down
              this.containerStates.set(stateKey, {
                wasDown: true,
                lastAlert: null,
                firstDownTime: now,
              });
              // Check if we should alert immediately or wait for threshold
              if (alertOnContainerDown && minDownTimeBeforeAlertMs === 0) {
                logger.warn(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} is down (should be running)`);
                await this.sendDownAlert(server, container, user.email, stateKey);
              } else if (alertOnContainerDown) {
                logger.info(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} is down, waiting ${minDownTimeBeforeAlertMs / 1000}s before alerting`);
              }
            } else if (!previousState.wasDown) {
              // Container was running before, now it's down - state changed
              const firstDownTime = now;
              this.containerStates.set(stateKey, {
                wasDown: true,
                lastAlert: previousState.lastAlert,
                firstDownTime,
              });
              // Check threshold before alerting
              if (alertOnContainerDown && minDownTimeBeforeAlertMs === 0) {
                logger.warn(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} just went down (should be running)`);
                await this.sendDownAlert(server, container, user.email, stateKey);
              } else if (alertOnContainerDown) {
                logger.info(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} just went down, waiting ${minDownTimeBeforeAlertMs / 1000}s before alerting`);
              }
            } else {
              // Container was already down
              const timeSinceFirstDown = now.getTime() - (previousState.firstDownTime || previousState.lastAlert || now).getTime();
              const timeSinceLastAlert = previousState.lastAlert ? (now.getTime() - previousState.lastAlert.getTime()) : Infinity;
              
              // Check if we've passed the threshold and haven't sent an alert yet, or if cooldown has passed
              if (alertOnContainerDown) {
                if (!previousState.lastAlert && timeSinceFirstDown >= minDownTimeBeforeAlertMs) {
                  // First alert after threshold
                  logger.warn(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} has been down for ${Math.round(timeSinceFirstDown / 1000)}s, sending alert`);
                  await this.sendDownAlert(server, container, user.email, stateKey);
                } else if (previousState.lastAlert && timeSinceLastAlert >= alertCooldownMs) {
                  // Resend alert after cooldown
                  logger.warn(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} still down, resending alert (cooldown: ${Math.round(alertCooldownMs / 3600000)}h)`);
                  await this.sendDownAlert(server, container, user.email, stateKey);
                }
              }
            }
          } else {
            // Container is running
            if (!previousState) {
              // First time we see this container - initialize state as running (no alert needed)
              this.containerStates.set(stateKey, {
                wasDown: false,
                lastAlert: null,
                firstDownTime: null,
              });
            } else if (previousState.wasDown) {
              // Container recovered - send recovery alert if enabled
              if (alertOnContainerRecovery) {
                logger.info(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} recovered`);
                await this.sendUpAlert(server, container, user.email, stateKey);
              }
            } else {
              // Container is still running - update state to ensure wasDown is false
              this.containerStates.set(stateKey, {
                wasDown: false,
                lastAlert: previousState.lastAlert,
                firstDownTime: null,
              });
            }
          }
        } else if (isRunning) {
          // Container is running but doesn't have auto-restart - alert about this (if enabled)
          if (alertOnNoAutoRestart) {
            const previousState = this.noAutoRestartStates.get(stateKey);
            
            logger.info(`Found running container without auto-restart: ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name}, restart policy: ${restartPolicy}`);
            
            if (!previousState) {
              // First time we see this container - send alert
              logger.warn(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} is running without auto-restart enabled - sending alert`);
              await this.sendNoAutoRestartAlert(server, container, user.email, stateKey);
            } else {
              // Check if we need to resend alert (cooldown)
              const timeSinceLastAlert = now.getTime() - previousState.lastAlert.getTime();
              if (timeSinceLastAlert >= noAutoRestartCooldownMs) {
                logger.warn(`Container ${containerId.substring(0, 12)} (${container.Names?.replace(/^\//, '') || 'unknown'}) on server ${server.name} still running without auto-restart, resending alert (cooldown: ${Math.round(noAutoRestartCooldownMs / 3600000)}h)`);
                await this.sendNoAutoRestartAlert(server, container, user.email, stateKey);
              } else {
                logger.debug(`Skipping alert for ${containerId.substring(0, 12)} - still in cooldown (${Math.round(timeSinceLastAlert / 3600000)}h / ${Math.round(noAutoRestartCooldownMs / 3600000)}h)`);
              }
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
        const currentState = this.containerStates.get(stateKey) || {};
        this.containerStates.set(stateKey, {
          wasDown: true,
          lastAlert: new Date(),
          firstDownTime: currentState.firstDownTime || new Date(),
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
