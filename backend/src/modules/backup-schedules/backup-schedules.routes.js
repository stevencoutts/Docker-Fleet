const express = require('express');
const router = express.Router();
const { listJobs, createJob, updateJob, deleteJob } = require('./backup-schedules.controller');
const { authenticate } = require('../../middleware/auth.middleware');

router.use(authenticate);

router.get('/', listJobs);
router.post('/bulk', createJob);
router.put('/:jobId', updateJob);
router.delete('/:jobId', deleteJob);

module.exports = router;
