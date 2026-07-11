const path = require('path');
const {
  validateComposeProjectName,
  validateStackDeployPath,
  escapeSingleQuoted,
  throwInvalid,
} = require('../utils/shellSafe');

function buildComposeCommand({ name, deployPath, action, pull }) {
  const safeName = validateComposeProjectName(name);
  const safePath = validateStackDeployPath(deployPath);
  const base = `docker compose -p ${escapeSingleQuoted(safeName)} --env-file .env -f compose.yaml`;
  let op;
  // Pull is best-effort: locally built images (and services with build: config)
  // cannot be pulled from a registry, so pull failures must not block the up.
  if (action === 'up') op = pull ? `(${base} pull --ignore-pull-failures || true) && ${base} up -d` : `${base} up -d`;
  else if (action === 'down') op = `${base} down`;
  else if (action === 'restart') op = `${base} restart`;
  else throw new Error(`Invalid compose action: ${action}`);
  return `cd ${escapeSingleQuoted(safePath)} && export DOCKER_API_VERSION=1.41 && ${op}`;
}

function buildWriteFileCommand(deployPath, filename, content) {
  const safePath = validateStackDeployPath(deployPath);

  // Validate filename: must be a simple basename (no path separators, no traversal)
  if (typeof filename !== 'string' || !filename.trim()) {
    throwInvalid('Filename is required', filename);
  }
  if (filename === '.' || filename === '..') {
    throwInvalid('Invalid filename: cannot be . or ..', filename);
  }
  if (filename.includes('/')) {
    throwInvalid('Invalid filename: must not contain path separators', filename);
  }
  if (!/^[a-zA-Z0-9_.][a-zA-Z0-9_.\-]*$/.test(filename)) {
    throwInvalid('Invalid filename: must match [a-zA-Z0-9_.][a-zA-Z0-9_.\\-]*', filename);
  }

  const b64 = Buffer.from(String(content), 'utf8').toString('base64');
  const target = `${safePath}/${filename}`;
  return `mkdir -p ${escapeSingleQuoted(safePath)} && printf '%s' ${escapeSingleQuoted(b64)} | base64 -d > ${escapeSingleQuoted(target)}`;
}

function parseComposeLs(jsonText) {
  let arr;
  try {
    arr = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => ({
    name: p.Name,
    status: p.Status || '',
    configFiles: String(p.ConfigFiles || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }));
}

// "- ./data:/app/data:ro" (short volume syntax, relative bind, unquoted)
const VOLUME_ITEM_RELATIVE = /^(\s*-\s+)(\.{1,2}(?:\/[^:]*)?)(:.+)$/;
// "- './cfg:/cfg'" or '- ".:/workdir"' (quote wraps the whole src:dst value)
const VOLUME_ITEM_RELATIVE_QUOTED = /^(\s*-\s*)(['"])(\.{1,2}(?:\/[^:]*)?)(:.*?)\2(\s*)$/;
// "source: ./data" (long volume/config/secret syntax, relative path)
const LONG_SOURCE_RELATIVE = /^(\s*source:\s*)(['"]?)(\.{1,2}(?:\/[^'"\s]*)?)\2(\s*(?:#.*)?)$/;

/**
 * Rewrite relative bind-mount paths (./x, ../x) in compose YAML to absolute
 * paths resolved against the original project directory.
 *
 * Imported stacks deploy from /opt/dockerfleet/stacks/<name>/, so a relative
 * bind would silently point at a fresh empty directory instead of the
 * project's data. Line-based rewrite preserves the file's formatting.
 */
function rewriteRelativeBindMounts(yamlText, projectDir) {
  const text = String(yamlText || '');
  const dir = String(projectDir || '').replace(/\/+$/, '');
  if (!dir.startsWith('/')) return text;
  return text
    .split('\n')
    .map((line) => {
      let m = line.match(VOLUME_ITEM_RELATIVE);
      if (m) {
        const abs = path.posix.resolve(dir, m[2]);
        return `${m[1]}${abs}${m[3]}`;
      }
      m = line.match(VOLUME_ITEM_RELATIVE_QUOTED);
      if (m) {
        const abs = path.posix.resolve(dir, m[3]);
        return `${m[1]}${m[2]}${abs}${m[4]}${m[2]}${m[5]}`;
      }
      m = line.match(LONG_SOURCE_RELATIVE);
      if (m) {
        const abs = path.posix.resolve(dir, m[3]);
        return `${m[1]}${m[2]}${abs}${m[2]}${m[4]}`;
      }
      return line;
    })
    .join('\n');
}

function parseEnvFile(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=');
      return { key: l.slice(0, idx).trim(), value: l.slice(idx + 1) };
    });
}

module.exports = { buildComposeCommand, buildWriteFileCommand, parseComposeLs, parseEnvFile, rewriteRelativeBindMounts };
