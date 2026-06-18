const test = require('node:test');
const assert = require('node:assert');
const {
  validateComposeProjectName,
  validateStackDeployPath,
  STACK_DEPLOY_BASE,
} = require('./shellSafe');

test('validateComposeProjectName accepts valid names', () => {
  assert.strictEqual(validateComposeProjectName('nextcloud'), 'nextcloud');
  assert.strictEqual(validateComposeProjectName('matomo-app_1.2'), 'matomo-app_1.2');
});

test('validateComposeProjectName rejects bad names', () => {
  assert.throws(() => validateComposeProjectName(''), /required|Invalid/i);
  assert.throws(() => validateComposeProjectName('bad name'), /Invalid/i);
  assert.throws(() => validateComposeProjectName('-leading'), /Invalid/i);
  assert.throws(() => validateComposeProjectName('a'.repeat(65)), /Invalid/i);
});

test('validateStackDeployPath accepts paths under the base', () => {
  assert.strictEqual(
    validateStackDeployPath(`${STACK_DEPLOY_BASE}/nextcloud`),
    `${STACK_DEPLOY_BASE}/nextcloud`
  );
});

test('validateStackDeployPath rejects traversal and out-of-base paths', () => {
  assert.throws(() => validateStackDeployPath('/etc/passwd'), /Invalid/i);
  assert.throws(() => validateStackDeployPath(`${STACK_DEPLOY_BASE}/../etc`), /Invalid/i);
});
