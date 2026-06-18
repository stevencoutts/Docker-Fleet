const test = require('node:test');
const assert = require('node:assert');
const { serializeStack } = require('./stacks.controller');
const { storeValue } = require('../../utils/stackEnv');

test('serializeStack masks secret env values and omits raw value', () => {
  const stack = {
    id: '1', serverId: 's', name: 'demo', composeYaml: 'x', deployPath: '/opt/dockerfleet/stacks/demo',
    source: 'created', lastDeployedAt: null, lastDeployStatus: null,
    envVars: [
      { key: 'TZ', value: 'Europe/London', isSecret: false },
      { key: 'PASS', value: storeValue('s3cret', true), isSecret: true },
    ],
    toJSON() { return this; },
  };
  const out = serializeStack(stack);
  assert.strictEqual(out.name, 'demo');
  assert.deepStrictEqual(out.env, [
    { key: 'TZ', value: 'Europe/London', isSecret: false },
    { key: 'PASS', value: null, isSecret: true },
  ]);
});
