const { DataTypes } = require('sequelize');
const { encrypt, decrypt } = require('../utils/encryption');

module.exports = (sequelize) => {
  const Server = sequelize.define(
    'Server',
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
        references: {
          model: 'users',
          key: 'id',
        },
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      host: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          isIP: {
            msg: 'Host must be a valid IP address or hostname',
          },
        },
      },
      port: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 22,
        validate: {
          min: 1,
          max: 65535,
        },
      },
      username: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      privateKeyEncrypted: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'private_key_encrypted',
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
      tableName: 'servers',
      timestamps: true,
      hooks: {
        beforeCreate: async (server) => {
          if (server.privateKeyEncrypted && typeof server.privateKeyEncrypted === 'string') {
            server.privateKeyEncrypted = encrypt(server.privateKeyEncrypted);
          }
        },
        beforeUpdate: async (server) => {
          if (server.changed('privateKeyEncrypted') && typeof server.privateKeyEncrypted === 'string') {
            server.privateKeyEncrypted = encrypt(server.privateKeyEncrypted);
          }
        },
      },
    }
  );

  Server.prototype.getDecryptedKey = function () {
    return decrypt(this.privateKeyEncrypted);
  };

  return Server;
};
