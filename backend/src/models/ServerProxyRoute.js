const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ServerProxyRoute = sequelize.define(
    'ServerProxyRoute',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      serverId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'server_id',
        references: { model: 'servers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      domain: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      containerName: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'container_name',
      },
      containerPort: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'container_port',
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
    { tableName: 'server_proxy_routes', timestamps: true }
  );

  return ServerProxyRoute;
};
