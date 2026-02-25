const sshService = require('./ssh.service');
const logger = require('../config/logger');

const VALID_IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Check if Tailscale is already running on the node and return its IPv4 if so.
 * @param {object} server - Server model instance
 * @returns {{ tailscaleIp: string } | null} - IP if running, null otherwise
 */
async function getExistingTailscaleIp(server) {
  try {
    const { stdout } = await sshService.executeCommand(server, 'tailscale ip -4', { timeout: 10000, allowFailure: true });
    const ip = (stdout || '').trim();
    if (VALID_IPV4.test(ip)) return { tailscaleIp: ip };
  } catch (_) {
    // tailscale not installed or not logged in
  }
  return null;
}

/**
 * Enable Tailscale for management: use existing Tailscale if already running, otherwise install and join with auth key.
 * Connects using the server's current host (not Tailscale). Auth key is not stored.
 * @param {object} server - Server model instance (with getDecryptedKey, host, port, username)
 * @param {string} [authKey] - Optional. Tailscale auth key; required only if Tailscale is not already running.
 * @param {{ onProgress?: (step: string, message: string, status: string) => void }} [options] - Optional. onProgress(step, message, status) for streaming progress.
 * @returns {{ tailscaleIp: string, imported?: boolean }}
 */
async function enableTailscale(server, authKey, options = {}) {
  const onProgress = options.onProgress;

  // 1. Check for already running Tailscale and use it as the management connection
  if (onProgress) onProgress('checking', 'Checking for existing Tailscale on node…', 'running');
  const existing = await getExistingTailscaleIp(server);
  if (existing) {
    if (onProgress) onProgress('found_existing', `Using existing Tailscale (${existing.tailscaleIp})`, 'ok');
    return { tailscaleIp: existing.tailscaleIp, imported: true };
  }

  // 2. No running Tailscale — require auth key to install and join
  const key = typeof authKey === 'string' ? authKey.trim() : '';
  if (!key) {
    if (onProgress) onProgress('checking', 'No Tailscale found; auth key required', 'fail');
    const err = new Error('Tailscale is not running on this node. Provide an auth key to install and join.');
    err.code = 'TAILSCALE_AUTH_KEY_REQUIRED';
    throw err;
  }

  // 3. Install Tailscale (idempotent; safe if already installed). Run without PTY so the script
  //    does not wait on TTY input (e.g. prompts); allow up to 10 min on slow or locked apt.
  if (onProgress) onProgress('installing', 'Installing Tailscale (this may take a few minutes)…', 'running');
  const installScript = 'curl -fsSL https://tailscale.com/install.sh | sh';
  try {
    await sshService.executeCommand(server, installScript, { timeout: 600000, pty: false });
    if (onProgress) onProgress('installing', 'Tailscale installed', 'ok');
  } catch (installErr) {
    // If install failed/timed out but tailscale is now available (e.g. install finished late), continue
    const check = await getExistingTailscaleIp(server);
    if (!check) {
      if (onProgress) onProgress('installing', 'Install failed or timed out', 'fail');
      throw installErr;
    }
    if (onProgress) onProgress('installing', 'Tailscale available', 'ok');
  }

  // 4. Allow the SSH user to run tailscale without sudo (avoid "checkprefs access denied").
  await sshService.executeCommand(server, 'sudo tailscale set --operator=$USER', { timeout: 15000, pty: false, allowFailure: true });

  // 5. Bring up Tailscale with auth key (avoid putting key in shell history via env). No PTY so no TTY prompts.
  if (onProgress) onProgress('joining', 'Joining Tailscale network…', 'running');
  const upCmd = `export AUTHKEY='${key.replace(/'/g, "'\\''")}' && tailscale up --auth-key="$AUTHKEY"`;
  await sshService.executeCommand(server, upCmd, { timeout: 90000, pty: false });
  if (onProgress) onProgress('joining', 'Joined network', 'ok');

  // 6. Get Tailscale IPv4
  if (onProgress) onProgress('getting_ip', 'Getting Tailscale IP…', 'running');
  const { stdout } = await sshService.executeCommand(server, 'tailscale ip -4', { timeout: 10000 });
  const tailscaleIp = (stdout || '').trim();
  if (!tailscaleIp || !VALID_IPV4.test(tailscaleIp)) {
    if (onProgress) onProgress('getting_ip', 'Could not get IP', 'fail');
    throw new Error('Could not get Tailscale IP from node. tailscale ip -4 returned: ' + (stdout || 'empty'));
  }
  if (onProgress) onProgress('getting_ip', `Tailscale IP: ${tailscaleIp}`, 'ok');

  return { tailscaleIp, imported: false };
}

/**
 * Disconnect the node from Tailscale. Does not uninstall Tailscale.
 * @param {object} server - Server model (will connect via current effective host)
 */
async function disableTailscale(server) {
  await sshService.executeCommand(server, 'tailscale logout', { timeout: 15000, allowFailure: true });
}

/**
 * Get Tailscale status on the node (e.g. "running", "stopped", IP).
 * @param {object} server - Server model
 * @returns {{ enabled: boolean, tailscaleIp?: string, status?: string, error?: string }}
 */
async function getTailscaleStatus(server) {
  try {
    const { stdout } = await sshService.executeCommand(server, 'tailscale ip -4', { timeout: 10000, allowFailure: true });
    const tailscaleIp = (stdout || '').trim();
    const validIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tailscaleIp);
    return {
      enabled: validIp,
      tailscaleIp: validIp ? tailscaleIp : undefined,
    };
  } catch (err) {
    logger.warn('Tailscale status check failed', { serverId: server.id, message: err.message });
    return { enabled: false, error: err.message };
  }
}

module.exports = {
  enableTailscale,
  disableTailscale,
  getTailscaleStatus,
};
