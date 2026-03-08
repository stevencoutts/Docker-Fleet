'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      'monitoring_settings',
      'alert_on_update_available',
      {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      }
    );
    await queryInterface.addColumn(
      'monitoring_settings',
      'update_alert_cooldown_ms',
      {
        type: Sequelize.INTEGER,
        defaultValue: 43200000, // 12 hours
        allowNull: false,
      }
    );
    await queryInterface.addColumn(
      'monitoring_settings',
      'min_containers_with_updates_before_alert',
      {
        type: Sequelize.INTEGER,
        defaultValue: 1,
        allowNull: false,
      }
    );
    await queryInterface.addColumn(
      'monitoring_settings',
      'last_update_alert_sent_at',
      {
        type: Sequelize.DATE,
        allowNull: true,
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('monitoring_settings', 'alert_on_update_available');
    await queryInterface.removeColumn('monitoring_settings', 'update_alert_cooldown_ms');
    await queryInterface.removeColumn('monitoring_settings', 'min_containers_with_updates_before_alert');
    await queryInterface.removeColumn('monitoring_settings', 'last_update_alert_sent_at');
  },
};
