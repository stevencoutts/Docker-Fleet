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
const { authenticate } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validation.middleware');

router.use(authenticate);

router.get('/', getAllServers);
router.get('/:id/host-info', getHostInfo); // Must be before /:id route
router.get('/:id', getServerById);
router.post('/', createServerValidation, validate, createServer);
router.put('/:id', updateServerValidation, validate, updateServer);
router.delete('/:id', deleteServer);
router.post('/:id/test', testConnection);

module.exports = router;
