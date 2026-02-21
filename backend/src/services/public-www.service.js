/**
 * Public WWW: on a host with a public IP, enable firewall (80/443 only), nginx reverse proxy, and Let's Encrypt.
 * Nginx proxies domains to containers by port.
 */
const { Server, ServerProxyRoute, User } = require('../models');
const sshService = require('./ssh.service');
const logger = require('../config/logger');

const NGINX_CONF_PATH = '/etc/nginx/conf.d/dockerfleet-proxy.conf';
const NGINX_DEFAULT_PAGE_DIR = '/etc/nginx/dockerfleet-default';
const NGINX_DEFAULT_PAGE_PATH = '/etc/nginx/dockerfleet-default/index.html';
const CERTBOT_DNS_HOOK_PATH = '/tmp/certbot-dns-hook.sh';
const CERTBOT_DNS_RUNNER_PATH = '/tmp/certbot-dns-runner.sh';
const CERTBOT_DNS_CONTINUE_FILE = '/tmp/certbot-dns-continue';
const CERTBOT_DNS_LOG_PATH = '/tmp/certbot-dns.log';
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

/** HTML for the default page shown when visiting the host by IP (replaces nginx default "Welcome to nginx!"). */
const DEFAULT_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Docker Fleet</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { text-align: center; padding: 2rem; max-width: 28rem; }
    h1 { font-size: 1.75rem; font-weight: 700; margin: 0 0 0.5rem; letter-spacing: -0.02em; }
    p { margin: 0; color: #94a3b8; font-size: 0.9375rem; line-height: 1.5; }
    .badge { display: inline-block; margin-top: 1.5rem; padding: 0.25rem 0.75rem; background: #1e293b; border-radius: 9999px; font-size: 0.75rem; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Docker Fleet</h1>
    <p>This host is managed by Docker Fleet Manager. Add proxy routes to serve your domains here.</p>
    <span class="badge">Managed by Docker Fleet</span>
  </div>
</body>
</html>
`;

/** Nginx default_server block (port 80) that serves the Docker Fleet branded page when no server_name matches. */
function buildDefaultServerBlock() {
  return `
server {
    listen 80 default_server;
    server_name _;
    root ${NGINX_DEFAULT_PAGE_DIR};
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;
}

/** Generate the default server block(s) for one route (HTTP + optional HTTPS). */
function buildDefaultRouteBlock(r, certDomains = new Set()) {
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
}

/** Domains that have a cert in /etc/letsencrypt/live/<domain>/ (base name only, e.g. example.com). */
function buildNginxConfig(routes, certDomains = new Set()) {
  const defaultBlock = buildDefaultServerBlock();
  const blocks = (routes || []).map((r) => {
    const custom = (r.customNginxBlock || '').trim();
    if (custom) return custom;
    return buildDefaultRouteBlock(r, certDomains);
  });
  return defaultBlock + (blocks.join('\n') || '# No proxy routes\n');
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
 * Configure firewall: only SSH (server.port), 80, 443 open; default deny incoming so Docker and other ports are blocked from the public internet.
 * Removes any existing allow rules for other ports (e.g. Docker-mapped ports) before applying.
 */
async function configureFirewall(server, onProgress) {
  const sshPort = server.port || 22;
  const allowedPorts = new Set([sshPort, 80, 443]);
  if (onProgress) onProgress('firewall', 'Configuring firewall (only SSH, 80, 443; other ports blocked)...', 'running');
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
  // Set defaults first so we don't leave a window with everything open
  await exec(server, 'sudo ufw default deny incoming', { allowFailure: true, timeout: 60000, logLabel: 'firewall_default_deny' });
  await exec(server, 'sudo ufw default allow outgoing', { allowFailure: true, timeout: 60000, logLabel: 'firewall_default_out' });
  // Remove any allow rules for ports other than SSH, 80, 443 (e.g. Docker 8083, 8084)
  const numbered = await exec(server, 'sudo ufw status numbered 2>/dev/null || true', { allowFailure: true, timeout: 10000 });
  const out = (numbered.stdout || '').trim();
  const toDelete = [];
  for (const line of out.split(/\n/)) {
    const m = line.match(/\[\s*(\d+)\]\s+(\d+)\/tcp/);
    if (m) {
      const ruleNum = parseInt(m[1], 10);
      const port = parseInt(m[2], 10);
      if (!allowedPorts.has(port)) toDelete.push(ruleNum);
    }
  }
  toDelete.sort((a, b) => b - a); // delete from highest index first
  for (const num of toDelete) {
    try {
      await exec(server, `printf 'y\\n' | sudo ufw delete ${num}`, { allowFailure: true, timeout: 10000, logLabel: 'firewall_delete_rule' });
    } catch (e) {
      logger.warn('Public WWW: ufw delete rule failed:', e.message);
    }
  }
  // Explicit deny for common container/app ports so they're blocked even when Docker adds iptables rules (Docker can otherwise open ports before UFW is evaluated)
  const denyPorts = [];
  for (let p = 8080; p <= 8095; p++) denyPorts.push(p);
  [3000, 5000].forEach((p) => denyPorts.push(p));
  for (const port of denyPorts) {
    try {
      await exec(server, `sudo ufw deny ${port}/tcp`, { allowFailure: true, timeout: 10000, logLabel: 'firewall_deny_port' });
    } catch (e) {
      logger.warn('Public WWW: ufw deny port failed:', e.message);
    }
  }
  // SSH: allow all or restrict to IPs
  const sshIpsRaw = (server.sshAllowedIps || '').trim();
  const sshIps = sshIpsRaw ? sshIpsRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
  if (sshIps.length > 0) {
    await exec(server, `printf 'y\\n' | sudo ufw delete allow ${sshPort}/tcp 2>/dev/null || true`, { allowFailure: true, timeout: 10000, logLabel: 'firewall_delete_ssh' });
    for (const ip of sshIps) {
      try {
        await exec(server, `sudo ufw allow from ${ip} to any port ${sshPort} proto tcp comment 'SSH'`, { allowFailure: true, timeout: 10000, logLabel: 'firewall_ufw_ssh_ip' });
      } catch (e) {
        logger.warn('Public WWW: ufw allow from IP failed:', { ip, message: e.message });
      }
    }
  } else {
    try {
      await exec(server, `sudo ufw allow ${sshPort}/tcp comment 'SSH'`, { allowFailure: true, timeout: 60000, logLabel: 'firewall_ufw_rule' });
    } catch (e) {
      logger.warn('Public WWW: firewall command failed:', e.message);
    }
  }
  const httpHttpsCommands = [
    'sudo ufw allow 80/tcp comment "HTTP"',
    'sudo ufw allow 443/tcp comment "HTTPS"',
    "printf 'y\\n' | sudo ufw enable",
  ];
  for (const cmd of httpHttpsCommands) {
    try {
      await exec(server, cmd, { allowFailure: true, timeout: 60000, logLabel: 'firewall_ufw_rule' });
    } catch (e) {
      logger.warn('Public WWW: firewall command failed:', e.message);
    }
  }
  if (onProgress) onProgress('firewall', 'Firewall configured (only 22, 80, 443 open; Docker ports blocked)', 'ok');
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
 * Disable the distro default nginx site so our default_server in dockerfleet-proxy.conf is used (no "Welcome to nginx!").
 */
async function disableNginxDefaultSite(server) {
  await exec(server, 'sudo rm -f /etc/nginx/sites-enabled/default', { allowFailure: true });
}

/**
 * Ensure the Docker Fleet default page exists on the host (so nginx default_server can serve it).
 */
async function ensureDefaultPage(server) {
  await exec(server, `sudo mkdir -p ${NGINX_DEFAULT_PAGE_DIR}`, { allowFailure: false });
  const b64 = Buffer.from(DEFAULT_PAGE_HTML, 'utf8').toString('base64');
  await exec(server, `echo '${b64}' | base64 -d | sudo tee ${NGINX_DEFAULT_PAGE_PATH} > /dev/null`, { allowFailure: false });
  await exec(server, `sudo chown -R www-data:www-data ${NGINX_DEFAULT_PAGE_DIR}`, { allowFailure: true });
}

/**
 * List domain names that have a cert in /etc/letsencrypt/live/ (excludes README).
 * Tries ls without sudo first (works when SSH user is root), then sudo ls if empty (for non-root with sudo).
 */
async function getCertDomains(server) {
  let r = await exec(server, 'ls -1 /etc/letsencrypt/live/ 2>&1 || true', { allowFailure: true });
  let out = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  if (!out) {
    r = await exec(server, 'sudo ls -1 /etc/letsencrypt/live/ 2>&1 || true', { allowFailure: true });
    out = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  }
  const names = out ? out.split(/\n/).map((n) => n.trim()).filter((n) => n && n !== 'README') : [];
  return new Set(names);
}

/**
 * Write nginx config and reload nginx. Config is always generated from routes (per-route custom blocks or default).
 * If certDomains not provided, fetches from server.
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
  const user = await User.findByPk(userId);
  const certbotEmail = (user && user.letsEncryptEmail) ? user.letsEncryptEmail : LETSENCRYPT_EMAIL;

  try {
    await ensureHostnameResolves(server, onProgress);
    await configureFirewall(server, onProgress);
    await ensureNginxAndCertbot(server, onProgress);
    await disableNginxDefaultSite(server);
    await ensureDefaultPage(server);
    await writeNginxConfigAndReload(server, routes, onProgress);
    if (routes.length > 0) await runCertbot(server, routes, certbotEmail, onProgress);

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
  await disableNginxDefaultSite(server);
  await ensureDefaultPage(server);
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
  const hostLabel = server.host || server.name || serverId;

  logger.info('Public WWW: requestDnsCert started', { domain, wildcard, host: hostLabel });

  const user = await User.findByPk(userId);
  const certbotEmailRaw = (user && user.letsEncryptEmail) ? user.letsEncryptEmail : LETSENCRYPT_EMAIL;
  const certbotEmail = (certbotEmailRaw || '').replace(/'/g, "'\\''");
  logger.info('Public WWW: certbot email', { source: user?.letsEncryptEmail ? 'user' : 'env', email: certbotEmailRaw ? `${certbotEmailRaw.slice(0, 3)}***@${(certbotEmailRaw.split('@')[1] || '')}` : 'none' });

  await ensureHostnameResolves(server);
  await ensureNginxAndCertbot(server);
  logger.info('Public WWW: deploying DNS hook and runner', { host: hostLabel });
  await deployDnsHook(server);

  const certbotDomains = wildcard ? `-d ${baseDomain} -d '*.${baseDomain}'` : `-d ${domain}`;
  const certbotArgs = `certonly --manual --preferred-challenges dns ${certbotDomains} --manual-auth-hook ${CERTBOT_DNS_HOOK_PATH} --agree-tos --email ${certbotEmail} --non-interactive`;
  const runnerScript = `#!/bin/sh
LOG="${CERTBOT_DNS_LOG_PATH}"
echo "Certbot DNS started at $(date)" > "$LOG"
exec certbot ${certbotArgs} >> "$LOG" 2>&1
`;
  const runnerB64 = Buffer.from(runnerScript, 'utf8').toString('base64');
  await exec(server, `echo '${runnerB64}' | base64 -d | sudo tee ${CERTBOT_DNS_RUNNER_PATH} > /dev/null && sudo chmod +x ${CERTBOT_DNS_RUNNER_PATH}`, { allowFailure: false, logLabel: 'dns_runner_deploy' });
  logger.info('Public WWW: starting certbot in background', { host: hostLabel });
  await exec(server, `bash -c 'nohup sudo ${CERTBOT_DNS_RUNNER_PATH} </dev/null >/dev/null 2>&1 &'`, { allowFailure: true });
  await new Promise((r) => setTimeout(r, 4000));
  const mtimeCheck = await exec(server, `now=$(date +%s); mtime=$(stat -c %Y ${CERTBOT_DNS_LOG_PATH} 2>/dev/null || echo 0); [ $((now - mtime)) -le 60 ] && echo recent || echo stale`, { allowFailure: true });
  const logRecent = (mtimeCheck.stdout || '').trim() === 'recent';
  if (logRecent) {
    const headLog = await exec(server, `head -1 ${CERTBOT_DNS_LOG_PATH} 2>/dev/null`, { allowFailure: true });
    logger.info('Public WWW: runner started, log updated', { host: hostLabel, firstLine: (headLog.stdout || '').trim().slice(0, 60) });
  } else {
    logger.warn('Public WWW: runner did not start (log file not updated in 60s). Check: sudo /tmp/certbot-dns-runner.sh', { host: hostLabel });
  }
  logger.info('Public WWW: polling for challenge (up to 60s)', { host: hostLabel });

  const deadline = Date.now() + 60000;
  const startPoll = Date.now();
  let recordName = '';
  let recordValue = '';
  let challengeDomain = domain;
  let lastLogAt = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const elapsed = Math.round((Date.now() - startPoll) / 1000);
    if (elapsed >= lastLogAt + 10) {
      lastLogAt = elapsed;
      logger.info('Public WWW: waiting for challenge', { host: hostLabel, elapsedSec: elapsed });
    }
    const nameResult = await exec(server, 'cat /tmp/certbot-dns-name.txt 2>/dev/null', { allowFailure: true });
    const valueResult = await exec(server, 'cat /tmp/certbot-dns-value.txt 2>/dev/null', { allowFailure: true });
    const domainResult = await exec(server, 'cat /tmp/certbot-dns-domain.txt 2>/dev/null', { allowFailure: true });
    recordName = (nameResult.stdout || '').trim();
    recordValue = (valueResult.stdout || '').trim();
    challengeDomain = (domainResult.stdout || '').trim() || domain;
    if (recordName && recordValue) {
      logger.info('Public WWW: challenge received', { host: hostLabel, recordName });
      return { recordName, recordValue, domain: challengeDomain, baseDomain };
    }
  }
  const logResult = await exec(server, `cat ${CERTBOT_DNS_LOG_PATH} 2>/dev/null`, { allowFailure: true });
  const logSnippet = (logResult.stdout || '').trim().slice(-1200);
  if (logSnippet && /not yet due for renewal|Certificate not yet due for renewal/i.test(logSnippet)) {
    throw new Error(
      `Certificate for ${baseDomain} already exists and is not due for renewal. No action needed. ` +
      'To see installed certificates, use the Installed certificates list in Public WWW.'
    );
  }
  const onHost = ` On server ${hostLabel}: cat ${CERTBOT_DNS_LOG_PATH}`;
  const logHint = logSnippet
    ? ` Last log: ${logSnippet}${onHost}`
    : ` Log file empty or missing — certbot may have failed to start (e.g. sudo/hook).${onHost}`;
  throw new Error('Certbot did not produce challenge in time.' + logHint);
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
  const logSnippet = (logResult.stdout || '').trim();
  if (logSnippet && (/Certbot failed to authenticate|NXDOMAIN|DNS problem:/i.test(logSnippet) || /check that a DNS record exists/i.test(logSnippet))) {
    throw new Error(
      `DNS validation failed for ${baseDomain}: the TXT record for _acme-challenge.${baseDomain} was not found or not yet propagated. ` +
      'Add the record at your DNS provider, wait a few minutes for propagation, then click "Request challenge" again to get a new value (if needed) and "Continue" once the record is live.'
    );
  }
  throw new Error('Certificate did not appear in time. ' + (logSnippet || 'Check server /tmp/certbot-dns.log'));
}

/**
 * List Let's Encrypt certificates on the server: list /etc/letsencrypt/live/ (ls, then sudo ls if needed), read expiry per cert with openssl.
 */
async function listCertificates(serverId, userId) {
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');

  const names = await getCertDomains(server);
  const list = [...names].filter((n) => n && n !== 'README').sort();
  const certificates = [];

  for (const name of list) {
    const cert = { name, domains: [name], expiryDate: null, validDays: null };
    const path = `/etc/letsencrypt/live/${name}`;
    for (const certFile of ['fullchain.pem', 'cert.pem']) {
      const r = await exec(server, `openssl x509 -enddate -noout -in '${path}/${certFile}' 2>&1 || sudo openssl x509 -enddate -noout -in '${path}/${certFile}' 2>&1 || true`, { allowFailure: true, timeout: 5000 });
      const out = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
      const m = out.match(/notAfter=(.+)/);
      if (m) {
        cert.expiryDate = m[1].trim();
        try {
          const d = new Date(cert.expiryDate);
          if (!Number.isNaN(d.getTime())) cert.validDays = Math.max(0, Math.ceil((d - Date.now()) / (24 * 60 * 60 * 1000)));
        } catch (e) { /* ignore */ }
        break;
      }
    }
    certificates.push(cert);
  }

  return { certificates };
}

const EMPTY_NGINX_PLACEHOLDER = '# No proxy routes';

/**
 * Read the current nginx proxy config from the server (content of dockerfleet-proxy.conf).
 * Always returns generatedConfig (from routes) and customNginxConfig (stored) for the UI.
 */
async function getNginxConfig(serverId, userId) {
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');

  const r = await exec(server, `sudo cat ${NGINX_CONF_PATH} 2>/dev/null || true`, { allowFailure: true, timeout: 10000 });
  const config = (r.stdout || '').trim() || null;
  const routes = await ServerProxyRoute.findAll({ where: { serverId }, order: [['domain', 'ASC']] });
  const certDomains = await getCertDomains(server);
  const generatedConfig = buildNginxConfig(routes, certDomains);
  const customNginxConfig = (server.customNginxConfig || '').trim() || undefined;

  return {
    path: NGINX_CONF_PATH,
    config,
    generatedConfig,
    customNginxConfig,
  };
}

/**
 * Update the server's custom nginx config. Pass customNginxConfig (string or null) to set or clear.
 */
async function updateCustomNginxConfig(serverId, userId, { customNginxConfig }) {
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');
  const value = customNginxConfig != null && typeof customNginxConfig === 'string' ? customNginxConfig : null;
  await server.update({ customNginxConfig: value });
  return { customNginxConfig: (value || '').trim() || undefined };
}

module.exports = {
  enablePublicWww,
  disablePublicWww,
  syncProxy,
  configureFirewall,
  requestDnsCert,
  continueDnsCert,
  listCertificates,
  getNginxConfig,
  updateCustomNginxConfig,
  buildNginxConfig,
  getCertDomains,
};
