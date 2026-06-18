const sshService = require('./ssh.service');
const logger = require('../config/logger');
const { buildComposeCommand, buildWriteFileCommand, parseComposeLs } = require('./stack.builders');
const { renderEnvFile, readValue } = require('../utils/stackEnv');
const { escapeSingleQuoted } = require('../utils/shellSafe');

function decryptRows(envVarModels) {
  return (envVarModels || []).map((e) => ({ key: e.key, value: readValue(e.value, e.isSecret) }));
}

async function deployStack(server, stack, plainEnvRows, { pull } = {}) {
  const composeCmd = buildWriteFileCommand(stack.deployPath, 'compose.yaml', stack.composeYaml);
  await sshService.executeCommand(server, composeCmd, { timeout: 60000 });

  const envContent = renderEnvFile(plainEnvRows || []);
  const envCmd = buildWriteFileCommand(stack.deployPath, '.env', envContent);
  await sshService.executeCommand(server, envCmd, { timeout: 60000 });

  const upCmd = buildComposeCommand({ name: stack.name, deployPath: stack.deployPath, action: 'up', pull });
  const result = await sshService.executeCommand(server, upCmd, { timeout: 600000, allowFailure: true });
  const out = `${result.stdout || ''}\n${result.stderr || ''}`;
  const success = result.code === 0 || /Container\s+\S+\s+(Started|Running|Created)/i.test(out);
  return { success, code: result.code, stdout: result.stdout || '', stderr: result.stderr || '' };
}

async function lifecycle(server, stack, action) {
  const cmd = buildComposeCommand({ name: stack.name, deployPath: stack.deployPath, action });
  const result = await sshService.executeCommand(server, cmd, { timeout: 300000, allowFailure: true });
  return { success: result.code === 0, code: result.code, stdout: result.stdout || '', stderr: result.stderr || '' };
}

async function discover(server) {
  const result = await sshService.executeCommand(
    server,
    'DOCKER_API_VERSION=1.41 docker compose ls --all --format json',
    { timeout: 60000, allowFailure: true }
  );
  if (result.code !== 0) {
    logger.warn(`discover: compose ls failed on ${server.host}: ${result.stderr}`);
    return [];
  }
  return parseComposeLs(result.stdout).map((p) => ({ ...p, managed: false }));
}

async function readRemoteFiles(server, paths) {
  const out = {};
  for (const p of paths) {
    const result = await sshService.executeCommand(server, `cat ${escapeSingleQuoted(p)}`, { timeout: 30000, allowFailure: true });
    out[p] = result.code === 0 ? result.stdout : null;
  }
  return out;
}

module.exports = { deployStack, lifecycle, discover, readRemoteFiles, decryptRows };
