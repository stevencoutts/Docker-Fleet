const express = require('express');
const router = express.Router();
const { exportData, importData } = require('./backup.controller');
const { authenticate } = require('../../middleware/auth.middleware');

router.use(authenticate);

router.get('/export', exportData);
router.post('/import', importData);

module.exports = router;
