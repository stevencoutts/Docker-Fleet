const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const UpdateOverviewCache = sequelize.define(
    'UpdateOverviewCache',
    {
      userId: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        field: 'user_id',
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      payload: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    {
      tableName: 'update_overview_cache',
      timestamps: false,
    }
  );
  return UpdateOverviewCache;
};
