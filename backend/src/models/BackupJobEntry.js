const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BackupJobEntry = sequelize.define(
    'BackupJobEntry',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      backupJobId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'backup_job_id',
        references: { model: 'backup_jobs', key: 'id' },
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
    { tableName: 'backup_job_entries', timestamps: true }
  );

  return BackupJobEntry;
};
