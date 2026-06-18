const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const StackEnvVar = sequelize.define(
    'StackEnvVar',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      stackId: {
        type: DataTypes.UUID, allowNull: false, field: 'stack_id',
        references: { model: 'stacks', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      key: { type: DataTypes.STRING, allowNull: false },
      value: { type: DataTypes.TEXT, allowNull: true },
      isSecret: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_secret' },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
    },
    { tableName: 'stack_env_vars', timestamps: true, indexes: [{ unique: true, fields: ['stack_id', 'key'] }] }
  );
  return StackEnvVar;
};
