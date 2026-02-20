'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('servers', 'ssh_allowed_ips', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Comma-separated IPs allowed to connect to SSH (port 22); empty = allow all',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('servers', 'ssh_allowed_ips');
  },
};
