'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('servers', 'tailscale_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('servers', 'tailscale_ip', {
      type: Sequelize.STRING(45),
      allowNull: true,
      comment: 'Tailscale IPv4 used for management when tailscale_enabled is true',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('servers', 'tailscale_enabled');
    await queryInterface.removeColumn('servers', 'tailscale_ip');
  },
};
