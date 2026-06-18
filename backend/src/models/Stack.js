const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Stack = sequelize.define(
    'Stack',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      serverId: {
        type: DataTypes.UUID, allowNull: false, field: 'server_id',
        references: { model: 'servers', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      name: { type: DataTypes.STRING, allowNull: false },
      composeYaml: { type: DataTypes.TEXT, allowNull: false, field: 'compose_yaml' },
      deployPath: { type: DataTypes.STRING(512), allowNull: false, field: 'deploy_path' },
      source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'created' },
      lastDeployedAt: { type: DataTypes.DATE, allowNull: true, field: 'last_deployed_at' },
      lastDeployStatus: { type: DataTypes.STRING, allowNull: true, field: 'last_deploy_status' },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
    },
    { tableName: 'stacks', timestamps: true, indexes: [{ unique: true, fields: ['server_id', 'name'] }] }
  );
  return Stack;
};
