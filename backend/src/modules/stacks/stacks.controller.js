const { Op } = require('sequelize');
const db = require('../../models');
const { sequelize } = db;
const logger = require('../../config/logger');
const stackService = require('../../services/stack.service');
const { storeValue, maskRows, flagSecret } = require('../../utils/stackEnv');
const { parseEnvFile, rewriteRelativeBindMounts } = require('../../services/stack.builders');
const { validateComposeProjectName, validateStackDeployPath, STACK_DEPLOY_BASE } = require('../../utils/shellSafe');

const { Stack, StackEnvVar, Server } = db;

function serializeStack(stackModel) {
  const s = typeof stackModel.toJSON === 'function' ? stackModel.toJSON() : stackModel;
  const env = maskRows((s.envVars || []).map((e) => ({ key: e.key, value: e.value, isSecret: e.isSecret })));
  return {
    id: s.id, serverId: s.serverId, name: s.name, composeYaml: s.composeYaml,
    deployPath: s.deployPath, source: s.source,
    lastDeployedAt: s.lastDeployedAt, lastDeployStatus: s.lastDeployStatus, env,
  };
}

async function findUserServer(req, serverId) {
  return Server.findOne({ where: { id: serverId, userId: req.user.id } });
}

async function findUserStack(req, stackId) {
  const stack = await Stack.findByPk(stackId, { include: [{ model: StackEnvVar, as: 'envVars' }, { model: Server, as: 'server' }] });
  if (!stack) return null;
  if (stack.server.userId !== req.user.id) return null;
  return stack;
}

async function replaceEnv(stackId, envInput) {
  await StackEnvVar.destroy({ where: { stackId } });
  const rows = (envInput || []).map((e) => ({
    stackId, key: e.key,
    isSecret: !!e.isSecret,
    value: storeValue(e.value ?? '', !!e.isSecret),
  }));
  if (rows.length) await StackEnvVar.bulkCreate(rows);
}

const listStacks = async (req, res, next) => {
  try {
    const servers = await Server.findAll({ where: { userId: req.user.id }, attributes: ['id'] });
    const allowedIds = servers.map((s) => s.id);
    const where = {};
    if (req.query.serverId) {
      if (!allowedIds.includes(req.query.serverId)) return res.json([]);
      where.serverId = req.query.serverId;
    } else {
      where.serverId = { [Op.in]: allowedIds };
    }
    const stacks = await Stack.findAll({ where, include: [{ model: StackEnvVar, as: 'envVars' }] });
    res.json(stacks.map(serializeStack));
  } catch (e) { next(e); }
};

const getStack = async (req, res, next) => {
  try {
    const stack = await findUserStack(req, req.params.id);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    res.json(serializeStack(stack));
  } catch (e) { next(e); }
};

const createStack = async (req, res, next) => {
  try {
    const { serverId, name, composeYaml, env } = req.body;
    const safeName = validateComposeProjectName(name);
    if (typeof composeYaml !== 'string' || !composeYaml.trim()) return res.status(400).json({ error: 'composeYaml is required' });
    const server = await findUserServer(req, serverId);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const deployPath = validateStackDeployPath(`${STACK_DEPLOY_BASE}/${safeName}`);
    const stack = await Stack.create({ serverId, name: safeName, composeYaml, deployPath, source: 'created' });
    await replaceEnv(stack.id, env);
    const full = await findUserStack(req, stack.id);
    res.status(201).json(serializeStack(full));
  } catch (e) { if (e.code === 'INVALID_INPUT') return res.status(400).json({ error: e.message }); next(e); }
};

const updateStack = async (req, res, next) => {
  try {
    const stack = await findUserStack(req, req.params.id);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    const { composeYaml, env } = req.body;
    await sequelize.transaction(async (t) => {
      if (typeof composeYaml === 'string' && composeYaml.trim()) stack.composeYaml = composeYaml;
      await stack.save({ transaction: t });
      if (Array.isArray(env)) {
        // Blank secret value = keep existing
        const existing = await StackEnvVar.findAll({ where: { stackId: stack.id }, transaction: t });
        const byKey = Object.fromEntries(existing.map((e) => [e.key, e]));
        const merged = env.map((e) => {
          const prior = byKey[e.key];
          if (e.isSecret && (e.value === null || e.value === undefined || e.value === '') && prior) {
            if (prior.isSecret) {
              // Existing value is already stored encrypted; keep as-is
              return { key: e.key, isSecret: true, value: prior.value, _stored: true };
            }
            // Var was stored plain and has just been flagged secret: re-encrypt the plain value
            return { key: e.key, isSecret: true, value: prior.value ?? '', _stored: false };
          }
          return { key: e.key, isSecret: !!e.isSecret, value: e.value ?? '', _stored: false };
        });
        await StackEnvVar.destroy({ where: { stackId: stack.id }, transaction: t });
        const rows = merged.map((m) => ({ stackId: stack.id, key: m.key, isSecret: m.isSecret, value: m._stored ? m.value : storeValue(m.value, m.isSecret) }));
        if (rows.length) await StackEnvVar.bulkCreate(rows, { transaction: t });
      }
    });
    const full = await findUserStack(req, stack.id);
    res.json(serializeStack(full));
  } catch (e) { if (e.code === 'INVALID_INPUT') return res.status(400).json({ error: e.message }); next(e); }
};

const deleteStack = async (req, res, next) => {
  try {
    const stack = await findUserStack(req, req.params.id);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    if (req.query.down === 'true') {
      try { await stackService.lifecycle(stack.server, stack, 'down'); } catch (e) { logger.warn('down on delete failed:', e.message); }
    }
    await stack.destroy();
    res.json({ success: true });
  } catch (e) { next(e); }
};

const deployStack = async (req, res, next) => {
  try {
    const stack = await findUserStack(req, req.params.id);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    const plain = stackService.decryptRows(stack.envVars);
    const result = await stackService.deployStack(stack.server, stack, plain, { pull: req.query.pull === 'true' });
    stack.lastDeployedAt = new Date();
    stack.lastDeployStatus = result.success ? 'deployed' : 'error';
    await stack.save();
    res.json(result);
  } catch (e) { next(e); }
};

const lifecycleHandler = (action) => async (req, res, next) => {
  try {
    const stack = await findUserStack(req, req.params.id);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    const result = await stackService.lifecycle(stack.server, stack, action);
    if (action === 'down') { stack.lastDeployStatus = result.success ? 'stopped' : 'error'; await stack.save(); }
    res.json(result);
  } catch (e) { next(e); }
};

const discover = async (req, res, next) => {
  try {
    const server = await findUserServer(req, req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const projects = await stackService.discover(server);
    const managed = await Stack.findAll({ where: { serverId: server.id }, attributes: ['name'] });
    const managedNames = new Set(managed.map((m) => m.name));
    res.json(projects.map((p) => ({ ...p, managed: managedNames.has(p.name) })));
  } catch (e) { next(e); }
};

const importStacks = async (req, res, next) => {
  try {
    const server = await findUserServer(req, req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const { projects } = req.body; // [{ name, configFiles: [...] }]
    if (!Array.isArray(projects) || !projects.length) return res.status(400).json({ error: 'projects[] required' });

    // Re-derive allowed file paths from a server-side discover to prevent arbitrary file disclosure
    const discovered = await stackService.discover(server);
    const discoveredMap = Object.fromEntries(discovered.map((d) => [d.name, d]));

    const results = [];
    for (const p of projects) {
      try {
        // Reject projects not found in the server-side discover
        const discoveredEntry = discoveredMap[p.name];
        if (!discoveredEntry) {
          results.push({ name: p.name, imported: false, error: 'Project not found on host' });
          continue;
        }
        const safeName = validateComposeProjectName(p.name);
        // Use server-discovered configFiles, not client-supplied ones
        const allowedConfigFiles = discoveredEntry.configFiles || [];
        const files = await stackService.readRemoteFiles(server, allowedConfigFiles);
        // Rewrite relative bind mounts to absolute paths (resolved against the
        // original project dir) so deploying from the managed stack directory
        // doesn't detach the project's data.
        const composeYaml = allowedConfigFiles
          .map((f) => {
            const content = files[f];
            if (!content) return null;
            const projectDir = f.replace(/\/[^/]+$/, '');
            return rewriteRelativeBindMounts(content, projectDir);
          })
          .filter(Boolean)
          .join('\n---\n');
        if (!composeYaml) throw new Error('No readable compose file');
        const deployPath = validateStackDeployPath(`${STACK_DEPLOY_BASE}/${safeName}`);
        let stack = await Stack.findOne({ where: { serverId: server.id, name: safeName } });
        let reimported = false;
        if (stack) {
          // Re-import: refresh the stored compose from the host's original files
          await stack.update({ composeYaml, source: 'imported' });
          reimported = true;
        } else {
          stack = await Stack.create({ serverId: server.id, name: safeName, composeYaml, deployPath, source: 'imported' });
        }
        // env: read .env next to first discovered config file if present
        const firstDir = allowedConfigFiles[0] ? allowedConfigFiles[0].replace(/\/[^/]+$/, '') : null;
        if (firstDir) {
          const envFiles = await stackService.readRemoteFiles(server, [`${firstDir}/.env`]);
          const envText = envFiles[`${firstDir}/.env`];
          if (envText) {
            const parsed = parseEnvFile(envText).map((e) => ({ ...e, isSecret: flagSecret(e.key) }));
            await StackEnvVar.destroy({ where: { stackId: stack.id } });
            await StackEnvVar.bulkCreate(parsed.map((e) => ({ stackId: stack.id, key: e.key, isSecret: e.isSecret, value: storeValue(e.value, e.isSecret) })));
          }
        }
        results.push({ name: safeName, imported: true, reimported });
      } catch (err) {
        results.push({ name: p.name, imported: false, error: err.message });
      }
    }
    res.json({ results });
  } catch (e) { next(e); }
};

module.exports = {
  serializeStack,
  listStacks, getStack, createStack, updateStack, deleteStack,
  deployStack, downStack: lifecycleHandler('down'), restartStack: lifecycleHandler('restart'),
  discover, importStacks,
};
