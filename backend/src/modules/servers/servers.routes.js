const express = require('express');
const router = express.Router();
const {
  getAllServers,
  getServerById,
  createServer,
  updateServer,
  deleteServer,
  testConnection,
  tailscaleEnable,
  tailscaleDisable,
  tailscaleStatus,
  createServerValidation,
  updateServerValidation,
} = require('./servers.controller');
const { getHostInfo } = require('./system.controller');
const {
  listProxyRoutes,
  addProxyRoute,
  updateProxyRoute,
  deleteProxyRoute,
  enablePublicWww,
  disablePublicWww,
  syncPublicWww,
  requestDnsCert,
  continueDnsCert,
  listCertificates,
  getNginxConfig,
  getImportNginxBlock,
  updateCustomNginxConfig,
} = require('./public-www.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validation.middleware');

router.use(authenticate);

router.get('/', getAllServers);
router.get('/:id/host-info', getHostInfo);
router.get('/:id/proxy-routes', listProxyRoutes);
router.post('/:id/proxy-routes', addProxyRoute);
router.patch('/:id/proxy-routes/:routeId', updateProxyRoute);
router.delete('/:id/proxy-routes/:routeId', deleteProxyRoute);
router.post('/:id/public-www/enable', enablePublicWww);
router.post('/:id/public-www/disable', disablePublicWww);
router.post('/:id/public-www/sync', syncPublicWww);
router.get('/:id/public-www/certificates', listCertificates);
router.get('/:id/public-www/nginx-config', getNginxConfig);
router.get('/:id/public-www/nginx-import', getImportNginxBlock);
router.put('/:id/public-www/custom-nginx-config', updateCustomNginxConfig);
router.post('/:id/public-www/request-dns-cert', requestDnsCert);
router.post('/:id/public-www/continue-dns-cert', continueDnsCert);
router.post('/:id/tailscale/enable', tailscaleEnable);
router.post('/:id/tailscale/disable', tailscaleDisable);
router.get('/:id/tailscale/status', tailscaleStatus);
router.get('/:id', getServerById);
router.post('/', createServerValidation, validate, createServer);
router.put('/:id', updateServerValidation, validate, updateServer);
router.delete('/:id', deleteServer);
router.post('/:id/test', testConnection);

module.exports = router;
