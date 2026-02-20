const express = require('express');
const router = express.Router();
const {
  getAllServers,
  getServerById,
  createServer,
  updateServer,
  deleteServer,
  testConnection,
  createServerValidation,
  updateServerValidation,
} = require('./servers.controller');
const { getHostInfo } = require('./system.controller');
const {
  listProxyRoutes,
  addProxyRoute,
  deleteProxyRoute,
  enablePublicWww,
  disablePublicWww,
  syncPublicWww,
  requestDnsCert,
  continueDnsCert,
} = require('./public-www.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validation.middleware');

router.use(authenticate);

router.get('/', getAllServers);
router.get('/:id/host-info', getHostInfo);
router.get('/:id/proxy-routes', listProxyRoutes);
router.post('/:id/proxy-routes', addProxyRoute);
router.delete('/:id/proxy-routes/:routeId', deleteProxyRoute);
router.post('/:id/public-www/enable', enablePublicWww);
router.post('/:id/public-www/disable', disablePublicWww);
router.post('/:id/public-www/sync', syncPublicWww);
router.post('/:id/public-www/request-dns-cert', requestDnsCert);
router.post('/:id/public-www/continue-dns-cert', continueDnsCert);
router.get('/:id', getServerById);
router.post('/', createServerValidation, validate, createServer);
router.put('/:id', updateServerValidation, validate, updateServer);
router.delete('/:id', deleteServer);
router.post('/:id/test', testConnection);

module.exports = router;
