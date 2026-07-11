const test = require('node:test');
const assert = require('node:assert');
const {
  buildComposeCommand,
  buildWriteFileCommand,
  parseComposeLs,
  parseEnvFile,
  rewriteRelativeBindMounts,
} = require('./stack.builders');

test('buildComposeCommand up (no pull)', () => {
  const cmd = buildComposeCommand({ name: 'nextcloud', deployPath: '/opt/dockerfleet/stacks/nextcloud', action: 'up' });
  assert.match(cmd, /cd '\/opt\/dockerfleet\/stacks\/nextcloud'/);
  assert.match(cmd, /docker compose -p 'nextcloud' --env-file .env -f compose.yaml up -d/);
  assert.doesNotMatch(cmd, /compose pull/);
});

test('buildComposeCommand up with pull runs best-effort pull first', () => {
  const cmd = buildComposeCommand({ name: 'm', deployPath: '/opt/dockerfleet/stacks/m', action: 'up', pull: true });
  assert.match(cmd, /compose -p 'm' --env-file .env -f compose.yaml pull --ignore-pull-failures \|\| true\) && /);
  // A failed pull (e.g. locally built image) must not block the up
  assert.match(cmd, /\(.*pull.*\|\| true\)/);
});

test('buildComposeCommand with pull applies DOCKER_API_VERSION to all subcommands', () => {
  const cmd = buildComposeCommand({ name: 'm', deployPath: '/opt/dockerfleet/stacks/m', action: 'up', pull: true });
  assert.match(cmd, /export DOCKER_API_VERSION=1\.41/);
  // Verify it's only exported once at the beginning
  const matches = cmd.match(/export DOCKER_API_VERSION=1\.41/g);
  assert.strictEqual(matches.length, 1, 'DOCKER_API_VERSION should be exported exactly once');
});

test('buildComposeCommand down', () => {
  const cmd = buildComposeCommand({ name: 'm', deployPath: '/opt/dockerfleet/stacks/m', action: 'down' });
  assert.match(cmd, /down/);
});

test('buildComposeCommand rejects bad name', () => {
  assert.throws(() => buildComposeCommand({ name: 'bad name', deployPath: '/opt/dockerfleet/stacks/x', action: 'up' }), /Invalid/i);
});

test('buildWriteFileCommand round-trips content via base64', () => {
  const content = "version: '3'\nservices:\n  a:\n    image: x # tricky 'quotes'\n";
  const cmd = buildWriteFileCommand('/opt/dockerfleet/stacks/x', 'compose.yaml', content);
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  assert.match(cmd, new RegExp(b64.replace(/[+/]/g, '\\$&')));
  assert.match(cmd, /base64 -d > '\/opt\/dockerfleet\/stacks\/x\/compose\.yaml'/);
});

test('buildWriteFileCommand rejects filename with path traversal', () => {
  assert.throws(() => buildWriteFileCommand('/opt/dockerfleet/stacks/x', '../evil', 'content'), (err) => err.code === 'INVALID_INPUT');
});

test('buildWriteFileCommand rejects filename with slashes', () => {
  assert.throws(() => buildWriteFileCommand('/opt/dockerfleet/stacks/x', 'a/b', 'content'), (err) => err.code === 'INVALID_INPUT');
});

test('buildWriteFileCommand rejects .. as filename', () => {
  assert.throws(() => buildWriteFileCommand('/opt/dockerfleet/stacks/x', '..', 'content'), (err) => err.code === 'INVALID_INPUT');
});

test('buildWriteFileCommand accepts compose.yaml and .env', () => {
  assert.doesNotThrow(() => buildWriteFileCommand('/opt/dockerfleet/stacks/x', 'compose.yaml', 'content'));
  assert.doesNotThrow(() => buildWriteFileCommand('/opt/dockerfleet/stacks/x', '.env', 'content'));
});

test('parseComposeLs parses docker compose ls JSON', () => {
  const json = JSON.stringify([
    { Name: 'nextcloud', Status: 'running(2)', ConfigFiles: '/home/s/Docker/nextcloud/docker-compose.yml' },
    { Name: 'matomo', Status: 'running(3)', ConfigFiles: '/a.yml,/b.yml' },
  ]);
  const out = parseComposeLs(json);
  assert.deepStrictEqual(out[0], { name: 'nextcloud', status: 'running(2)', configFiles: ['/home/s/Docker/nextcloud/docker-compose.yml'] });
  assert.deepStrictEqual(out[1].configFiles, ['/a.yml', '/b.yml']);
});

test('rewriteRelativeBindMounts resolves ./ and ../ short-syntax binds', () => {
  const yaml = [
    'services:',
    '  app:',
    '    volumes:',
    '      - ./data:/app/data',
    '      - ../shared:/shared:ro',
    '      - named_vol:/var/lib/x',
    '      - /abs/path:/abs',
  ].join('\n');
  const out = rewriteRelativeBindMounts(yaml, '/home/stevec/Docker/teamarr');
  assert.match(out, /- \/home\/stevec\/Docker\/teamarr\/data:\/app\/data/);
  assert.match(out, /- \/home\/stevec\/Docker\/shared:\/shared:ro/);
  assert.match(out, /- named_vol:\/var\/lib\/x/);
  assert.match(out, /- \/abs\/path:\/abs/);
});

test('rewriteRelativeBindMounts handles quotes and bare dot', () => {
  const yaml = [
    "      - './cfg:/cfg'",
    '      - ".:/workdir"',
  ].join('\n');
  const out = rewriteRelativeBindMounts(yaml, '/opt/proj');
  assert.match(out, /- '\/opt\/proj\/cfg:\/cfg'/);
  assert.match(out, /- "\/opt\/proj:\/workdir"/);
});

test('rewriteRelativeBindMounts resolves long-syntax source', () => {
  const yaml = [
    '    volumes:',
    '      - type: bind',
    '        source: ./data',
    '        target: /app/data',
  ].join('\n');
  const out = rewriteRelativeBindMounts(yaml, '/home/s/proj');
  assert.match(out, /source: \/home\/s\/proj\/data/);
  assert.match(out, /target: \/app\/data/);
});

test('rewriteRelativeBindMounts leaves ports, env_file and absolute sources alone', () => {
  const yaml = [
    '    ports:',
    '      - "8080:80"',
    '    env_file:',
    '      - ./prod.env',
    '    volumes:',
    '      - /data:/data',
  ].join('\n');
  const out = rewriteRelativeBindMounts(yaml, '/opt/proj');
  assert.match(out, /- "8080:80"/);
  assert.match(out, /- \.\/prod\.env/);
  assert.match(out, /- \/data:\/data/);
});

test('rewriteRelativeBindMounts is a no-op without a valid project dir', () => {
  const yaml = '      - ./data:/app/data';
  assert.strictEqual(rewriteRelativeBindMounts(yaml, ''), yaml);
  assert.strictEqual(rewriteRelativeBindMounts(yaml, 'relative/dir'), yaml);
});

test('parseEnvFile ignores comments/blanks and splits on first =', () => {
  const out = parseEnvFile('# c\n\nTZ=Europe/London\nURL=http://x?a=b\n');
  assert.deepStrictEqual(out, [
    { key: 'TZ', value: 'Europe/London' },
    { key: 'URL', value: 'http://x?a=b' },
  ]);
});
