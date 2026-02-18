'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('backup_schedules', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      server_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'servers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      container_name: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'Container name (stable identifier; container ID resolved at run time)',
      },
      schedule_type: {
        type: Sequelize.ENUM('interval', 'daily', 'weekly'),
        allowNull: false,
      },
      schedule_config: {
        type: Sequelize.JSONB,
        allowNull: false,
        comment: 'interval: { intervalHours }. daily: { hour, minute } UTC. weekly: { dayOfWeek, hour, minute } UTC',
      },
      retention: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 5,
        comment: 'Keep this many snapshots; older ones are removed',
      },
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      last_run_at: {
        type: Sequelize.DATE,
        allowNull: true,
        field: 'last_run_at',
      },
      next_run_at: {
        type: Sequelize.DATE,
        allowNull: true,
        field: 'next_run_at',
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

    await queryInterface.addIndex('backup_schedules', ['user_id']);
    await queryInterface.addIndex('backup_schedules', ['server_id']);
    await queryInterface.addIndex('backup_schedules', ['next_run_at']);
    await queryInterface.addIndex('backup_schedules', ['enabled']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('backup_schedules');
  },
};
