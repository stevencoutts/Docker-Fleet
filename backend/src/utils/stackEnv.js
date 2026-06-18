const { encrypt, decrypt } = require('./encryption');

const SECRET_KEY_REGEX = /(PASSWORD|SECRET|TOKEN|KEY|PASS|API)/i;

function flagSecret(key) {
  return SECRET_KEY_REGEX.test(String(key || ''));
}

function storeValue(plain, isSecret) {
  if (!isSecret) return String(plain ?? '');
  return JSON.stringify(encrypt(String(plain ?? '')));
}

function readValue(stored, isSecret) {
  if (!isSecret) return String(stored ?? '');
  return decrypt(JSON.parse(stored));
}

function renderEnvFile(rows) {
  return rows.map((r) => `${r.key}=${r.value}`).join('\n') + (rows.length ? '\n' : '');
}

function maskRows(rows) {
  return rows.map((r) => ({
    key: r.key,
    value: r.isSecret ? null : r.value,
    isSecret: !!r.isSecret,
  }));
}

module.exports = { storeValue, readValue, flagSecret, renderEnvFile, maskRows };
