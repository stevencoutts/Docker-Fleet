'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('monitoring_settings', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      alert_on_container_down: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      },
      alert_on_container_recovery: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      },
      alert_on_no_auto_restart: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      },
      alert_cooldown_ms: {
        type: Sequelize.INTEGER,
        defaultValue: 43200000, // 12 hours
        allowNull: false,
      },
      no_auto_restart_cooldown_ms: {
        type: Sequelize.INTEGER,
        defaultValue: 43200000, // 12 hours
        allowNull: false,
      },
      min_down_time_before_alert_ms: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
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

    // Create index on user_id for faster lookups
    await queryInterface.addIndex('monitoring_settings', ['user_id'], {
      unique: true,
      name: 'monitoring_settings_user_id_unique',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('monitoring_settings');
  },
};
