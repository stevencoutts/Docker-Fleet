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
      publicHost: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'public_host',
      },
      tailscaleEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'tailscale_enabled',
      },
      tailscaleIp: {
        type: DataTypes.STRING(45),
        allowNull: true,
        field: 'tailscale_ip',
      },
      tailscaleAuthKeyEncrypted: {
        type: DataTypes.JSON,
        allowNull: true,
        field: 'tailscale_auth_key_encrypted',
      },
      tailscaleAuthKeyExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'tailscale_auth_key_expires_at',
      },
      tailscaleAcceptRoutes: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'tailscale_accept_routes',
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

  /**
   * Returns the decrypted Tailscale auth key if stored and not expired (90-day storage).
   * Returns null if not set or expired.
   */
  Server.prototype.getDecryptedTailscaleAuthKey = function () {
    if (!this.tailscaleAuthKeyEncrypted || !this.tailscaleAuthKeyExpiresAt) return null;
    if (new Date(this.tailscaleAuthKeyExpiresAt) <= new Date()) return null;
    return decrypt(this.tailscaleAuthKeyEncrypted);
  };

  /**
   * Host to use for SSH/management. When Tailscale is enabled and tailscaleIp is set,
   * returns the Tailscale IP; otherwise returns the configured host.
   */
  Server.prototype.getEffectiveHost = function () {
    if (this.tailscaleEnabled && this.tailscaleIp) {
      return this.tailscaleIp;
    }
    return this.host;
  };

  return Server;
};
