const express = require('express');
const router = express.Router();
const {
  getImages,
  pullImage,
  removeImage,
} = require('./images.controller');
const { authenticate } = require('../../middleware/auth.middleware');

router.use(authenticate);

router.get('/:serverId/images', getImages);
router.post('/:serverId/images/pull', pullImage);
router.delete('/:serverId/images/:imageId', removeImage);

module.exports = router;
