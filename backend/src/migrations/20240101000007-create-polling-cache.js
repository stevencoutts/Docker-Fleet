'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('server_container_cache', {
      server_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'servers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      container_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'Docker container ID (short or full)',
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false,
        comment: 'Container list item: ID, Names, Image, Status, Ports, RestartPolicy, Mounts, Networks, SkipUpdate',
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex('server_container_cache', ['server_id']);
    await queryInterface.addConstraint('server_container_cache', {
      fields: ['server_id', 'container_id'],
      type: 'primary key',
      name: 'server_container_cache_pkey',
    });

    await queryInterface.createTable('server_host_info_cache', {
      server_id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: 'servers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      host_info: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('server_container_cache');
    await queryInterface.dropTable('server_host_info_cache');
  },
};
