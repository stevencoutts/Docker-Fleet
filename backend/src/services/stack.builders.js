const {
  validateComposeProjectName,
  validateStackDeployPath,
  escapeSingleQuoted,
} = require('../utils/shellSafe');

function buildComposeCommand({ name, deployPath, action, pull }) {
  const safeName = validateComposeProjectName(name);
  const safePath = validateStackDeployPath(deployPath);
  const base = `docker compose -p ${escapeSingleQuoted(safeName)} --env-file .env -f compose.yaml`;
  let op;
  if (action === 'up') op = pull ? `${base} pull && ${base} up -d` : `${base} up -d`;
  else if (action === 'down') op = `${base} down`;
  else if (action === 'restart') op = `${base} restart`;
  else throw new Error(`Invalid compose action: ${action}`);
  return `cd ${escapeSingleQuoted(safePath)} && DOCKER_API_VERSION=1.41 ${op}`;
}

function buildWriteFileCommand(deployPath, filename, content) {
  const safePath = validateStackDeployPath(deployPath);
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

module.exports = { buildComposeCommand, buildWriteFileCommand, parseComposeLs, parseEnvFile };
