// Singleton to store Socket.IO instance
let ioInstance = null;

module.exports = {
  setIO: (io) => {
    ioInstance = io;
  },
  getIO: () => {
    return ioInstance;
  },
};
