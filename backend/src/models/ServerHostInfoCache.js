const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ServerHostInfoCache = sequelize.define(
    'ServerHostInfoCache',
    {
      serverId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'server_id',
        primaryKey: true,
        references: { model: 'servers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      hostInfo: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'host_info',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'updated_at',
      },
    },
    { tableName: 'server_host_info_cache', timestamps: false }
  );

  return ServerHostInfoCache;
};
