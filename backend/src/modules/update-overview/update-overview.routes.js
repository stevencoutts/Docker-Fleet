const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { getUpdateOverview, runUpdateCheck, removeContainerFromOverview } = require('./update-overview.controller');

router.use(authenticate);

router.get('/', getUpdateOverview);
router.post('/check', runUpdateCheck);
router.patch('/remove-container', removeContainerFromOverview);

module.exports = router;
