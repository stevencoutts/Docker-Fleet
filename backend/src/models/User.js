const { DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const { decrypt } = require('../utils/encryption');

module.exports = (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      passwordHash: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'password_hash',
      },
      role: {
        type: DataTypes.ENUM('admin', 'user'),
        defaultValue: 'user',
        allowNull: false,
      },
      letsEncryptEmail: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'lets_encrypt_email',
        validate: { isEmail: true },
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
      tableName: 'users',
      timestamps: true,
      hooks: {
        beforeCreate: async (user) => {
          if (user.passwordHash && !user.passwordHash.startsWith('$2')) {
            user.passwordHash = await bcrypt.hash(user.passwordHash, 10);
          }
        },
        beforeUpdate: async (user) => {
          if (user.changed('passwordHash') && !user.passwordHash.startsWith('$2')) {
            user.passwordHash = await bcrypt.hash(user.passwordHash, 10);
          }
        },
      },
    }
  );

  User.prototype.comparePassword = async function (password) {
    return bcrypt.compare(password, this.passwordHash);
  };

  /** Returns decrypted Tailscale auth key if stored and not expired; null otherwise. Used to enable Tailscale on any server. */
  User.prototype.getDecryptedTailscaleAuthKey = function () {
    if (!this.tailscaleAuthKeyEncrypted || !this.tailscaleAuthKeyExpiresAt) return null;
    if (new Date(this.tailscaleAuthKeyExpiresAt) <= new Date()) return null;
    return decrypt(this.tailscaleAuthKeyEncrypted);
  };

  User.prototype.toJSON = function () {
    const values = { ...this.get() };
    delete values.passwordHash;
    delete values.tailscaleAuthKeyEncrypted;
    return values;
  };

  return User;
};
