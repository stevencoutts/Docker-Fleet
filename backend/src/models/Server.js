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
          // Accept both IP addresses and DNS names
          // Basic validation: not empty and reasonable length
          notEmpty: {
            msg: 'Host is required',
          },
          len: {
            args: [1, 255],
            msg: 'Host must be between 1 and 255 characters',
          },
          // Custom validator to check if it's a valid IP or hostname
          isValidHost(value) {
            if (!value || typeof value !== 'string') {
              throw new Error('Host must be a valid IP address or hostname');
            }
            const trimmed = value.trim();
            if (trimmed.length === 0) {
              throw new Error('Host cannot be empty');
            }
            // Allow IP addresses (IPv4 or IPv6) or hostnames
            // Hostnames can contain letters, numbers, dots, hyphens, and underscores
            const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
            const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;
            const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-_.]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-_.]{0,61}[a-zA-Z0-9])?)*$/;
            
            if (!ipv4Regex.test(trimmed) && !ipv6Regex.test(trimmed) && !hostnameRegex.test(trimmed)) {
              throw new Error('Host must be a valid IP address or hostname');
            }
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
      publicWwwEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'public_www_enabled',
      },
      sshAllowedIps: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'ssh_allowed_ips',
      },
      customNginxConfig: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'custom_nginx_config',
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
