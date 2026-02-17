const nodemailer = require('nodemailer');
const config = require('../config/config');
const logger = require('../config/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
  }

  async initialize() {
    if (!config.email.enabled) {
      logger.info('Email service is disabled (EMAIL_ENABLED=false). Set EMAIL_ENABLED=true to enable email alerts.');
      this.initialized = false;
      return;
    }

    // Check if SMTP settings are configured
    // For port 25 (unauthenticated SMTP), user/password may be empty
    const needsAuth = config.email.smtp.port !== 25;
    if (!config.email.smtp.host) {
      logger.warn('Email service is enabled but SMTP_HOST is not configured.');
      this.initialized = false;
      return;
    }
    if (needsAuth && (!config.email.smtp.user || !config.email.smtp.password)) {
      logger.warn('Email service is enabled but SMTP settings are incomplete. Please configure SMTP_USER and SMTP_PASSWORD (or use port 25 for unauthenticated SMTP).');
      this.initialized = false;
      return;
    }

    try {
      const transportConfig = {
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        secure: config.email.smtp.secure, // true for 465, false for other ports
        tls: {
          rejectUnauthorized: config.email.smtp.rejectUnauthorized !== false,
        },
      };

      // Only add auth if user and password are provided (not needed for port 25)
      if (config.email.smtp.user && config.email.smtp.password) {
        transportConfig.auth = {
          user: config.email.smtp.user,
          pass: config.email.smtp.password,
        };
      }

      this.transporter = nodemailer.createTransport(transportConfig);

      // Verify the connection
      try {
        await this.transporter.verify();
        this.initialized = true;
        logger.info(`Email service initialized and verified (SMTP: ${config.email.smtp.host}:${config.email.smtp.port})`);
      } catch (verifyError) {
        logger.error('Email service SMTP verification failed:', verifyError.message);
        logger.error('Please check your SMTP settings (host, port, user, password)');
        this.initialized = false;
      }
    } catch (error) {
      logger.error('Failed to initialize email service:', error);
      this.initialized = false;
    }
  }

  async sendAlert(recipient, subject, html, text) {
    if (!this.initialized || !config.email.enabled) {
      logger.debug('Email service not available, skipping email alert');
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"${config.email.fromName}" <${config.email.fromAddress}>`,
        to: recipient,
        subject: subject,
        text: text,
        html: html,
      });

      logger.info(`Email alert sent to ${recipient}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Failed to send email alert:', error);
      return { success: false, error: error.message };
    }
  }

  async sendContainerDownAlert(recipient, server, container) {
    const containerName = container.Names?.replace(/^\//, '') || container.ID?.substring(0, 12) || 'Unknown';
    const serverName = server.name || server.host || 'Unknown Server';
    
    const subject = `🚨 Container Alert: ${containerName} is down on ${serverName}`;
    
    const text = `
Container Alert

Container: ${containerName}
Server: ${serverName} (${server.host})
Container ID: ${container.ID?.substring(0, 12) || 'Unknown'}
Image: ${container.Image || 'Unknown'}
Status: ${container.Status || 'Stopped'}
Restart Policy: ${container.RestartPolicy || 'no'}

This container has auto-restart enabled but is currently stopped.
Please check the container status and restart if necessary.

Time: ${new Date().toLocaleString()}
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .alert { background-color: #fee; border-left: 4px solid #f00; padding: 15px; margin: 20px 0; }
    .info { background-color: #f0f0f0; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .label { font-weight: bold; color: #666; }
    .value { color: #000; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2 style="color: #d00;">🚨 Container Alert</h2>
    
    <div class="alert">
      <strong>Container is Down</strong><br>
      The container <strong>${containerName}</strong> on server <strong>${serverName}</strong> has auto-restart enabled but is currently stopped.
    </div>
    
    <div class="info">
      <div style="margin-bottom: 10px;">
        <span class="label">Container:</span> <span class="value">${containerName}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Server:</span> <span class="value">${serverName} (${server.host})</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Container ID:</span> <span class="value">${container.ID?.substring(0, 12) || 'Unknown'}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Image:</span> <span class="value">${container.Image || 'Unknown'}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Status:</span> <span class="value">${container.Status || 'Stopped'}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Restart Policy:</span> <span class="value">${container.RestartPolicy || 'no'}</span>
      </div>
    </div>
    
    <p>Please check the container status and restart if necessary.</p>
    
    <div class="footer">
      <p>Time: ${new Date().toLocaleString()}</p>
      <p>DockerFleet Manager - Automated Alert System</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    return await this.sendAlert(recipient, subject, html, text);
  }

  async sendContainerUpAlert(recipient, server, container) {
    const containerName = container.Names?.replace(/^\//, '') || container.ID?.substring(0, 12) || 'Unknown';
    const serverName = server.name || server.host || 'Unknown Server';
    
    const subject = `✅ Container Recovered: ${containerName} is running on ${serverName}`;
    
    const text = `
Container Recovery Alert

Container: ${containerName}
Server: ${serverName} (${server.host})
Container ID: ${container.ID?.substring(0, 12) || 'Unknown'}

This container has recovered and is now running.

Time: ${new Date().toLocaleString()}
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .success { background-color: #efe; border-left: 4px solid #0a0; padding: 15px; margin: 20px 0; }
    .info { background-color: #f0f0f0; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .label { font-weight: bold; color: #666; }
    .value { color: #000; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2 style="color: #0a0;">✅ Container Recovery</h2>
    
    <div class="success">
      <strong>Container is Running</strong><br>
      The container <strong>${containerName}</strong> on server <strong>${serverName}</strong> has recovered and is now running.
    </div>
    
    <div class="info">
      <div style="margin-bottom: 10px;">
        <span class="label">Container:</span> <span class="value">${containerName}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Server:</span> <span class="value">${serverName} (${server.host})</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Container ID:</span> <span class="value">${container.ID?.substring(0, 12) || 'Unknown'}</span>
      </div>
    </div>
    
    <div class="footer">
      <p>Time: ${new Date().toLocaleString()}</p>
      <p>DockerFleet Manager - Automated Alert System</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    return await this.sendAlert(recipient, subject, html, text);
  }

  async sendNoAutoRestartAlert(recipient, server, container) {
    const containerName = container.Names?.replace(/^\//, '') || container.ID?.substring(0, 12) || 'Unknown';
    const serverName = server.name || server.host || 'Unknown Server';
    
    const subject = `⚠️ Container Alert: ${containerName} running without auto-restart on ${serverName}`;
    
    const text = `
Container Alert

Container: ${containerName}
Server: ${serverName} (${server.host})
Container ID: ${container.ID?.substring(0, 12) || 'Unknown'}
Image: ${container.Image || 'Unknown'}
Status: ${container.Status || 'Running'}
Restart Policy: ${container.RestartPolicy || 'no'}

This container is currently running but does NOT have auto-restart enabled.
It will NOT automatically restart after a server reboot or crash.
Consider enabling auto-restart to ensure the container stays running.

Time: ${new Date().toLocaleString()}
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .alert { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
    .info { background-color: #f0f0f0; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .label { font-weight: bold; color: #666; }
    .value { color: #000; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h2 style="color: #856404;">⚠️ Container Alert</h2>
    
    <div class="alert">
      <strong>No Auto-Restart Enabled</strong><br>
      The container <strong>${containerName}</strong> on server <strong>${serverName}</strong> is running but does NOT have auto-restart enabled.
      It will NOT automatically restart after a server reboot or crash.
    </div>
    
    <div class="info">
      <div style="margin-bottom: 10px;">
        <span class="label">Container:</span> <span class="value">${containerName}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Server:</span> <span class="value">${serverName} (${server.host})</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Container ID:</span> <span class="value">${container.ID?.substring(0, 12) || 'Unknown'}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Image:</span> <span class="value">${container.Image || 'Unknown'}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Status:</span> <span class="value">${container.Status || 'Running'}</span>
      </div>
      <div style="margin-bottom: 10px;">
        <span class="label">Restart Policy:</span> <span class="value">${container.RestartPolicy || 'no'}</span>
      </div>
    </div>
    
    <p><strong>Recommendation:</strong> Consider enabling auto-restart to ensure the container stays running after server reboots or crashes.</p>
    
    <div class="footer">
      <p>Time: ${new Date().toLocaleString()}</p>
      <p>DockerFleet Manager - Automated Alert System</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    return await this.sendAlert(recipient, subject, html, text);
  }
}

const emailService = new EmailService();

// Initialize will be called when monitoring service starts
module.exports = emailService;
