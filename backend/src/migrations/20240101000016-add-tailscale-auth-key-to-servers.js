'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('servers', 'tailscale_auth_key_encrypted', {
      type: Sequelize.JSON,
      allowNull: true,
    });
    await queryInterface.addColumn('servers', 'tailscale_auth_key_expires_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('servers', 'tailscale_auth_key_encrypted');
    await queryInterface.removeColumn('servers', 'tailscale_auth_key_expires_at');
  },
};
