const test = require('node:test');
const assert = require('node:assert');
const sshService = require('./ssh.service');
const stackService = require('./stack.service');
const { storeValue } = require('../utils/stackEnv');

const server = { id: 's1', host: 'h' };
const stack = { name: 'demo', deployPath: '/opt/dockerfleet/stacks/demo', composeYaml: "services:\n  a:\n    image: nginx\n" };

test('deployStack writes files then runs compose up, returns success', async (t) => {
  const calls = [];
  t.mock.method(sshService, 'executeCommand', async (srv, command) => {
    calls.push(command);
    return { stdout: 'Container demo-a-1 Started', stderr: '', code: 0 };
  });
  const rows = [{ key: 'TZ', value: 'Europe/London', isSecret: false }];
  const res = await stackService.deployStack(server, stack, rows, { pull: false });
  assert.strictEqual(res.success, true);
  // compose.yaml write, .env write, then compose up
  assert.ok(calls.some((c) => /base64 -d > '\/opt\/dockerfleet\/stacks\/demo\/compose\.yaml'/.test(c)));
  assert.ok(calls.some((c) => /base64 -d > '\/opt\/dockerfleet\/stacks\/demo\/\.env'/.test(c)));
  assert.ok(calls.some((c) => /docker compose -p 'demo' .* up -d/.test(c)));
});

test('deployStack reports failure on non-zero compose exit', async (t) => {
  t.mock.method(sshService, 'executeCommand', async (srv, command) => {
    if (/up -d/.test(command)) return { stdout: '', stderr: 'boom', code: 1 };
    return { stdout: '', stderr: '', code: 0 };
  });
  const res = await stackService.deployStack(server, stack, [], { pull: false });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.stderr, 'boom');
});

test('discover maps compose ls output and marks unmanaged', async (t) => {
  t.mock.method(sshService, 'executeCommand', async () => ({
    stdout: JSON.stringify([{ Name: 'x', Status: 'running(1)', ConfigFiles: '/a.yml' }]),
    stderr: '', code: 0,
  }));
  const out = await stackService.discover(server);
  assert.deepStrictEqual(out, [{ name: 'x', status: 'running(1)', configFiles: ['/a.yml'], managed: false }]);
});

test('decryptRows decrypts secret values', () => {
  const models = [
    { key: 'TZ', value: 'Europe/London', isSecret: false },
    { key: 'PASS', value: storeValue('hunter2', true), isSecret: true },
  ];
  const rows = stackService.decryptRows(models);
  assert.deepStrictEqual(rows, [
    { key: 'TZ', value: 'Europe/London' },
    { key: 'PASS', value: 'hunter2' },
  ]);
});
