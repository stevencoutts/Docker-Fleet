/**
 * Public WWW: on a host with a public IP, enable firewall (80/443 only), nginx reverse proxy, and Let's Encrypt.
 * Nginx proxies domains to containers by port.
 */
const { Server, ServerProxyRoute, User } = require('../models');
const sshService = require('./ssh.service');
const dockerService = require('./docker.service');
const logger = require('../config/logger');

const NGINX_CONF_PATH = '/etc/nginx/conf.d/dockerfleet-proxy.conf';
const NGINX_DEFAULT_PAGE_DIR = '/etc/nginx/dockerfleet-default';
const NGINX_DEFAULT_PAGE_PATH = '/etc/nginx/dockerfleet-default/index.html';
const NGINX_DEFAULT_SSL_CERT = '/etc/nginx/dockerfleet-default/selfsigned.crt';
const NGINX_DEFAULT_SSL_KEY = '/etc/nginx/dockerfleet-default/selfsigned.key';
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
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; background: linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { text-align: center; padding: 2.5rem 2rem; max-width: 32rem; background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(71, 85, 105, 0.4); border-radius: 1rem; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4); }
    .logo { font-size: 2rem; font-weight: 800; margin: 0 0 0.5rem; letter-spacing: -0.03em; background: linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    p { margin: 0; color: #94a3b8; font-size: 0.9375rem; line-height: 1.6; }
    .badge { display: inline-block; margin-top: 1.5rem; padding: 0.35rem 0.9rem; background: rgba(30, 41, 59, 0.9); border-radius: 9999px; font-size: 0.75rem; font-weight: 500; color: #94a3b8; border: 1px solid rgba(71, 85, 105, 0.5); }
    .footer { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid rgba(71, 85, 105, 0.4); display: flex; flex-wrap: wrap; justify-content: center; gap: 1rem; font-size: 0.875rem; }
    .footer a { color: #94a3b8; text-decoration: none; transition: color 0.15s; }
    .footer a:hover { color: #e2e8f0; }
    .footer .sep { color: #475569; user-select: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1 class="logo">Docker Fleet</h1>
    <p>This host is managed by Docker Fleet. Add proxy routes to serve your domains here.</p>
    <span class="badge">Managed by Docker Fleet</span>
    <div class="footer">
      <a href="https://stevec.couttsnet.com" target="_blank" rel="noopener">Steven Coutts</a>
      <span class="sep">·</span>
      <a href="https://github.com/stevencoutts/Docker-Fleet" target="_blank" rel="noopener">GitHub</a>
    </div>
  </div>
</body>
</html>
`;

/** Nginx default_server blocks (80 and 443) that serve the Docker Fleet branded page when no server_name matches (e.g. request by IP). */
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
server {
    listen 443 ssl default_server;
    server_name _;
    ssl_certificate ${NGINX_DEFAULT_SSL_CERT};
    ssl_certificate_key ${NGINX_DEFAULT_SSL_KEY};
    root ${NGINX_DEFAULT_PAGE_DIR};
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;
}

function normalizeStaticRoot(path) {
  const p = String(path || '').trim();
  if (!p || !p.startsWith('/') || /[;'$`\\]/.test(p)) return null;
  return p.replace(/\/+$/, '') || null;
}

function buildProxyLocationDirectives(port) {
  return `        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;`;
}

function normalizeApiProxyPort(value, fallbackPort) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallbackPort;
  return n;
}

function buildPdsApiLocationBlock(apiPort) {
  const proxy = buildProxyLocationDirectives(apiPort);
  return `
    location ^~ /xrpc/ {
${proxy}
    }
    location ^~ /.well-known/ {
${proxy}
    }`;
}

/** Split routing: optional static /, main proxy, and /xrpc/ + /.well-known/ on apiProxyPort. */
function buildSplitRouteLocations(mainPort, apiPort, staticRoot) {
  const apiBlock = buildPdsApiLocationBlock(apiPort);
  if (staticRoot) {
    return `${apiBlock}
    location / {
        root ${staticRoot};
        index index.html;
        try_files $uri $uri/ /index.html;
    }`;
  }
  return `${apiBlock}
    location / {
${buildProxyLocationDirectives(mainPort)}
    }`;
}

function routeUsesSplitLocations(r, mainPort) {
  const staticRoot = normalizeStaticRoot(r.staticRoot);
  const apiPort = normalizeApiProxyPort(r.apiProxyPort, mainPort);
  return Boolean(staticRoot) || apiPort !== mainPort;
}

/** Generate the default server block(s) for one route (HTTP + optional HTTPS). */
function buildDefaultRouteBlock(r, certDomains = new Set()) {
  const domain = r.domain.trim();
  const mainPort = parseInt(r.containerPort, 10) || 80;
  const apiPort = normalizeApiProxyPort(r.apiProxyPort, mainPort);
  const baseDomain = domain.replace(/^\*\./, '');
  const hasCert = [...certDomains].some((d) => routeBaseDomain(d) === routeBaseDomain(baseDomain));
  const staticRoot = normalizeStaticRoot(r.staticRoot);
  const split = routeUsesSplitLocations(r, mainPort);
  const httpsLocations = split
    ? buildSplitRouteLocations(mainPort, apiPort, staticRoot)
    : `
    location / {
${buildProxyLocationDirectives(mainPort)}
    }`;

  let block = hasCert
    ? `
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    return 301 https://$host$request_uri;
}`
    : `
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
${httpsLocations}
}`;
  if (hasCert) {
    block += `
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${domain};
    ssl_certificate /etc/letsencrypt/live/${baseDomain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${baseDomain}/privkey.pem;
${httpsLocations}
}`;
  }
  return block;
}

function routeBaseDomain(domain) {
  return String(domain || '').replace(/^\*\./, '').trim().toLowerCase();
}

/** All server_name values from an nginx config dump (nginx -T or concatenated site files). */
function parseServerNamesFromNginxConfig(configText) {
  const names = new Set();
  if (!configText || typeof configText !== 'string') return names;
  const re = /server_name\s+([^;]+);/g;
  for (const match of configText.matchAll(re)) {
    for (const part of match[1].trim().split(/\s+/)) {
      const n = part.toLowerCase();
      if (n && n !== '_' && !n.startsWith('$')) names.add(n);
    }
  }
  return names;
}

async function getNginxConfiguredServerNames(server) {
  try {
    const nginxRunning = await exec(server, 'systemctl is-active nginx 2>/dev/null || true', { allowFailure: true, timeout: 5000 });
    if ((nginxRunning.stdout || '').trim() !== 'active') return new Set();

    const dump = await exec(server, 'sudo nginx -T 2>/dev/null || true', { allowFailure: true, timeout: 20000 });
    const configText = (dump.stdout || '').trim();
    if (configText) return parseServerNamesFromNginxConfig(configText);

    const catSites = await exec(
      server,
      'for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/* 2>/dev/null; do [ -f "$f" ] && cat "$f" 2>/dev/null; done',
      { allowFailure: true, timeout: 15000 },
    );
    return parseServerNamesFromNginxConfig((catSites.stdout || '').trim());
  } catch (e) {
    logger.warn('Public WWW: getNginxConfiguredServerNames failed', { host: server.host, message: e.message });
    return new Set();
  }
}

/**
 * server_name values in host nginx outside dockerfleet-proxy.conf (sites-enabled, other conf.d).
 * Used so Sync does not overwrite mtx/matrix/couttsnet vhosts that already live on the host.
 */
async function getExternalNginxServerNames(server) {
  const proxyBasename = NGINX_CONF_PATH.split('/').pop();
  const r = await exec(
    server,
    `for f in /etc/nginx/sites-enabled/*; do [ -f "$f" ] && cat "$f" 2>/dev/null; done; ` +
    `for f in /etc/nginx/conf.d/*; do [ -f "$f" ] || continue; b=$(basename "$f"); ` +
    `[ "$b" = "${proxyBasename}" ] && continue; cat "$f" 2>/dev/null; done`,
    { allowFailure: true, timeout: 15000, logLabel: 'nginx_external_vhosts' },
  );
  return parseServerNamesFromNginxConfig((r.stdout || '').trim());
}

/**
 * Port-80 server blocks for certs on disk that have no proxy route and no other nginx vhost.
 * Without these, HTTP-01 renewal hits default_server and returns 404.
 */
function buildOrphanCertHttpBlocks(routes, certDomains = new Set(), existingNginxNames = new Set()) {
  const routed = new Set((routes || []).map((r) => routeBaseDomain(r.domain)));
  const orphans = [...certDomains]
    .map((d) => routeBaseDomain(d))
    .filter((base) => base && base.includes('.') && !routed.has(base) && !existingNginxNames.has(base));
  const unique = [...new Set(orphans)].sort();
  if (unique.length === 0) return '';
  return `\n# Let's Encrypt HTTP-01 for certs without a proxy route\n${unique.map((domain) => `
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    location / {
        return 404;
    }
}`).join('')}\n`;
}

/** Domains that have a cert in /etc/letsencrypt/live/<domain>/ (base name only, e.g. example.com). */
function buildNginxConfig(routes, certDomains = new Set(), existingNginxNames = new Set()) {
  const defaultBlock = buildDefaultServerBlock();
  const blocks = (routes || []).map((r) => {
    const custom = (r.customNginxBlock || '').trim();
    if (custom) return custom;
    const base = routeBaseDomain(r.domain);
    if (existingNginxNames.has(base)) {
      return `# ${r.domain}: already configured on host nginx (e.g. sites-enabled); not duplicated here`;
    }
    return buildDefaultRouteBlock(r, certDomains);
  });
  const routeBlocks = blocks.join('\n') || '# No proxy routes\n';
  const orphanBlocks = buildOrphanCertHttpBlocks(routes, certDomains, existingNginxNames);
  return defaultBlock + routeBlocks + orphanBlocks;
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
 * Build a map of host port -> container name from running containers (Ports from docker ps).
 * Used to resolve proxy_pass target port to a container when importing existing nginx vhosts.
 */
async function getHostPortToContainerMap(server) {
  const map = new Map();
  try {
    const containers = await dockerService.listContainers(server, false);
    for (const c of containers) {
      const name = (c.Names || '').replace(/^\//, '').trim();
      if (!name) continue;
      const portsStr = c.Ports || '';
      // Ports format: "0.0.0.0:8080->80/tcp, 0.0.0.0:8081->81/tcp" or "8080->80/tcp"
      const segments = portsStr.split(',').map((s) => s.trim()).filter(Boolean);
      for (const seg of segments) {
        const m = seg.match(/(\d+)->\d+/);
        if (m) {
          const hostPort = parseInt(m[1], 10);
          if (hostPort >= 1 && hostPort <= 65535) map.set(hostPort, name);
        }
      }
    }
  } catch (e) {
    logger.warn('Public WWW: could not list containers for port map', { host: server.host, message: e.message });
  }
  return map;
}

/**
 * Build map of upstream name -> port from config (upstream X { server 127.0.0.1:PORT; }).
 */
function parseUpstreamPorts(configText) {
  const map = new Map();
  if (!configText || typeof configText !== 'string') return map;
  const upstreamRe = /upstream\s+(\w+)\s*\{([^}]+)\}/g;
  let m;
  while ((m = upstreamRe.exec(configText)) !== null) {
    const block = m[2];
    const serverMatch = block.match(/server\s+(?:127\.0\.0\.1|localhost)(?::(\d+))?/);
    if (serverMatch) {
      const port = serverMatch[1] ? parseInt(serverMatch[1], 10) : 80;
      if (port >= 1 && port <= 65535) map.set(m[1], port);
    }
  }
  return map;
}

/**
 * Parse nginx config text for server blocks that proxy to localhost; return vhosts with domain(s) and target port.
 * Each item: { domains: string[], targetPort: number }.
 * Skips our blocks (dockerfleet-default, dockerfleet-proxy), server_name _, and blocks without a proxy port.
 * Supports proxy_pass http://127.0.0.1:PORT, http://localhost:PORT, $scheme://..., and proxy_pass http://upstream_name (resolved via upstream blocks).
 */
function parseVhostsFromNginxConfig(configText) {
  if (!configText || typeof configText !== 'string') return [];
  const upstreamPorts = parseUpstreamPorts(configText);
  const vhosts = [];
  let i = 0;
  const s = configText;
  while (i < s.length) {
    const serverStart = s.indexOf('server', i);
    if (serverStart === -1) break;
    const braceStart = s.indexOf('{', serverStart);
    if (braceStart === -1) {
      i = serverStart + 1;
      continue;
    }
    let depth = 1;
    let j = braceStart + 1;
    while (j < s.length && depth > 0) {
      const ch = s[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    const block = s.slice(serverStart, j);
    if (/dockerfleet-default|dockerfleet-proxy/.test(block)) {
      i = j;
      continue;
    }
    const serverNameMatch = block.match(/server_name\s+([^;]+);/);
    const names = serverNameMatch
      ? serverNameMatch[1].split(/\s+/).map((n) => n.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter((n) => n && n !== '_')
      : [];
    let port = null;
    const directMatch = block.match(/proxy_pass\s+(?:\$scheme|https?):\/\/(?:127\.0\.0\.1|localhost)(?::(\d+))?(\/.*)?\s*;/);
    if (directMatch) {
      port = directMatch[1] ? parseInt(directMatch[1], 10) : 80;
    } else {
      const upstreamMatch = block.match(/proxy_pass\s+https?:\/\/([a-zA-Z0-9_]+)\/?\s*;/);
      if (upstreamMatch && upstreamPorts.has(upstreamMatch[1])) {
        port = upstreamPorts.get(upstreamMatch[1]);
      }
    }
    if (names.length && port >= 1 && port <= 65535) {
      vhosts.push({ domains: names, targetPort: port });
    }
    i = j;
  }
  return vhosts;
}

/**
 * Check if nginx is running and has existing vhost config we should not overwrite.
 * Uses nginx -T to get full parsed config (all includes expanded) so vhosts in included files are found.
 * Returns { hasExistingVhosts: boolean, configText: string }.
 */
async function detectExistingNginxWithVhosts(server) {
  let configText = '';
  try {
    const nginxRunning = await exec(server, 'systemctl is-active nginx 2>/dev/null || true', { allowFailure: true, timeout: 5000 });
    if ((nginxRunning.stdout || '').trim() !== 'active') return { hasExistingVhosts: false, configText: '' };

    let dump = await exec(server, 'sudo nginx -T 2>/dev/null || true', { allowFailure: true, timeout: 15000 });
    configText = (dump.stdout || '').trim();
    if (!configText) {
      const ourBasename = 'dockerfleet-proxy.conf';
      const catSites = await exec(
        server,
        'cat /etc/nginx/sites-enabled/default 2>/dev/null; for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/* 2>/dev/null; do [ -f "$f" ] && [ "$(basename "$f")" != "' +
          ourBasename +
          '" ] && [ "$f" != /etc/nginx/sites-enabled/default ] && cat "$f" 2>/dev/null; done',
        { allowFailure: true, timeout: 15000 }
      );
      configText = (catSites.stdout || '').trim();
    }
  } catch (e) {
    logger.warn('Public WWW: detect existing nginx failed', { host: server.host, message: e.message });
    return { hasExistingVhosts: false, configText: '' };
  }
  const vhosts = parseVhostsFromNginxConfig(configText);
  const hasExistingVhosts = vhosts.length > 0;
  return { hasExistingVhosts, configText };
}

/**
 * Import existing nginx vhosts as proxy routes. Resolves target port to container via Docker port bindings.
 * Only creates routes when the target port is served by a running container (skips vhosts with no matching container).
 */
async function importExistingVhostsAsRoutes(serverId, server, configText, onProgress) {
  const vhosts = parseVhostsFromNginxConfig(configText);
  if (vhosts.length === 0) return { imported: 0 };
  if (onProgress) onProgress('import_vhosts', 'Resolving containers and creating proxy routes...', 'running');
  const portToContainer = await getHostPortToContainerMap(server);
  const existing = await ServerProxyRoute.findAll({ where: { serverId }, attributes: ['domain'] });
  const existingDomains = new Set(existing.map((r) => r.domain.trim().toLowerCase()));
  let imported = 0;
  for (const v of vhosts) {
    if (!portToContainer.has(v.targetPort)) continue;
    const containerName = portToContainer.get(v.targetPort);
    for (const domain of v.domains) {
      const d = domain.trim().toLowerCase();
      if (!d || existingDomains.has(d)) continue;
      try {
        await ServerProxyRoute.create({
          serverId,
          domain: d,
          containerName,
          containerPort: v.targetPort,
        });
        existingDomains.add(d);
        imported++;
      } catch (e) {
        logger.warn('Public WWW: import route failed', { domain: d, message: e.message });
      }
    }
  }
  if (onProgress) onProgress('import_vhosts', `Imported ${imported} proxy route(s) from existing nginx.`, 'ok');
  return { imported };
}

/**
 * Return true if nginx is already installed on the host (active or package present).
 * Must be called before ensureNginxAndCertbot so we know we didn't just install it.
 */
async function isNginxAlreadyInstalled(server) {
  try {
    const r = await exec(
      server,
      "[ \"$(systemctl is-active nginx 2>/dev/null)\" = active ] || dpkg -l nginx 2>/dev/null | grep -q '^ii'",
      { allowFailure: true, timeout: 10000 }
    );
    return r.code === 0;
  } catch (e) {
    return false;
  }
}

async function isCertbotInstalled(server) {
  try {
    const r = await exec(server, 'command -v certbot >/dev/null && echo ok', { allowFailure: true, timeout: 10000 });
    return (r.stdout || '').trim() === 'ok';
  } catch (e) {
    return false;
  }
}

/** Skip apt-get when nginx and certbot are already on the host (renew/DNS flows must stay fast). */
async function ensureNginxAndCertbotIfNeeded(server, onProgress) {
  const [nginx, certbot] = await Promise.all([isNginxAlreadyInstalled(server), isCertbotInstalled(server)]);
  if (nginx && certbot) return;
  await ensureNginxAndCertbot(server, onProgress);
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
 * Ensure a self-signed cert exists for default_server on 443 (so https://ip shows the same holding page as http://ip).
 */
async function ensureDefaultSslCert(server) {
  const check = await exec(server, `test -f ${NGINX_DEFAULT_SSL_CERT} && echo ok`, { allowFailure: true });
  if ((check.stdout || '').trim() === 'ok') return;
  const cmd = `sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout ${NGINX_DEFAULT_SSL_KEY} -out ${NGINX_DEFAULT_SSL_CERT} -subj "/CN=default" 2>/dev/null`;
  await exec(server, cmd, { allowFailure: false, timeout: 15000 });
  await exec(server, `sudo chown www-data:www-data ${NGINX_DEFAULT_SSL_CERT} ${NGINX_DEFAULT_SSL_KEY}`, { allowFailure: true });
}

/**
 * List domain names that have a cert in /etc/letsencrypt/live/ (excludes README).
 * Tries ls without sudo first (works when SSH user is root), then sudo ls if stdout empty (for non-root with sudo).
 * Only uses stdout so permission-denied messages in stderr are not treated as cert names.
 */
async function getCertDomains(server) {
  let r = await exec(server, 'ls -1 /etc/letsencrypt/live/ 2>/dev/null || true', { allowFailure: true });
  let out = (r.stdout || '').trim();
  if (!out) {
    r = await exec(server, 'sudo ls -1 /etc/letsencrypt/live/ 2>/dev/null || true', { allowFailure: true });
    out = (r.stdout || '').trim();
  }
  const names = out ? out.split(/\n/).map((n) => n.trim()).filter((n) => n && n !== 'README' && n.includes('.')) : [];
  return new Set(names);
}

/**
 * Write nginx config and reload nginx. Config is always generated from routes (per-route custom blocks or default).
 * If certDomains not provided, fetches from server.
 */
async function writeNginxConfigAndReload(server, routes, onProgress, certDomains) {
  if (onProgress) onProgress('nginx_config', 'Writing nginx config and reloading...', 'running');
  const domains = certDomains ?? await getCertDomains(server);
  const externalNginxNames = await getExternalNginxServerNames(server);
  const config = buildNginxConfig(routes, domains, externalNginxNames);
  const escaped = config.replace(/'/g, "'\\''");
  await exec(server, `echo '${escaped}' | sudo tee ${NGINX_CONF_PATH} > /dev/null`, { allowFailure: false, logLabel: 'nginx_write_config' });
  const reload = await exec(server, 'sudo nginx -t && sudo systemctl reload nginx', { allowFailure: true, logLabel: 'nginx_test_reload' });
  if (reload.code !== 0) {
    const detail = `${reload.stderr || ''}\n${reload.stdout || ''}`.trim().slice(-2000);
    throw new Error(`Nginx config test failed after writing ${NGINX_CONF_PATH}.${detail ? `\n\n${detail}` : ''}`);
  }
  if (onProgress) onProgress('nginx_config', 'Nginx config applied', 'ok');
}

function routeIsManagedInDockerfleet(route, existingNginxNames) {
  if ((route.customNginxBlock || '').trim()) return true;
  return !existingNginxNames.has(routeBaseDomain(route.domain));
}

/** Routes that need a new HTTP-01 cert via certbot --nginx (not DNS/manual, not already issued). */
async function getRoutesNeedingHttpCertbot(server, routes) {
  const certDomains = await getCertDomains(server);
  const manualSet = new Set((await getManualDnsCertificateNames(server)).map((n) => routeBaseDomain(n)));
  const externalNginxNames = await getExternalNginxServerNames(server);
  return (routes || []).filter((r) => {
    const base = routeBaseDomain(r.domain);
    if (!routeIsManagedInDockerfleet(r, externalNginxNames)) return false;
    if ([...certDomains].some((d) => routeBaseDomain(d) === base)) return false;
    if (manualSet.has(base)) return false;
    return true;
  });
}

/**
 * Run certbot --nginx for new HTTP-01 domains only. Does not use --redirect (template handles HTTPS redirect).
 */
async function runCertbot(server, routes, email = LETSENCRYPT_EMAIL, onProgress) {
  for (const route of routes || []) {
    const domain = (route.domain || '').trim();
    if (!domain) continue;
    if (onProgress) onProgress('certbot', `Requesting certificate for ${domain}...`, 'running');
    try {
      await exec(
        server,
        `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email ${email} 2>/dev/null || true`,
        { timeout: 180000, allowFailure: true },
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
    const nginxAlreadyInstalled = await isNginxAlreadyInstalled(server);
    await ensureNginxAndCertbot(server, onProgress);

    const { hasExistingVhosts, configText } = await detectExistingNginxWithVhosts(server);
    if (hasExistingVhosts) {
      // Do not edit nginx or firewall: import existing vhosts as proxy routes and leave config untouched.
      const { imported } = await importExistingVhostsAsRoutes(serverId, server, configText, onProgress);
      await server.update({ publicWwwEnabled: true });
      if (onProgress) onProgress('done', 'Public WWW enabled (existing nginx left as-is, routes imported).', 'ok');
      return {
        success: true,
        message: `Public WWW enabled. Existing nginx and firewall were not changed. ${imported} proxy route(s) imported from current vhosts.`,
      };
    }

    if (!nginxAlreadyInstalled) await configureFirewall(server, onProgress);
    await disableNginxDefaultSite(server);
    await ensureDefaultPage(server);
    await ensureDefaultSslCert(server);
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
/**
 * Attach generatedNginxBlock to each route that uses the default template (no custom block).
 */
async function enrichProxyRoutesForApi(server, routes) {
  const rows = routes.map((r) => (r.toJSON ? r.toJSON() : { ...r }));
  if (!server.publicWwwEnabled) return rows;

  let certDomains = new Set();
  try {
    certDomains = await getCertDomains(server);
  } catch (e) {
    logger.warn('Public WWW: getCertDomains for route preview failed', { host: server.host, message: e.message });
  }

  let externalNginxNames = new Set();
  try {
    externalNginxNames = await getExternalNginxServerNames(server);
  } catch (e) {
    logger.warn('Public WWW: getExternalNginxServerNames for route preview failed', { host: server.host, message: e.message });
  }

  return rows.map((row) => {
    if ((row.customNginxBlock || '').trim()) return row;
    const base = routeBaseDomain(row.domain);
    if (externalNginxNames.has(base)) {
      row.nginxManagedExternally = true;
      return row;
    }
    row.generatedNginxBlock = buildDefaultRouteBlock(row, certDomains).trim();
    return row;
  });
}

async function syncProxy(serverId, userId) {
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');
  const routes = await ServerProxyRoute.findAll({ where: { serverId } });

  await ensureNginxAndCertbot(server);
  await disableNginxDefaultSite(server);
  await ensureDefaultPage(server);
  await ensureDefaultSslCert(server);
  await writeNginxConfigAndReload(server, routes);

  const user = await User.findByPk(userId);
  const certbotEmail = (user && user.letsEncryptEmail) ? user.letsEncryptEmail : LETSENCRYPT_EMAIL;
  const needCertbot = await getRoutesNeedingHttpCertbot(server, routes);
  if (needCertbot.length > 0) {
    await runCertbot(server, needCertbot, certbotEmail);
    await writeNginxConfigAndReload(server, routes);
  }

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
  const forceRenewal = Boolean(options.forceRenewal);
  const baseDomain = domain.replace(/^\*\./, '');
  const hostLabel = server.host || server.name || serverId;

  logger.info('Public WWW: requestDnsCert started', { domain, wildcard, host: hostLabel });

  const user = await User.findByPk(userId);
  const certbotEmailRaw = (user && user.letsEncryptEmail) ? user.letsEncryptEmail : LETSENCRYPT_EMAIL;
  const certbotEmail = (certbotEmailRaw || '').replace(/'/g, "'\\''");
  logger.info('Public WWW: certbot email', { source: user?.letsEncryptEmail ? 'user' : 'env', email: certbotEmailRaw ? `${certbotEmailRaw.slice(0, 3)}***@${(certbotEmailRaw.split('@')[1] || '')}` : 'none' });

  await ensureHostnameResolves(server);
  await ensureNginxAndCertbotIfNeeded(server);
  logger.info('Public WWW: deploying DNS hook and runner', { host: hostLabel });
  await deployDnsHook(server);

  const certbotDomains = wildcard ? `-d ${baseDomain} -d '*.${baseDomain}'` : `-d ${domain}`;
  const forceFlag = forceRenewal ? ' --force-renewal' : '';
  const certbotArgs = `certonly --manual --preferred-challenges dns ${certbotDomains} --manual-auth-hook ${CERTBOT_DNS_HOOK_PATH} --agree-tos --email ${certbotEmail} --non-interactive${forceFlag}`;
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

async function readCertbotDnsLog(server, lines = 120) {
  const r = await exec(server, `sudo tail -${lines} ${CERTBOT_DNS_LOG_PATH} 2>/dev/null || true`, {
    allowFailure: true,
    timeout: 15000,
  });
  return (r.stdout || '').trim();
}

function interpretCertbotDnsLog(log) {
  if (!log) return { status: 'pending' };
  if (
    /Successfully received certificate|Certificate is saved at:|Congratulations! Your certificate|Certificate not yet due for renewal/i.test(log)
  ) {
    return { status: 'success' };
  }
  if (
    /Certbot failed to authenticate|Some challenges have failed|Challenge failed|incorrect TXT|NXDOMAIN|DNS problem:|No TXT record|check that a DNS record exists|Timeout during connect/i.test(log)
  ) {
    return { status: 'failed' };
  }
  return { status: 'pending' };
}

async function isCertbotDnsRunnerActive(server) {
  const r = await exec(
    server,
    'pgrep -af "certbot certonly" 2>/dev/null || pgrep -af certbot-dns-runner 2>/dev/null || pgrep -af "certbot.*manual" 2>/dev/null || true',
    { allowFailure: true, timeout: 10000 },
  );
  return Boolean((r.stdout || '').trim());
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
  const hostLabel = server.host || server.name || serverId;
  const certPath = `/etc/letsencrypt/live/${baseDomain}/fullchain.pem`;

  const certBefore = await exec(server, `sudo stat -c %Y '${certPath}' 2>/dev/null || echo 0`, { allowFailure: true, timeout: 10000 });
  const certMtimeBefore = parseInt((certBefore.stdout || '').trim(), 10) || 0;
  const hadCertBefore = certMtimeBefore > 0;

  const logBefore = await readCertbotDnsLog(server, 120);
  if (interpretCertbotDnsLog(logBefore).status === 'success') {
    logger.info('Public WWW: continueDnsCert — cert already issued per log', { host: hostLabel, baseDomain });
    const routes = await ServerProxyRoute.findAll({ where: { serverId } });
    const certDomains = await getCertDomains(server);
    await writeNginxConfigAndReload(server, routes, null, certDomains);
    return { success: true, message: `Certificate for ${baseDomain} is installed. Nginx reloaded.` };
  }

  const runnerActiveBefore = await isCertbotDnsRunnerActive(server);
  if (!runnerActiveBefore && !logBefore.includes('Certbot DNS started')) {
    throw new Error(
      'Certbot is not running on the server. Click Request challenge again, wait for the TXT record, add it at your DNS provider, then click Continue while certbot is still waiting (usually within a few minutes).',
    );
  }

  logger.info('Public WWW: continueDnsCert — touching continue file', { host: hostLabel, baseDomain });
  await exec(server, `sudo touch ${CERTBOT_DNS_CONTINUE_FILE}`, { allowFailure: false, timeout: 10000 });
  const continueStartedAt = Date.now();

  const deadline = Date.now() + 180000;
  let lastLogSnippet = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));

    lastLogSnippet = await readCertbotDnsLog(server, 120);
    const logState = interpretCertbotDnsLog(lastLogSnippet);
    if (logState.status === 'failed') {
      throw new Error(
        `DNS validation failed for ${baseDomain}: the TXT record for _acme-challenge.${baseDomain} was not found, is wrong, or has not propagated yet. ` +
        'Verify the record at your DNS provider, wait a few minutes, click Request challenge if you need a fresh value, then Continue again.\n\n' +
        (lastLogSnippet.slice(-800) || `Check ${CERTBOT_DNS_LOG_PATH} on the server.`),
      );
    }
    if (logState.status === 'success') {
      break;
    }

    const certNow = await exec(server, `sudo stat -c %Y '${certPath}' 2>/dev/null || echo 0`, { allowFailure: true, timeout: 10000 });
    const certMtimeNow = parseInt((certNow.stdout || '').trim(), 10) || 0;
    if (!hadCertBefore && certMtimeNow > 0) break;
    if (hadCertBefore && certMtimeNow > certMtimeBefore) break;

    const runnerActive = await isCertbotDnsRunnerActive(server);
    const elapsedMs = Date.now() - continueStartedAt;
    if (
      !runnerActive
      && elapsedMs > 45000
      && interpretCertbotDnsLog(lastLogSnippet).status === 'pending'
      && !(await exec(server, `sudo test -f '${certPath}' && echo ok`, { allowFailure: true, timeout: 10000 })).stdout?.includes('ok')
    ) {
      throw new Error(
        `Certbot stopped before finishing ${baseDomain}. ` +
        `On the server run: sudo tail -50 ${CERTBOT_DNS_LOG_PATH} — then Request challenge and try again.\n\n` +
        (lastLogSnippet.slice(-800) || ''),
      );
    }
  }

  const finalLog = lastLogSnippet || await readCertbotDnsLog(server, 120);
  const finalState = interpretCertbotDnsLog(finalLog);
  const certFinal = await exec(server, `sudo test -f '${certPath}' && echo ok`, { allowFailure: true, timeout: 10000 });
  const certExists = (certFinal.stdout || '').trim() === 'ok';

  if (finalState.status === 'success' || certExists) {
    const routes = await ServerProxyRoute.findAll({ where: { serverId } });
    const certDomains = await getCertDomains(server);
    await writeNginxConfigAndReload(server, routes, null, certDomains);
    return { success: true, message: `Certificate for ${baseDomain} installed and nginx reloaded.` };
  }

  if (!certExists && finalState.status !== 'success') {
    if (finalState.status === 'failed') {
      throw new Error(
        `DNS validation failed for ${baseDomain}. ` +
        (finalLog.slice(-800) || `Check ${CERTBOT_DNS_LOG_PATH} on the server.`),
      );
    }
    throw new Error(
      `Certificate for ${baseDomain} did not appear within 3 minutes. ` +
      `Certbot may still be running — check: sudo tail -f ${CERTBOT_DNS_LOG_PATH}\n\n` +
      (finalLog.slice(-800) || ''),
    );
  }

  throw new Error(`Certificate for ${baseDomain} could not be confirmed after issuance. ${finalLog.slice(-800)}`);
}

/**
 * Cert names issued via our interactive DNS/manual certbot flow (authenticator = manual in renewal config).
 */
async function getManualDnsCertificateNames(server) {
  const r = await exec(
    server,
    "sudo sh -c 'for f in /etc/letsencrypt/renewal/*.conf; do [ -f \"$f\" ] || continue; grep -q \"^authenticator = manual\" \"$f\" 2>/dev/null && basename \"$f\" .conf; done'",
    { allowFailure: true, timeout: 15000, logLabel: 'certbot_manual_list' },
  );
  return (r.stdout || '').trim().split('\n').map((n) => n.trim()).filter(Boolean);
}

/**
 * List Let's Encrypt certificates on the server: list /etc/letsencrypt/live/ (ls, then sudo ls if needed), read expiry per cert with openssl.
 */
async function listCertificates(serverId, userId) {
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');

  const names = await getCertDomains(server);
  const list = [...names].filter((n) => n && n !== 'README').sort();
  const manualDnsNames = new Set((await getManualDnsCertificateNames(server)).map((n) => n.toLowerCase()));
  const routes = await ServerProxyRoute.findAll({ where: { serverId } });
  const routedDomains = new Set(routes.map((r) => routeBaseDomain(r.domain)));
  const externalNginxNames = await getExternalNginxServerNames(server);
  const certificates = [];

  for (const name of list) {
    const base = routeBaseDomain(name);
    const cert = {
      name,
      domains: [name],
      expiryDate: null,
      validDays: null,
      manualDns: manualDnsNames.has(name.toLowerCase()),
      noProxyRoute: !manualDnsNames.has(name.toLowerCase())
        && !routedDomains.has(base)
        && !externalNginxNames.has(base),
      externalNginxVhost: !routedDomains.has(base) && externalNginxNames.has(base),
    };
    const path = `/etc/letsencrypt/live/${name}`;
    for (const certFile of ['fullchain.pem', 'cert.pem']) {
      const enddateR = await exec(server, `openssl x509 -enddate -noout -in '${path}/${certFile}' 2>/dev/null || sudo openssl x509 -enddate -noout -in '${path}/${certFile}' 2>/dev/null || true`, { allowFailure: true, timeout: 5000 });
      const enddateOut = (enddateR.stdout || '').trim();
      const enddateM = enddateOut.match(/notAfter=(.+)/);
      if (enddateM) {
        cert.expiryDate = enddateM[1].trim();
        try {
          const d = new Date(cert.expiryDate);
          if (!Number.isNaN(d.getTime())) cert.validDays = Math.max(0, Math.ceil((d - Date.now()) / (24 * 60 * 60 * 1000)));
        } catch (e) { /* ignore */ }
      }
      const sanR = await exec(server, `openssl x509 -noout -ext subjectAltName -in '${path}/${certFile}' 2>/dev/null || sudo openssl x509 -noout -ext subjectAltName -in '${path}/${certFile}' 2>/dev/null || true`, { allowFailure: true, timeout: 5000 });
      const sanOut = (sanR.stdout || '').trim();
      const dnsNames = [];
      const dnsMatches = sanOut.matchAll(/DNS:([^,\s]+)/g);
      for (const match of dnsMatches) dnsNames.push(match[1].toLowerCase());
      if (dnsNames.length > 0) cert.domains = [...new Set([name, ...dnsNames])];
      break;
    }
    certificates.push(cert);
  }

  return { certificates };
}

function certbotRenewOutputIndicatesSuccess(out) {
  const lower = `${out || ''}`.toLowerCase();
  return !(
    lower.includes('no renewals were attempted') ||
    lower.includes('not yet due for renewal') ||
    lower.includes('no renewals attempted') ||
    lower.includes('no certificates found')
  );
}

/** Extract user-actionable hints from certbot stdout/stderr. */
function parseCertbotFailureHints(out) {
  const text = `${out || ''}`;
  const hints = { rateLimited: false, rateLimitRetryAfter: null, nginxConfigParseErrors: [] };
  if (/rateLimited|too many failed authorizations/i.test(text)) {
    hints.rateLimited = true;
    const m = text.match(/retry after (\d{4}-\d{2}-\d{2}[^\n]+UTC)/i);
    if (m) hints.rateLimitRetryAfter = m[1].trim();
  }
  for (const match of text.matchAll(/Could not parse file: ([^\s]+)/g)) {
    hints.nginxConfigParseErrors.push(match[1]);
  }
  return hints;
}

function formatCertbotFailureHints(hints) {
  const parts = [];
  if (hints.nginxConfigParseErrors.length > 0) {
    const files = [...new Set(hints.nginxConfigParseErrors)].join(', ');
    parts.push(
      `Certbot cannot parse nginx config (${files}). CrowdSec/OpenResty snippets in conf.d often break the certbot nginx plugin — temporarily move them out of conf.d, renew, then restore.`,
    );
  }
  if (/\.well-known\/acme-challenge|unauthorized/i.test(text) && /404|unauthorized/i.test(text)) {
    parts.push(
      'HTTP-01 validation failed (404): the domain needs a port-80 nginx server_name block. Add a Public WWW proxy route for that domain and click Sync config, then renew.',
    );
  }
  if (hints.rateLimited) {
    parts.push(
      hints.rateLimitRetryAfter
        ? `Let's Encrypt rate limit: wait until ${hints.rateLimitRetryAfter} before trying again.`
        : 'Let\'s Encrypt rate limit: too many failed renewals recently — wait about an hour before retrying.',
    );
  }
  return parts.join(' ');
}

async function execCertbotRenew(server, { certName = null, forceRenewal = false } = {}) {
  const safeName = certName ? String(certName).replace(/'/g, "'\\''") : null;
  const parts = ['sudo certbot renew --non-interactive'];
  if (safeName) parts.push(`--cert-name '${safeName}'`);
  if (forceRenewal) parts.push('--force-renewal');
  return exec(server, parts.join(' '), {
    timeout: 240000,
    allowFailure: true,
    logLabel: certName ? `certbot_renew_${certName}` : 'certbot_renew',
  });
}

/** Run certbot renew once for HTTP/nginx-managed certs (no --force-renewal; avoids LE rate limits). */
async function renewNonManualCertbotCerts(server, nonManual) {
  if (nonManual.length === 0) return { renewed: false, details: undefined };

  const renew = await execCertbotRenew(server);
  const out = `${renew.stdout || ''}\n${renew.stderr || ''}`.trim();
  const hints = parseCertbotFailureHints(out);

  if (renew.code !== 0) {
    return {
      renewed: false,
      details: out ? out.slice(-4000) : undefined,
      errorCode: renew.code,
      errorOut: out,
      hints,
      hintMessage: formatCertbotFailureHints(hints),
    };
  }

  const renewed = certbotRenewOutputIndicatesSuccess(out);

  await exec(server, 'sudo systemctl reload nginx 2>/dev/null || sudo nginx -s reload 2>/dev/null || true', {
    allowFailure: true,
    logLabel: 'nginx_reload_after_renew',
  });

  return {
    renewed,
    details: out ? out.slice(-4000) : undefined,
    hints,
    hintMessage: renewed ? undefined : formatCertbotFailureHints(hints),
  };
}

/**
 * Renew Let's Encrypt certificates (certbot renew) and reload nginx.
 * Renews certs expiring in 30 days or less; no-op if none need renewal.
 */
async function renewCertificates(serverId, userId) {
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');

  await ensureNginxAndCertbotIfNeeded(server);

  const EXPIRY_SOON_DAYS = 30;
  const manualNames = await getManualDnsCertificateNames(server);
  if (manualNames.length > 0) {
    let allCertificates = [];
    try {
      const listed = await listCertificates(serverId, userId);
      allCertificates = listed.certificates || [];
    } catch (e) {
      logger.warn('Public WWW: listCertificates during renew skipped', { host: server.host, message: e.message });
    }
    const manualSet = new Set(manualNames.map((n) => n.toLowerCase()));
    let manualCertificates = allCertificates.filter((c) => manualSet.has(String(c.name).toLowerCase()));
    if (manualCertificates.length === 0) {
      manualCertificates = manualNames.map((name) => ({ name, domains: [name], manualDns: true }));
    }
    const expiringManual = manualCertificates.filter((c) => c.validDays != null && c.validDays < EXPIRY_SOON_DAYS);
    const needsDnsRenewalPanel = expiringManual.length > 0;
    const preferredDnsDomain = needsDnsRenewalPanel
      ? [...expiringManual].sort((a, b) => (a.validDays ?? 999) - (b.validDays ?? 999))[0].name
      : null;

    // Renew HTTP/nginx certs (e.g. mtx) via certbot even when other certs need DNS renewal.
    const nonManual = allCertificates.filter((c) => !manualSet.has(String(c.name).toLowerCase()));
    let certbotRenewed = false;
    let certbotDetails;
    let renewResult;
    if (nonManual.length > 0) {
      renewResult = await renewNonManualCertbotCerts(server, nonManual);
      certbotDetails = renewResult.details;
      if (renewResult.errorCode != null) {
        const tail = (renewResult.errorOut || '').slice(-1800) || `certbot renew exited with code ${renewResult.errorCode}`;
        const hint = renewResult.hintMessage ? `\n\n${renewResult.hintMessage}` : '';
        return {
          success: false,
          error: `Certificate renewal failed for non-DNS certificates.${hint}\n\n${tail}`,
          requiresDnsRenewal: expiringManual.length > 0,
          manualCertificates,
          manualCertificateNames: manualNames,
          preferredDnsDomain: expiringManual.length > 0
            ? [...expiringManual].sort((a, b) => (a.validDays ?? 999) - (b.validDays ?? 999))[0].name
            : null,
        };
      }
      certbotRenewed = renewResult.renewed;
    }

    const soonestExpiring = [...allCertificates]
      .filter((c) => c.validDays != null && c.validDays < EXPIRY_SOON_DAYS)
      .sort((a, b) => (a.validDays ?? 999) - (b.validDays ?? 999))[0];

    let message;
    if (soonestExpiring && !manualSet.has(String(soonestExpiring.name).toLowerCase())) {
      const hintSuffix = renewResult?.hintMessage ? ` ${renewResult.hintMessage}` : '';
      const certbotPart = certbotRenewed
        ? `Certbot renewed ${soonestExpiring.name}. Refresh certs to see the new expiry.`
        : `Certbot could not renew ${soonestExpiring.name} (${soonestExpiring.validDays} days left).${hintSuffix || ' If it uses DNS validation, use Renew (DNS). Otherwise check /etc/letsencrypt/renewal and nginx -t on the server.'}`;
      if (preferredDnsDomain) {
        message = `${certbotPart} DNS renewal below is for ${preferredDnsDomain}.`;
      } else {
        message = certbotPart;
      }
    } else if (preferredDnsDomain) {
      message = `DNS renewal is required for ${preferredDnsDomain}. Add the TXT record, then click Continue.`;
    } else if (needsDnsRenewalPanel) {
      message =
        'One or more certificates use DNS validation. Request a TXT record below, add it at your DNS provider, then confirm when done.';
    } else {
      message = certbotRenewed
        ? 'Certificates renewed via certbot.'
        : 'No certificate renewals were required right now.';
    }

    return {
      success: true,
      renewed: certbotRenewed,
      requiresDnsRenewal: needsDnsRenewalPanel,
      manualCertificates,
      manualCertificateNames: manualNames,
      preferredDnsDomain,
      expiringSoonestName: soonestExpiring?.name,
      expiringSoonestUsesDns: soonestExpiring ? manualSet.has(String(soonestExpiring.name).toLowerCase()) : undefined,
      certbotRenewed,
      details: certbotDetails,
      message,
    };
  }

  let allCertificates = [];
  try {
    const listed = await listCertificates(serverId, userId);
    allCertificates = listed.certificates || [];
  } catch (e) {
    logger.warn('Public WWW: listCertificates during renew skipped', { host: server.host, message: e.message });
  }
  const manualSetNoDns = new Set(manualNames.map((n) => n.toLowerCase()));
  const nonManual = allCertificates.filter((c) => !manualSetNoDns.has(String(c.name).toLowerCase()));

  const renewResult = nonManual.length > 0
    ? await renewNonManualCertbotCerts(server, nonManual)
    : await (async () => {
      const renew = await execCertbotRenew(server);
      const out = `${renew.stdout || ''}\n${renew.stderr || ''}`.trim();
      if (renew.code !== 0) {
        return { renewed: false, details: out.slice(-4000), errorCode: renew.code, errorOut: out };
      }
      const renewed = certbotRenewOutputIndicatesSuccess(out);
      await exec(server, 'sudo systemctl reload nginx 2>/dev/null || sudo nginx -s reload 2>/dev/null || true', { allowFailure: true, logLabel: 'nginx_reload_after_renew' });
      return { renewed, details: out.slice(-4000) };
    })();

  if (renewResult.errorCode != null) {
    const tail = (renewResult.errorOut || '').slice(-1800) || `certbot renew exited with code ${renewResult.errorCode}`;
    throw new Error(`Certificate renewal failed.\n\n${tail}`);
  }

  const soonestExpiring = [...allCertificates]
    .filter((c) => c.validDays != null && c.validDays < EXPIRY_SOON_DAYS)
    .sort((a, b) => (a.validDays ?? 999) - (b.validDays ?? 999))[0];

  let message;
  if (renewResult.renewed) {
    message = soonestExpiring
      ? `Certbot renewed ${soonestExpiring.name}. Refresh certs to see the new expiry.`
      : 'Certificate renewal completed.';
  } else if (soonestExpiring) {
    const hint = renewResult.hintMessage ? ` ${renewResult.hintMessage}` : '';
    message = `Certbot could not renew ${soonestExpiring.name} (${soonestExpiring.validDays} days left).${hint || ' See details below.'}`;
  } else {
    message = 'No certificate renewals were required right now.';
  }

  return {
    success: true,
    renewed: renewResult.renewed,
    message,
    details: renewResult.details,
  };
}

const EMPTY_NGINX_PLACEHOLDER = '# No proxy routes';

/**
 * Extract server blocks from nginx config text that match the given domain (server_name).
 * Returns the full server { ... } block(s) as a single string, or null if none match.
 * Handles nested braces (e.g. location { } inside server { }).
 */
function extractServerBlocksForDomain(configText, domain) {
  if (!configText || typeof domain !== 'string') return null;
  const normalizedDomain = domain.replace(/^\*\./, '').trim();
  if (!normalizedDomain) return null;
  const blocks = [];
  let i = 0;
  const s = configText;
  while (i < s.length) {
    const serverStart = s.indexOf('server', i);
    if (serverStart === -1) break;
    const braceStart = s.indexOf('{', serverStart);
    if (braceStart === -1) { i = serverStart + 1; continue; }
    let depth = 1;
    let j = braceStart + 1;
    while (j < s.length && depth > 0) {
      const ch = s[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    const block = s.slice(serverStart, j).trim();
    const serverNameMatch = block.match(/server_name\s+([^;]+);/);
    const names = serverNameMatch ? serverNameMatch[1].split(/\s+/).map((n) => n.trim().replace(/^["']|["']$/g, '')) : [];
    const matches = names.some((n) => {
      const d = n.replace(/^["']|["']$/g, '');
      return d === normalizedDomain || d === domain || d === `*.${normalizedDomain}` || d.endsWith(`.${normalizedDomain}`);
    });
    if (matches) blocks.push(block);
    i = j;
  }
  return blocks.length > 0 ? blocks.join('\n\n') : null;
}

/**
 * Read the current nginx config from the server and return the server block(s) for the given domain.
 * Use this to "import" existing nginx config for a domain into the route's custom nginx block.
 */
async function importNginxBlockForDomain(serverId, userId, domain) {
  const server = await Server.findByPk(serverId);
  if (!server || server.userId !== userId) throw new Error('Server not found');
  const r = await exec(server, `sudo cat ${NGINX_CONF_PATH} 2>/dev/null || true`, { allowFailure: true, timeout: 10000 });
  const config = (r.stdout || '').trim() || null;
  if (!config) return { block: null, error: 'No nginx config found on server' };
  const block = extractServerBlocksForDomain(config, domain);
  return { block: block || null, error: block ? undefined : 'No server block found for this domain' };
}

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
  const externalNginxNames = await getExternalNginxServerNames(server);
  const generatedConfig = buildNginxConfig(routes, certDomains, externalNginxNames);
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
  renewCertificates,
  getNginxConfig,
  importNginxBlockForDomain,
  updateCustomNginxConfig,
  buildNginxConfig,
  buildDefaultRouteBlock,
  getCertDomains,
  enrichProxyRoutesForApi,
};
