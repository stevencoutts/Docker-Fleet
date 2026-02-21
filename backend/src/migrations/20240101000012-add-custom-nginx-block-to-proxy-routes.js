'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('server_proxy_routes', 'custom_nginx_block', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Optional custom nginx server block(s) for this domain; if set, used instead of generated block',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('server_proxy_routes', 'custom_nginx_block');
  },
};
