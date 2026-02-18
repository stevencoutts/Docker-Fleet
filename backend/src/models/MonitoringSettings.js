const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const MonitoringSettings = sequelize.define(
    'MonitoringSettings',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        field: 'user_id',
        references: {
          model: 'users',
          key: 'id',
        },
      },
      // Alert toggles
      alertOnContainerDown: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        field: 'alert_on_container_down',
      },
      alertOnContainerRecovery: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        field: 'alert_on_container_recovery',
      },
      alertOnNoAutoRestart: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        field: 'alert_on_no_auto_restart',
      },
      // Cooldown periods (in milliseconds)
      alertCooldownMs: {
        type: DataTypes.INTEGER,
        defaultValue: 43200000, // 12 hours
        allowNull: false,
        field: 'alert_cooldown_ms',
        validate: {
          min: 0,
        },
      },
      noAutoRestartCooldownMs: {
        type: DataTypes.INTEGER,
        defaultValue: 43200000, // 12 hours
        allowNull: false,
        field: 'no_auto_restart_cooldown_ms',
        validate: {
          min: 0,
        },
      },
      // Thresholds
      minDownTimeBeforeAlertMs: {
        type: DataTypes.INTEGER,
        defaultValue: 0, // Alert immediately
        allowNull: false,
        field: 'min_down_time_before_alert_ms',
        validate: {
          min: 0,
        },
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    {
      tableName: 'monitoring_settings',
      timestamps: true,
    }
  );

  return MonitoringSettings;
};
