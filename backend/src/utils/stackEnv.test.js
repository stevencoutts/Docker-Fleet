const test = require('node:test');
const assert = require('node:assert');
const { storeValue, readValue, flagSecret, renderEnvFile, maskRows } = require('./stackEnv');

test('non-secret values round-trip as plaintext', () => {
  const stored = storeValue('plainval', false);
  assert.strictEqual(stored, 'plainval');
  assert.strictEqual(readValue(stored, false), 'plainval');
});

test('secret values are encrypted at rest and decrypt back', () => {
  const stored = storeValue('s3cret', true);
  assert.notStrictEqual(stored, 's3cret');
  assert.match(stored, /encryptedData/);
  assert.strictEqual(readValue(stored, true), 's3cret');
});

test('flagSecret detects secret-like keys', () => {
  assert.strictEqual(flagSecret('MYSQL_ROOT_PASSWORD'), true);
  assert.strictEqual(flagSecret('DJANGO_SECRET_KEY'), true);
  assert.strictEqual(flagSecret('ANTHROPIC_API_KEY'), true);
  assert.strictEqual(flagSecret('TZ'), false);
});

test('renderEnvFile produces KEY=value lines', () => {
  const out = renderEnvFile([{ key: 'TZ', value: 'Europe/London' }, { key: 'PORT', value: '80' }]);
  assert.strictEqual(out, 'TZ=Europe/London\nPORT=80\n');
});

test('maskRows nulls secret values only', () => {
  const masked = maskRows([
    { key: 'TZ', value: 'Europe/London', isSecret: false },
    { key: 'PASS', value: 'x', isSecret: true },
  ]);
  assert.deepStrictEqual(masked, [
    { key: 'TZ', value: 'Europe/London', isSecret: false },
    { key: 'PASS', value: null, isSecret: true },
  ]);
});
