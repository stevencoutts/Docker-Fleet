const express = require('express');
const router = express.Router();
const {
  getAllServers,
  getServerById,
  createServer,
  updateServer,
  deleteServer,
  testConnection,
  serverValidation,
} = require('./servers.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validation.middleware');

router.use(authenticate);

router.get('/', getAllServers);
router.get('/:id', getServerById);
router.post('/', serverValidation, validate, createServer);
router.put('/:id', serverValidation, validate, updateServer);
router.delete('/:id', deleteServer);
router.post('/:id/test', testConnection);

module.exports = router;
