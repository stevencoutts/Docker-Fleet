'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('servers', 'custom_nginx_config', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Optional custom nginx config; when set, Sync uses this instead of generated config',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('servers', 'custom_nginx_config');
  },
};
