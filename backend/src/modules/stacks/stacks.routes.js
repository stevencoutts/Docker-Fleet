const express = require('express');
const router = express.Router();
const { authorize } = require('../../middleware/auth.middleware');
const c = require('./stacks.controller');

router.get('/', c.listStacks);
router.post('/', authorize('admin'), c.createStack);
router.get('/:id', c.getStack);
router.put('/:id', authorize('admin'), c.updateStack);
router.delete('/:id', authorize('admin'), c.deleteStack);
router.post('/:id/deploy', authorize('admin'), c.deployStack);
router.post('/:id/down', authorize('admin'), c.downStack);
router.post('/:id/restart', authorize('admin'), c.restartStack);

module.exports = router;
