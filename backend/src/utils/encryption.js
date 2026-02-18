const crypto = require('crypto');
const config = require('../config/config');

const algorithm = config.encryption.algorithm;
// Note: Changing this salt would break decryption of existing encrypted data
// If you need to change it, you would need to re-encrypt all existing private keys
const key = crypto.scryptSync(config.encryption.key, 'salt', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted,
    authTag: authTag.toString('hex'),
  };
}

function decrypt(encryptedObject) {
  const { iv, encryptedData, authTag } = encryptedObject;
  
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
