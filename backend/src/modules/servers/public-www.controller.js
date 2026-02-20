const { Server, ServerProxyRoute } = require('../../models');
const publicWwwService = require('../../services/public-www.service');

async function listProxyRoutes(req, res, next) {
  try {
    const { id: serverId } = req.params;
    const server = await Server.findOne({ where: { id: serverId, userId: req.user.id } });
    if (!server) return res.status(404).json({ error: 'Server not found' });

    const routes = await ServerProxyRoute.findAll({ where: { serverId }, order: [['domain', 'ASC']] });
    res.json({ routes });
  } catch (error) {
    next(error);
  }
}

async function addProxyRoute(req, res, next) {
  try {
    const { id: serverId } = req.params;
    const { domain, containerName, containerPort } = req.body;

    const server = await Server.findOne({ where: { id: serverId, userId: req.user.id } });
    if (!server) return res.status(404).json({ error: 'Server not found' });
    if (!domain || !String(domain).trim()) return res.status(400).json({ error: 'domain is required' });
    if (!containerName || !String(containerName).trim()) return res.status(400).json({ error: 'containerName is required' });
    const port = parseInt(containerPort, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: 'containerPort must be 1-65535' });

    const route = await ServerProxyRoute.create({
      serverId,
      domain: String(domain).trim(),
      containerName: String(containerName).trim(),
      containerPort: port,
    });
    res.status(201).json({ route });
  } catch (error) {
    next(error);
  }
}

async function deleteProxyRoute(req, res, next) {
  try {
    const { id: serverId, routeId } = req.params;
    const server = await Server.findOne({ where: { id: serverId, userId: req.user.id } });
    if (!server) return res.status(404).json({ error: 'Server not found' });

    const route = await ServerProxyRoute.findOne({ where: { id: routeId, serverId } });
    if (!route) return res.status(404).json({ error: 'Proxy route not found' });
    await route.destroy();
    res.json({ message: 'Proxy route deleted' });
  } catch (error) {
    next(error);
  }
}

async function enablePublicWww(req, res, next) {
  const { id: serverId } = req.params;
  const stream = req.query.stream === '1' || req.get('Accept')?.includes('text/event-stream');

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      try { res.flush?.(); } catch (e) { /* ignore */ }
    };

    try {
      const result = await publicWwwService.enablePublicWww(serverId, req.user.id, {
        onProgress: (step, message, status) => send({ step, message, status }),
      });
      send({ ...result, step: 'done', status: 'ok' });
    } catch (error) {
      send({ success: false, error: error.message || 'Enable failed', step: 'done', status: 'fail' });
    }
    res.end();
    return;
  }

  try {
    const result = await publicWwwService.enablePublicWww(serverId, req.user.id);
    res.json(result);
  } catch (error) {
    if (error.message === 'Server not found') return res.status(404).json({ error: error.message });
    next(error);
  }
}

async function disablePublicWww(req, res, next) {
  try {
    const { id: serverId } = req.params;
    const result = await publicWwwService.disablePublicWww(serverId, req.user.id);
    res.json(result);
  } catch (error) {
    if (error.message === 'Server not found') return res.status(404).json({ error: error.message });
    next(error);
  }
}

async function syncPublicWww(req, res, next) {
  try {
    const { id: serverId } = req.params;
    const result = await publicWwwService.syncProxy(serverId, req.user.id);
    res.json(result);
  } catch (error) {
    if (error.message === 'Server not found') return res.status(404).json({ error: error.message });
    next(error);
  }
}

async function requestDnsCert(req, res, next) {
  try {
    const { id: serverId } = req.params;
    const { domain, wildcard } = req.body || {};
    const result = await publicWwwService.requestDnsCert(serverId, req.user.id, { domain, wildcard });
    res.json(result);
  } catch (error) {
    if (error.message === 'Server not found') return res.status(404).json({ error: error.message });
    if (error.message === 'domain is required') return res.status(400).json({ error: error.message });
    if (error.message && error.message.includes('already exists and is not due for renewal')) return res.status(409).json({ error: error.message });
    next(error);
  }
}

async function continueDnsCert(req, res, next) {
  try {
    const { id: serverId } = req.params;
    const { domain } = req.body || {};
    const result = await publicWwwService.continueDnsCert(serverId, req.user.id, { domain });
    res.json(result);
  } catch (error) {
    if (error.message === 'Server not found') return res.status(404).json({ error: error.message });
    if (error.message === 'domain is required') return res.status(400).json({ error: error.message });
    next(error);
  }
}

async function listCertificates(req, res, next) {
  try {
    const { id: serverId } = req.params;
    const result = await publicWwwService.listCertificates(serverId, req.user.id);
    res.json(result);
  } catch (error) {
    if (error.message === 'Server not found') return res.status(404).json({ error: error.message });
    next(error);
  }
}

async function getNginxConfig(req, res, next) {
  try {
    const { id: serverId } = req.params;
    const result = await publicWwwService.getNginxConfig(serverId, req.user.id);
    res.json(result);
  } catch (error) {
    if (error.message === 'Server not found') return res.status(404).json({ error: error.message });
    next(error);
  }
}

module.exports = {
  listProxyRoutes,
  addProxyRoute,
  deleteProxyRoute,
  enablePublicWww,
  disablePublicWww,
  syncPublicWww,
  requestDnsCert,
  continueDnsCert,
  listCertificates,
  getNginxConfig,
};
