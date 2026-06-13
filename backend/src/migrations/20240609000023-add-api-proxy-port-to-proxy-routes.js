'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('server_proxy_routes', 'api_proxy_port', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'Optional host port for /xrpc/ and /.well-known/ (e.g. Bluesky PDS on 6010 while / proxies elsewhere)',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('server_proxy_routes', 'api_proxy_port');
  },
};
