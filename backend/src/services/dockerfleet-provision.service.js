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
 * @returns {{ publicKey: string } | { error: string }}
 */
function getPublicKeyFromPrivate(privateKeyPem) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `dockerfleet-key-${process.pid}-${Date.now()}`);
  try {
    // Normalize: trim and fix line endings (CRLF/CR can cause "error in libcrypto" with ssh-keygen)
    const normalized = (privateKeyPem || '')
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    if (!normalized || !normalized.includes('-----BEGIN')) {
      return { error: 'Private key is empty or invalid (missing PEM header).' };
    }
    // Ensure file ends with single newline (some ssh-keygen/libcrypto expect it)
    const toWrite = normalized.endsWith('\n') ? normalized : normalized + '\n';
    fs.writeFileSync(tmpFile, toWrite, { mode: 0o600 });
    const pub = execSync(`ssh-keygen -y -f "${tmpFile}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 1024 * 10,
    });
    const out = (pub || '').trim();
    if (out && (out.startsWith('ssh-ed25519 ') || out.startsWith('ssh-rsa ') || out.startsWith('ecdsa-sha2-'))) {
      return { publicKey: out };
    }
    return { error: 'Could not derive public key (unexpected ssh-keygen output).' };
  } catch (e) {
    const stderr = (e.stderr && (typeof e.stderr === 'string' ? e.stderr : String(e.stderr))) || '';
    const msg = (e.message || '').toLowerCase();
    if (/passphrase|decrypt|bad passphrase/i.test(stderr) || /passphrase|decrypt/i.test(msg)) {
      return { error: 'This key is passphrase-protected. Use a private key without a passphrase for dockerfleet provisioning (e.g. generate one with ssh-keygen -t ed25519 -N "" -f key).' };
    }
    if (/no such file|not found|command not found/i.test(stderr + msg)) {
      return { error: 'ssh-keygen not found. Install OpenSSH (e.g. openssh-client) on the server where Docker Fleet runs.' };
    }
    if (/error in libcrypto|libcrypto/i.test(stderr + msg)) {
      return {
        error: 'Could not read the private key (libcrypto error). Try re-pasting the key, ensure no extra spaces or line breaks in the middle of lines, or use a key generated with: ssh-keygen -t ed25519 -N "" -f key',
      };
    }
    const detail = stderr.trim() || e.message || 'Unknown error';
    return { error: `Could not derive public key: ${detail}` };
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
  const keyResult = getPublicKeyFromPrivate(server.getDecryptedKey());
  if (keyResult.error) {
    logger.warn('Dockerfleet provision: failed to derive public key', { message: keyResult.error });
    return { success: false, error: keyResult.error };
  }
  const publicKey = keyResult.publicKey;
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
