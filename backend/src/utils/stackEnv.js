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
  try {
    return decrypt(JSON.parse(stored));
  } catch (e) {
    // Legacy or mis-flagged rows can hold a plain-text value while marked secret
    // (e.g. a var toggled to secret without re-entering the value). Treat the
    // stored value as plain text rather than failing the whole deploy.
    return String(stored ?? '');
  }
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
