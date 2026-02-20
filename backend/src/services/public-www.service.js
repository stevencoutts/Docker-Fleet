/**
 * Public WWW: on a host with a public IP, enable firewall (80/443 only), nginx reverse proxy, and Let's Encrypt.
 * Nginx proxies domains to containers by port.
 */
const { Server, ServerProxyRoute } = require('../models');
const sshService = require('./ssh.service');
const logger = require('../config/logger');

const NGINX_CONF_PATH = '/etc/nginx/conf.d/dockerfleet-proxy.conf';
const CERTBOT_DNS_HOOK_PATH = '/tmp/certbot-dns-hook.sh';
const CERTBOT_DNS_CONTINUE_FILE = '/tmp/certbot-dns-continue';
const LETSENCRYPT_EMAIL = process.env.LETSENCRYPT_EMAIL || process.env.DOCKERFLEET_LETSENCRYPT_EMAIL || 'admin@example.com';
/** Optional: increase timeouts for slow hosts (e.g. PUBLIC_WWW_APT_TIMEOUT_MS=600000 for 10 min). */
const PUBLIC_WWW_APT_TIMEOUT_MS = parseInt(process.env.PUBLIC_WWW_APT_TIMEOUT_MS, 10) || 300000;

/** Inline script: writes TXT record name/value to /tmp for backend to read, then blocks until continue file exists. */
const CERTBOT_DNS_HOOK_SCRIPT = `#!/bin/sh
BASE=$(echo "$CERTBOT_DOMAIN" | sed 's/^\\*\\.//')
RECORD_NAME="_acme-challenge.$BASE"
echo "$RECORD_NAME" > /tmp/certbot-dns-name.txt
echo "$CERTBOT_VALIDATION" > /tmp/certbot-dns-value.txt
echo "$CERTBOT_DOMAIN" > /tmp/certbot-dns-domain.txt
while [ ! -f ${CERTBOT_DNS_CONTINUE_FILE} ]; do sleep 2; done
rm -f ${CERTBOT_DNS_CONTINUE_FILE}
exit 0
`;

/** Domains that have a cert in /etc/letsencrypt/live/<domain>/ (base name only, e.g. example.com). */
function buildNginxConfig(routes, certDomains = new Set()) {
  const blocks = (routes || []).map((r) => {
    const domain = r.domain.trim();
    const port = parseInt(r.containerPort, 10) || 80;
    const baseDomain = domain.replace(/^\*\./, '');
    const hasCert = certDomains.has(baseDomain);

    let block = `
server {
    listen 80;
    server_name ${domain};
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
    }
}`;
    if (hasCert) {
      block += `
server {
    listen 443 ssl;
    server_name ${domain};
    ssl_certificate /etc/letsencrypt/live/${baseDomain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${baseDomain}/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
    }
}`;
    }
    return block;
  });
  return blocks.join('\n') || '# No proxy routes\n';
}

/**
 * Run a command on the server (with optional allowFailure).
 * Logs step and timeout for debugging (tail backend logs to see which command runs and what output was received on timeout).
 */
async function exec(server, command, options = {}) {
  const timeout = options.timeout ?? 120000;
  const label = options.logLabel || null;
  if (label) logger.info('Public WWW: running command', { label, timeoutMs: timeout, commandPreview: String(command).substring(0, 120) });
  try {
    const result = await sshService.executeCommand(server, command, { timeout: 120000, ...options });
    return result;
  } catch (e) {
    if (e.code === 'TIMEOUT' && label) logger.warn('Public WWW: command timed out', { label, timeoutMs: timeout });
    throw e;
  }
}

/**
 * Ensure the host's hostname resolves (e.g. 127.0.0.1 finland in /etc/hosts).
 * Without this, sudo can hang with "unable to resolve host X: Temporary failure in name resolution".
 * Uses "sudo -h localhost" so sudo does not trigger the blocking hostname lookup.
 */
async function ensureHostnameResolves(server, onProgress) {
  if (onProgress) onProgress('hostname', 'Ensuring hostname resolves...', 'running');
  const addHostsCmd =
    'sudo -h localhost sh -c \'H=$(hostname -s 2>/dev/null || hostname); [ -z "$H" ] && exit 0; grep -qF "127.0.0.1 $H" /etc/hosts || echo "127.0.0.1 $H" >> /etc/hosts\'';
  try {
    await exec(server, addHostsCmd, { allowFailure: true, timeout: 15000, logLabel: 'hostname_hosts' });
  } catch (e) {
    logger.warn('Public WWW: could not ensure hostname in /etc/hosts:', e.message);
  }
  if (onProgress) onProgress('hostname', 'Hostname OK', 'ok');
}

/**
 * Configure firewall: allow SSH (server.port), 80, 443; default deny incoming.
 * If ufw is not installed, try to install it first (Debian/Ubuntu).
 */
async function configureFirewall(server, onProgress) {
  const sshPort = server.port || 22;
  if (onProgress) onProgress('firewall', 'Configuring firewall (allow SSH, 80, 443)...', 'running');
  const ufwCheck = await exec(server, 'sudo ufw status 2>&1', { allowFailure: true });
  const ufwMissing = ufwCheck.code !== 0 || (ufwCheck.stderr + ufwCheck.stdout).includes('not found');
  if (ufwMissing) {
    if (onProgress) onProgress('firewall', 'UFW not installed, installing...', 'running');
    const installCmd = 'sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq && sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" ufw';
    const installResult = await exec(server, installCmd, { allowFailure: true, timeout: PUBLIC_WWW_APT_TIMEOUT_MS, logLabel: 'firewall_ufw_install' });
    if (installResult.code !== 0) {
      logger.warn('Public WWW: UFW install failed', {
        host: server.host,
        code: installResult.code,
        stdout: (installResult.stdout || '').slice(-1500),
        stderr: (installResult.stderr || '').slice(-1500),
      });
      if (onProgress) onProgress('firewall', 'Could not install UFW, skipped', 'fail');
      return;
    }
  }
  const commands = [
    `sudo ufw allow ${sshPort}/tcp comment 'SSH'`,
    'sudo ufw allow 80/tcp comment "HTTP"',
    'sudo ufw allow 443/tcp comment "HTTPS"',
    'sudo ufw default deny incoming',
    'sudo ufw default allow outgoing',
    "printf 'y\\n' | sudo ufw enable",
  ];
  for (const cmd of commands) {
    try {
      await exec(server, cmd, { allowFailure: true, timeout: 60000, logLabel: 'firewall_ufw_rule' });
    } catch (e) {
      logger.warn('Public WWW: firewall command failed:', e.message);
    }
  }
  if (onProgress) onProgress('firewall', 'Firewall configured', 'ok');
}

/**
 * Ensure nginx and certbot are installed (Debian/Ubuntu). Can take several minutes on first run.
 */
async function ensureNginxAndCertbot(server, onProgress) {
  if (onProgress) onProgress('install_nginx', 'Installing nginx and certbot (may take 2–5 min)...', 'running');
  const install = 'sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot python3-certbot-nginx 2>/dev/null || true';
  const installResult = await exec(server, install, { allowFailure: true, timeout: PUBLIC_WWW_APT_TIMEOUT_MS, logLabel: 'install_nginx_certbot' });
  if (installResult.code !== 0) {
    logger.warn('Public WWW: nginx/certbot install failed', {
      host: server.host,
      code: installResult.code,
      stdout: (installResult.stdout || '').slice(-1500),
      stderr: (installResult.stderr || '').slice(-1500),
    });
  }
  if (onProgress) onProgress('install_nginx', 'Nginx and certbot installed', 'ok');
}

/**
 * List domain names that have a cert in /etc/letsencrypt/live/ (excludes README).
 */
async function getCertDomains(server) {
  const r = await exec(server, 'ls -1 /etc/letsencrypt/live/ 2>/dev/null || true', { allowFailure: true });
  const out = (r.stdout || '').trim();
  const names = out ? out.split(/\n/).filter((n) => n && n !== 'README') : [];
  return new Set(names);
}

/**
 * Write nginx config and reload nginx. If certDomains not provided, fetches from server.
 */
async function writeNginxConfigAndReload(server, routes, onProgress, certDomains) {
  if (onProgress) onProgress('nginx_config', 'Writing nginx config and reloading...', 'running');
  const domains = certDomains ?? await getCertDomains(server);
  const config = buildNginxConfig(routes, domains);
  const escaped = config.replace(/'/g, "'\\''");
  await exec(server, `echo '${escaped}' | sudo tee ${NGINX_CONF_PATH} > /dev/null`, { allowFailure: false });
  await exec(server, 'sudo nginx -t && sudo systemctl reload nginx', { allowFailure: true });
  if (onProgress) onProgress('nginx_config', 'Nginx config applied', 'ok');
}

/**
 * Run certbot for each domain (non-interactive). Skips if no routes.
 */
async function runCertbot(server, routes, email = LETSENCRYPT_EMAIL, onProgress) {
  const domains = (routes || []).map((r) => r.domain.trim()).filter(Boolean);
  for (const domain of domains) {
    if (onProgress) onProgress('certbot', `Requesting certificate for ${domain}...`, 'running');
    try {
      await exec(
        server,
        `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email ${email} --redirect 2>/dev/null || true`,
        { timeout: 180000, allowFailure: true }
      );
      if (onProgress) onProgress('certbot', `Certificate for ${domain}`, 'ok');
    } catch (e) {
      logger.warn(`Public WWW: certbot failed for ${domain}:`, e.message);
      if (onProgress) onProgress('certbot', `${domain}: ${e.message}`, 'fail');
    }
  }
}

/**
 * Enable public WWW: firewall (80/443 + SSH), nginx, and sync proxy routes + certbot.
 * Optional onProgress(step, message, status) for streaming progress (step, message, status: 'running'|'ok'|'fail').
 */
async function enablePublicWww(serverId, userId, options = {}) {
  const onProgress = options.onProgress;
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');
  const routes = await ServerProxyRoute.findAll({ where: { serverId } });

  try {
    await ensureHostnameResolves(server, onProgress);
    await configureFirewall(server, onProgress);
    await ensureNginxAndCertbot(server, onProgress);
    await writeNginxConfigAndReload(server, routes, onProgress);
    if (routes.length > 0) await runCertbot(server, routes, LETSENCRYPT_EMAIL, onProgress);

    await server.update({ publicWwwEnabled: true });
    if (onProgress) onProgress('done', 'Public WWW enabled', 'ok');
    return { success: true, message: 'Public WWW enabled (firewall, nginx, proxy routes applied).' };
  } catch (err) {
    if (onProgress) onProgress('done', err.message || 'Enable failed', 'fail');
    throw err;
  }
}

/**
 * Disable public WWW: remove our nginx config and set flag. Firewall is left as-is to avoid locking out the user.
 */
async function disablePublicWww(serverId, userId) {
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');

  try {
    await exec(server, `sudo rm -f ${NGINX_CONF_PATH} && sudo nginx -t && sudo systemctl reload nginx`, { allowFailure: true });
  } catch (e) {
    logger.warn('Public WWW: disable nginx config failed:', e.message);
  }
  await server.update({ publicWwwEnabled: false });
  return { success: true, message: 'Public WWW disabled. Firewall unchanged (ports 80/443 may still be open).' };
}

/**
 * Sync proxy: rewrite nginx config from current routes (including SSL for domains with certs), reload nginx, run certbot for new domains (HTTP only).
 */
async function syncProxy(serverId, userId) {
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');
  const routes = await ServerProxyRoute.findAll({ where: { serverId } });

  await ensureNginxAndCertbot(server);
  await writeNginxConfigAndReload(server, routes);
  if (routes.length > 0) await runCertbot(server, routes);

  return { success: true, message: 'Proxy config synced.' };
}

/**
 * Deploy certbot DNS hook script to server (writes TXT name/value, then blocks until continue file exists).
 */
async function deployDnsHook(server) {
  const b64 = Buffer.from(CERTBOT_DNS_HOOK_SCRIPT, 'utf8').toString('base64');
  await exec(server, `echo '${b64}' | base64 -d | sudo tee ${CERTBOT_DNS_HOOK_PATH} > /dev/null && sudo chmod +x ${CERTBOT_DNS_HOOK_PATH}`);
  await exec(server, `sudo rm -f /tmp/certbot-dns-name.txt /tmp/certbot-dns-value.txt /tmp/certbot-dns-domain.txt ${CERTBOT_DNS_CONTINUE_FILE}`);
}

/**
 * Request a certificate via DNS-01: deploy hook, run certbot in background, poll for challenge and return TXT record instructions.
 * Options: { domain, wildcard }. domain is e.g. example.com; if wildcard, requests -d example.com -d '*.example.com'.
 */
async function requestDnsCert(serverId, userId, options = {}) {
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');

  const domain = (options.domain || '').trim().toLowerCase();
  if (!domain) throw new Error('domain is required');
  const wildcard = Boolean(options.wildcard);
  const baseDomain = domain.replace(/^\*\./, '');

  await ensureNginxAndCertbot(server);
  await deployDnsHook(server);

  const certbotDomains = wildcard ? `-d ${baseDomain} -d '*.${baseDomain}'` : `-d ${domain}`;
  const certbotCmd = `sudo certbot certonly --manual --preferred-challenges dns ${certbotDomains} --manual-auth-hook ${CERTBOT_DNS_HOOK_PATH} --agree-tos --email ${LETSENCRYPT_EMAIL} --non-interactive 2>&1`;
  await exec(server, `nohup sh -c '${certbotCmd}' > /tmp/certbot-dns.log 2>&1 &`, { allowFailure: true });

  const deadline = Date.now() + 60000;
  let recordName = '';
  let recordValue = '';
  let challengeDomain = domain;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const nameResult = await exec(server, 'cat /tmp/certbot-dns-name.txt 2>/dev/null', { allowFailure: true });
    const valueResult = await exec(server, 'cat /tmp/certbot-dns-value.txt 2>/dev/null', { allowFailure: true });
    const domainResult = await exec(server, 'cat /tmp/certbot-dns-domain.txt 2>/dev/null', { allowFailure: true });
    recordName = (nameResult.stdout || '').trim();
    recordValue = (valueResult.stdout || '').trim();
    challengeDomain = (domainResult.stdout || '').trim() || domain;
    if (recordName && recordValue) {
      return { recordName, recordValue, domain: challengeDomain, baseDomain };
    }
  }
  const logResult = await exec(server, 'tail -50 /tmp/certbot-dns.log 2>/dev/null', { allowFailure: true });
  throw new Error('Certbot did not produce challenge in time. ' + (logResult.stdout || 'Check server /tmp/certbot-dns.log'));
}

/**
 * After user has added the DNS TXT record: touch continue file, wait for cert, then update nginx and reload.
 */
async function continueDnsCert(serverId, userId, options = {}) {
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');

  const domain = (options.domain || '').trim().toLowerCase();
  if (!domain) throw new Error('domain is required');
  const baseDomain = domain.replace(/^\*\./, '');

  await exec(server, `sudo touch ${CERTBOT_DNS_CONTINUE_FILE}`);

  const certPath = `/etc/letsencrypt/live/${baseDomain}/fullchain.pem`;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await exec(server, `test -f ${certPath} && echo ok`, { allowFailure: true });
    if ((r.stdout || '').trim() === 'ok') {
      const routes = await ServerProxyRoute.findAll({ where: { serverId } });
      const certDomains = await getCertDomains(server);
      await writeNginxConfigAndReload(server, routes, null, certDomains);
      return { success: true, message: `Certificate for ${baseDomain} installed and nginx reloaded.` };
    }
  }
  const logResult = await exec(server, 'tail -80 /tmp/certbot-dns.log 2>/dev/null', { allowFailure: true });
  throw new Error('Certificate did not appear in time. ' + (logResult.stdout || 'Check server /tmp/certbot-dns.log'));
}

module.exports = {
  enablePublicWww,
  disablePublicWww,
  syncProxy,
  requestDnsCert,
  continueDnsCert,
  buildNginxConfig,
  getCertDomains,
};
