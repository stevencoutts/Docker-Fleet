const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ServerCertificateCache = sequelize.define(
    'ServerCertificateCache',
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
      payload: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Cached certificate list payload from publicWwwService.listCertificates',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'updated_at',
      },
    },
    { tableName: 'server_certificate_cache', timestamps: false }
  );

  return ServerCertificateCache;
};

