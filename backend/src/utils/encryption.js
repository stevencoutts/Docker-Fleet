const crypto = require('crypto');
const config = require('../config/config');

const algorithm = config.encryption.algorithm;
const LEGACY_SALT = 'salt';

function deriveKey(salt) {
  return crypto.scryptSync(config.encryption.key, salt, 32);
}

function encrypt(text) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = deriveKey(salt);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted,
    authTag: authTag.toString('hex'),
    salt,
  };
}

function decrypt(encryptedObject) {
  const { iv, encryptedData, authTag, salt } = encryptedObject;
  const effectiveSalt = typeof salt === 'string' && salt.length > 0 ? salt : LEGACY_SALT;
  const key = deriveKey(effectiveSalt);

  const decipher = crypto.createDecipheriv(
    algorithm,
    key,
    Buffer.from(iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
};
