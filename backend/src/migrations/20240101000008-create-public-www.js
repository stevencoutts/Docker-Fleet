'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('servers', 'public_www_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.createTable('server_proxy_routes', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      server_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'servers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      domain: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'Public domain (e.g. app.example.com)',
      },
      container_name: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'Container name on the host',
      },
      container_port: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: 'Container port to proxy to (e.g. 8080)',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex('server_proxy_routes', ['server_id']);
    await queryInterface.addIndex('server_proxy_routes', ['domain'], { unique: false });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('server_proxy_routes');
    await queryInterface.removeColumn('servers', 'public_www_enabled');
  },
};
