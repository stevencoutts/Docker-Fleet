'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('servers', 'public_host', {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: 'Public IP or hostname this server is reached from (for display on dashboard)',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('servers', 'public_host');
  },
};
