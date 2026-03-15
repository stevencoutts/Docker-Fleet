/**
 * Provision a dedicated 'dockerfleet' user on a server for SSH + Docker access.
 * Used on initial add (optional) and retrospectively for existing servers.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const sshService = require('./ssh.service');
const logger = require('../config/logger');

const DOCKERFLEET_USER = 'dockerfleet';

/**
 * Derive SSH public key from private key using ssh-keygen. Uses a temp file (mode 0600).
 * @param {string} privateKeyPem - PEM private key content
 * @returns {string} - Single line public key (e.g. "ssh-ed25519 AAAA... comment")
 */
function getPublicKeyFromPrivate(privateKeyPem) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `dockerfleet-key-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(tmpFile, privateKeyPem.trim(), { mode: 0o600 });
    const pub = execSync(`ssh-keygen -y -f "${tmpFile}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return (pub || '').trim();
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch (_) {}
  }
}

/**
 * Escape a string for safe use inside a single-quoted shell literal.
 * Single quotes are escaped as '"'"' (end quote, escaped quote, start quote).
 */
function shellEscapeSingle(s) {
  if (typeof s !== 'string') return '';
  return `'${s.replace(/'/g, "'\"'\"'")}'`;
}

/**
 * Provision the dockerfleet user on the server. Requires current SSH user to have sudo.
 * - Creates user dockerfleet if missing (with home dir, bash)
 * - Adds dockerfleet to docker group (if group exists)
 * - Sets up ~dockerfleet/.ssh/authorized_keys with the public key from server's private key
 * @param {object} server - Server model (host, port, username, getDecryptedKey())
 * @returns {{ success: true } | { success: false, error: string }}
 */
async function provisionDockerfleetUser(server) {
  let publicKey;
  try {
    publicKey = getPublicKeyFromPrivate(server.getDecryptedKey());
  } catch (e) {
    logger.warn('Dockerfleet provision: failed to derive public key', { message: e.message });
    return { success: false, error: 'Could not derive public key from private key. Ensure the key is a valid OpenSSH format.' };
  }
  if (!publicKey || !publicKey.startsWith('ssh-')) {
    return { success: false, error: 'Invalid or unsupported key format.' };
  }

  const authLine = publicKey.replace(/'/g, "'\"'\"'");
  const homeDir = `/home/${DOCKERFLEET_USER}`;
  const sshDir = `${homeDir}/.ssh`;
  const authKeysPath = `${sshDir}/authorized_keys`;

  // Run provisioning script: create user, add to docker group, set up SSH key.
  // Use sudo for all privileged operations. Idempotent where possible.
  const script = [
    `id ${DOCKERFLEET_USER} >/dev/null 2>&1 || sudo useradd -m -s /bin/bash ${DOCKERFLEET_USER}`,
    `getent group docker >/dev/null 2>&1 && sudo usermod -aG docker ${DOCKERFLEET_USER} || true`,
    `sudo mkdir -p ${sshDir}`,
    `echo ${shellEscapeSingle(publicKey)} | sudo tee ${authKeysPath} >/dev/null`,
    `sudo chown -R ${DOCKERFLEET_USER}:${DOCKERFLEET_USER} ${sshDir}`,
    `sudo chmod 700 ${sshDir}`,
    `sudo chmod 600 ${authKeysPath}`,
  ].join(' && ');

  try {
    await sshService.executeCommand(server, script, { timeout: 30000, pty: false });
    return { success: true };
  } catch (err) {
    const msg = err.message || String(err);
    logger.warn('Dockerfleet provision failed', { serverId: server.id, message: msg });
    return { success: false, error: msg };
  }
}

/**
 * Check if the server is already using the dockerfleet user.
 */
function isDockerfleetUser(server) {
  const u = server.username || (typeof server.get === 'function' ? server.get('username') : null);
  return String(u).trim().toLowerCase() === DOCKERFLEET_USER;
}

module.exports = {
  DOCKERFLEET_USER,
  getPublicKeyFromPrivate,
  provisionDockerfleetUser,
  isDockerfleetUser,
};
