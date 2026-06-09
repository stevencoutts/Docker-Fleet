'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('server_proxy_routes', 'static_root', {
      type: Sequelize.STRING(512),
      allowNull: true,
      comment: 'Optional host path (e.g. /var/www) for static site; /xrpc/ and /.well-known/ still proxy to container',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('server_proxy_routes', 'static_root');
  },
};
