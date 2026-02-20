const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ServerContainerCache = sequelize.define(
    'ServerContainerCache',
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
      containerId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'container_id',
        primaryKey: true,
      },
      payload: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'updated_at',
      },
    },
    { tableName: 'server_container_cache', timestamps: false }
  );

  return ServerContainerCache;
};
