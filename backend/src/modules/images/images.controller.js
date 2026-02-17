const { Server } = require('../../models');
const dockerService = require('../../services/docker.service');

const getImages = async (req, res, next) => {
  try {
    const { serverId } = req.params;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const images = await dockerService.listImages(server);
    res.json({ images });
  } catch (error) {
    next(error);
  }
};

const pullImage = async (req, res, next) => {
  try {
    const { serverId } = req.params;
    const { imageName } = req.body;

    if (!imageName) {
      return res.status(400).json({ error: 'Image name is required' });
    }

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.pullImage(server, imageName);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const removeImage = async (req, res, next) => {
  try {
    const { serverId, imageId } = req.params;
    const { force = 'false' } = req.query;

    const server = await Server.findOne({
      where: { id: serverId, userId: req.user.id },
    });

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await dockerService.removeImage(server, imageId, force === 'true');
    res.json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getImages,
  pullImage,
  removeImage,
};
