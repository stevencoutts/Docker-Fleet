const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BackupSchedule = sequelize.define(
    'BackupSchedule',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      serverId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'server_id',
        references: { model: 'servers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      containerName: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'container_name',
      },
      scheduleType: {
        type: DataTypes.ENUM('interval', 'daily', 'weekly'),
        allowNull: false,
        field: 'schedule_type',
      },
      scheduleConfig: {
        type: DataTypes.JSONB,
        allowNull: false,
        field: 'schedule_config',
      },
      retention: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      lastRunAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_run_at',
      },
      nextRunAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'next_run_at',
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
    { tableName: 'backup_schedules', timestamps: true }
  );

  return BackupSchedule;
};
