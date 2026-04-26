'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('server_certificate_cache', {
      server_id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: 'servers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Cached certificate list payload from publicWwwService.listCertificates',
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex('server_certificate_cache', ['server_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('server_certificate_cache');
  },
};

