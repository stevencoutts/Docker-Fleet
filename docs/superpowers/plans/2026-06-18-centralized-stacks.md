# Centralized Stacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DB-backed compose-stack management to DockerFleet: store each stack's compose YAML + structured/encrypted env centrally, deploy to its host, and import existing scattered compose projects.

**Architecture:** A `Stack` + `StackEnvVar` Sequelize model pair holds the source of truth. A new `stack.service.js` renders the compose YAML and a `.env` file onto the host (base64 over SSH) and runs `docker compose -p <name> --env-file .env -f compose.yaml up -d`. A `stacks` REST module exposes CRUD + lifecycle + discover/import. The React frontend gets a central catalog page, a stack editor, and an import modal.

**Tech Stack:** Node.js/Express, Sequelize (Postgres), ssh2 (via existing `ssh.service.js`), React + axios + Tailwind, `node:test` for backend unit tests (newly introduced — repo currently has none).

## Global Constraints

- Scope is **image-only stacks**; build-from-source (`build:`) is out of scope.
- DB is the source of truth for compose YAML + env.
- Secret env values are **encrypted at rest** via `backend/src/utils/encryption.js` and **never returned in plaintext** by the API.
- Compose project name must match `/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/` (the existing `COMPOSE_PROJECT_NAME_REGEX`).
- Host deploy directory is constrained to the base `/opt/dockerfleet/stacks/` (no path traversal).
- Stack **mutations are admin-only**; reads follow existing per-user server scoping (`where: { id, userId: req.user.id }`).
- Shell commands built with `backend/src/utils/shellSafe.js` helpers; SSH exec via `sshService.executeCommand(server, command, { allowFailure, timeout })` which resolves `{ stdout, stderr, code }`.
- Follow existing conventions: UUID PKs, snake_case columns via `field:`, CASCADE FKs to `servers`, module layout `modules/<name>/<name>.{routes,controller}.js`, frontend `services/*.service.js` + `pages/*.js`.

---

## Task 1: Test harness + shellSafe stack validators

**Files:**
- Modify: `backend/package.json` (add `test` script)
- Modify: `backend/src/utils/shellSafe.js`
- Test: `backend/src/utils/shellSafe.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `validateComposeProjectName(name) -> string` (throws `INVALID_INPUT` on bad input)
  - `validateStackDeployPath(path) -> string` (must start with `/opt/dockerfleet/stacks/`, no `..`)
  - `STACK_DEPLOY_BASE = '/opt/dockerfleet/stacks'`
  - `COMPOSE_PROJECT_NAME_REGEX` (exported)

- [ ] **Step 1: Add the test script**

In `backend/package.json`, add to `scripts`:

```json
    "test": "node --test"
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/utils/shellSafe.test.js`:

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `validateComposeProjectName is not a function`.

- [ ] **Step 4: Implement the validators**

In `backend/src/utils/shellSafe.js`, add before `module.exports`:

```js
// Compose project name: alphanumeric start, then [a-zA-Z0-9_.-], max 64 chars
const COMPOSE_PROJECT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const STACK_DEPLOY_BASE = '/opt/dockerfleet/stacks';

function validateComposeProjectName(name) {
  if (typeof name !== 'string' || !name.trim()) throwInvalid('Stack name is required', name);
  const trimmed = name.trim();
  if (!COMPOSE_PROJECT_NAME_REGEX.test(trimmed)) {
    throwInvalid('Invalid stack name: letters, numbers, hyphen, underscore, period; max 64 chars', name);
  }
  return trimmed;
}

function validateStackDeployPath(p) {
  if (typeof p !== 'string' || !p.trim()) throwInvalid('Deploy path is required', p);
  const trimmed = p.trim();
  if (trimmed.includes('..') || !trimmed.startsWith(STACK_DEPLOY_BASE + '/')) {
    throwInvalid('Invalid deploy path: must be under ' + STACK_DEPLOY_BASE, p);
  }
  return trimmed;
}
```

Add all four names to the `module.exports` object:

```js
  validateComposeProjectName,
  validateStackDeployPath,
  STACK_DEPLOY_BASE,
  COMPOSE_PROJECT_NAME_REGEX,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all shellSafe tests green).

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/src/utils/shellSafe.js backend/src/utils/shellSafe.test.js
git commit -m "feat(stacks): test harness + shellSafe stack validators"
```

---

## Task 2: Env value crypto + masking helper

**Files:**
- Create: `backend/src/utils/stackEnv.js`
- Test: `backend/src/utils/stackEnv.test.js`

**Interfaces:**
- Consumes: `encryption.encrypt/decrypt`.
- Produces:
  - `storeValue(plain, isSecret) -> string` (secret → JSON of encrypt(); non-secret → plain)
  - `readValue(stored, isSecret) -> string` (secret → decrypt(JSON.parse); non-secret → stored)
  - `flagSecret(key) -> boolean` (true if key matches `PASSWORD|SECRET|TOKEN|KEY|PASS|API`)
  - `renderEnvFile(rows) -> string` where `rows` is `[{ key, value }]` (already plaintext) → `KEY=value\n…`
  - `maskRows(rows) -> [{ key, value, isSecret }]` (secret values replaced with `null`)

- [ ] **Step 1: Write the failing test**

Create `backend/src/utils/stackEnv.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — cannot find module `./stackEnv`.

- [ ] **Step 3: Implement the helper**

Create `backend/src/utils/stackEnv.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/stackEnv.js backend/src/utils/stackEnv.test.js
git commit -m "feat(stacks): env value crypto + masking helper"
```

---

## Task 3: Compose command builder + parsers

**Files:**
- Create: `backend/src/services/stack.builders.js`
- Test: `backend/src/services/stack.builders.test.js`

**Interfaces:**
- Consumes: `shellSafe.{validateComposeProjectName,validateStackDeployPath,escapeSingleQuoted}`, `stackEnv.flagSecret`.
- Produces:
  - `buildComposeCommand({ name, deployPath, action, pull }) -> string` where `action` ∈ `up|down|restart`.
  - `buildWriteFileCommand(deployPath, filename, content) -> string` (base64-safe write)
  - `parseComposeLs(jsonText) -> [{ name, status, configFiles: string[] }]`
  - `parseEnvFile(text) -> [{ key, value }]`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/stack.builders.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const {
  buildComposeCommand,
  buildWriteFileCommand,
  parseComposeLs,
  parseEnvFile,
} = require('./stack.builders');

test('buildComposeCommand up (no pull)', () => {
  const cmd = buildComposeCommand({ name: 'nextcloud', deployPath: '/opt/dockerfleet/stacks/nextcloud', action: 'up' });
  assert.match(cmd, /cd '\/opt\/dockerfleet\/stacks\/nextcloud'/);
  assert.match(cmd, /docker compose -p 'nextcloud' --env-file .env -f compose.yaml up -d/);
  assert.doesNotMatch(cmd, /compose pull/);
});

test('buildComposeCommand up with pull runs pull first', () => {
  const cmd = buildComposeCommand({ name: 'm', deployPath: '/opt/dockerfleet/stacks/m', action: 'up', pull: true });
  assert.match(cmd, /compose -p 'm' --env-file .env -f compose.yaml pull && /);
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

test('parseComposeLs parses docker compose ls JSON', () => {
  const json = JSON.stringify([
    { Name: 'nextcloud', Status: 'running(2)', ConfigFiles: '/home/s/Docker/nextcloud/docker-compose.yml' },
    { Name: 'matomo', Status: 'running(3)', ConfigFiles: '/a.yml,/b.yml' },
  ]);
  const out = parseComposeLs(json);
  assert.deepStrictEqual(out[0], { name: 'nextcloud', status: 'running(2)', configFiles: ['/home/s/Docker/nextcloud/docker-compose.yml'] });
  assert.deepStrictEqual(out[1].configFiles, ['/a.yml', '/b.yml']);
});

test('parseEnvFile ignores comments/blanks and splits on first =', () => {
  const out = parseEnvFile('# c\n\nTZ=Europe/London\nURL=http://x?a=b\n');
  assert.deepStrictEqual(out, [
    { key: 'TZ', value: 'Europe/London' },
    { key: 'URL', value: 'http://x?a=b' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — cannot find module `./stack.builders`.

- [ ] **Step 3: Implement the builders**

Create `backend/src/services/stack.builders.js`:

```js
const {
  validateComposeProjectName,
  validateStackDeployPath,
  escapeSingleQuoted,
} = require('../utils/shellSafe');

function buildComposeCommand({ name, deployPath, action, pull }) {
  const safeName = validateComposeProjectName(name);
  const safePath = validateStackDeployPath(deployPath);
  const base = `docker compose -p ${escapeSingleQuoted(safeName)} --env-file .env -f compose.yaml`;
  let op;
  if (action === 'up') op = pull ? `${base} pull && ${base} up -d` : `${base} up -d`;
  else if (action === 'down') op = `${base} down`;
  else if (action === 'restart') op = `${base} restart`;
  else throw new Error(`Invalid compose action: ${action}`);
  return `cd ${escapeSingleQuoted(safePath)} && DOCKER_API_VERSION=1.41 ${op}`;
}

function buildWriteFileCommand(deployPath, filename, content) {
  const safePath = validateStackDeployPath(deployPath);
  const b64 = Buffer.from(String(content), 'utf8').toString('base64');
  const target = `${safePath}/${filename}`;
  return `mkdir -p ${escapeSingleQuoted(safePath)} && printf '%s' ${escapeSingleQuoted(b64)} | base64 -d > ${escapeSingleQuoted(target)}`;
}

function parseComposeLs(jsonText) {
  let arr;
  try {
    arr = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => ({
    name: p.Name,
    status: p.Status || '',
    configFiles: String(p.ConfigFiles || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }));
}

function parseEnvFile(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=');
      return { key: l.slice(0, idx).trim(), value: l.slice(idx + 1) };
    });
}

module.exports = { buildComposeCommand, buildWriteFileCommand, parseComposeLs, parseEnvFile };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/stack.builders.js backend/src/services/stack.builders.test.js
git commit -m "feat(stacks): compose command builder + compose ls/env parsers"
```

---

## Task 4: Stack & StackEnvVar models + migrations

**Files:**
- Create: `backend/src/models/Stack.js`
- Create: `backend/src/models/StackEnvVar.js`
- Create: `backend/src/migrations/20240618000024-create-stacks.js`
- Create: `backend/src/migrations/20240618000025-create-stack-env-vars.js`
- Modify: `backend/src/models/index.js`

**Interfaces:**
- Consumes: Sequelize, `db.Server`.
- Produces: `db.Stack`, `db.StackEnvVar` with associations (`Server.hasMany(Stack)`, `Stack.hasMany(StackEnvVar, { as: 'envVars' })`).

- [ ] **Step 1: Create the Stack model**

Create `backend/src/models/Stack.js`:

```js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Stack = sequelize.define(
    'Stack',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      serverId: {
        type: DataTypes.UUID, allowNull: false, field: 'server_id',
        references: { model: 'servers', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      name: { type: DataTypes.STRING, allowNull: false },
      composeYaml: { type: DataTypes.TEXT, allowNull: false, field: 'compose_yaml' },
      deployPath: { type: DataTypes.STRING(512), allowNull: false, field: 'deploy_path' },
      source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'created' },
      lastDeployedAt: { type: DataTypes.DATE, allowNull: true, field: 'last_deployed_at' },
      lastDeployStatus: { type: DataTypes.STRING, allowNull: true, field: 'last_deploy_status' },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
    },
    { tableName: 'stacks', timestamps: true, indexes: [{ unique: true, fields: ['server_id', 'name'] }] }
  );
  return Stack;
};
```

- [ ] **Step 2: Create the StackEnvVar model**

Create `backend/src/models/StackEnvVar.js`:

```js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const StackEnvVar = sequelize.define(
    'StackEnvVar',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      stackId: {
        type: DataTypes.UUID, allowNull: false, field: 'stack_id',
        references: { model: 'stacks', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      key: { type: DataTypes.STRING, allowNull: false },
      value: { type: DataTypes.TEXT, allowNull: true },
      isSecret: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_secret' },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
    },
    { tableName: 'stack_env_vars', timestamps: true, indexes: [{ unique: true, fields: ['stack_id', 'key'] }] }
  );
  return StackEnvVar;
};
```

- [ ] **Step 3: Create the migrations**

Create `backend/src/migrations/20240618000024-create-stacks.js`:

```js
'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('stacks', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      server_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'servers', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING, allowNull: false },
      compose_yaml: { type: Sequelize.TEXT, allowNull: false },
      deploy_path: { type: Sequelize.STRING(512), allowNull: false },
      source: { type: Sequelize.STRING, allowNull: false, defaultValue: 'created' },
      last_deployed_at: { type: Sequelize.DATE, allowNull: true },
      last_deploy_status: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('stacks', ['server_id', 'name'], { unique: true, name: 'stacks_server_id_name_unique' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('stacks');
  },
};
```

Create `backend/src/migrations/20240618000025-create-stack-env-vars.js`:

```js
'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('stack_env_vars', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      stack_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'stacks', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      key: { type: Sequelize.STRING, allowNull: false },
      value: { type: Sequelize.TEXT, allowNull: true },
      is_secret: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('stack_env_vars', ['stack_id', 'key'], { unique: true, name: 'stack_env_vars_stack_id_key_unique' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('stack_env_vars');
  },
};
```

- [ ] **Step 4: Register models + associations**

In `backend/src/models/index.js`, add after the `db.ServerCertificateCache = …` line (around line 52):

```js
db.Stack = require('./Stack')(sequelize, Sequelize);
db.StackEnvVar = require('./StackEnvVar')(sequelize, Sequelize);
```

And after the `db.ServerProxyRoute.belongsTo(...)` block (around line 76):

```js
db.Server.hasMany(db.Stack, { foreignKey: 'serverId', as: 'stacks' });
db.Stack.belongsTo(db.Server, { foreignKey: 'serverId', as: 'server' });
db.Stack.hasMany(db.StackEnvVar, { foreignKey: 'stackId', as: 'envVars' });
db.StackEnvVar.belongsTo(db.Stack, { foreignKey: 'stackId', as: 'stack' });
```

- [ ] **Step 5: Run the migration**

Run: `cd backend && npm run migrate`
Expected: `== 20240618000024-create-stacks: migrated` and `== 20240618000025-create-stack-env-vars: migrated`.

- [ ] **Step 6: Verify models load**

Run: `cd backend && node -e "const db=require('./src/models'); console.log(!!db.Stack, !!db.StackEnvVar, Object.keys(db.Stack.associations), Object.keys(db.StackEnvVar.associations));"`
Expected: `true true [ 'server', 'envVars' ] [ 'stack' ]`

- [ ] **Step 7: Commit**

```bash
git add backend/src/models/Stack.js backend/src/models/StackEnvVar.js backend/src/migrations/20240618000024-create-stacks.js backend/src/migrations/20240618000025-create-stack-env-vars.js backend/src/models/index.js
git commit -m "feat(stacks): Stack + StackEnvVar models and migrations"
```

---

## Task 5: Stack service (deploy / lifecycle / discover / import)

**Files:**
- Create: `backend/src/services/stack.service.js`
- Test: `backend/src/services/stack.service.test.js`

**Interfaces:**
- Consumes: `sshService.executeCommand(server, command, opts) -> {stdout,stderr,code}`, `stack.builders.*`, `stackEnv.{renderEnvFile,readValue}`.
- Produces:
  - `deployStack(server, stack, plainEnvRows, { pull }) -> { success, code, stdout, stderr }`
  - `lifecycle(server, stack, action) -> { success, code, stdout, stderr }` (`action` ∈ `down|restart`)
  - `discover(server) -> [{ name, status, configFiles, managed:false }]`
  - `readRemoteFiles(server, paths) -> { [path]: content }`
  - `decryptRows(envVarModels) -> [{ key, value }]` (plaintext, for deploy)

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/stack.service.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — cannot find module `./stack.service`.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/stack.service.js`:

```js
const sshService = require('./ssh.service');
const logger = require('../config/logger');
const { buildComposeCommand, buildWriteFileCommand, parseComposeLs } = require('./stack.builders');
const { renderEnvFile, readValue } = require('../utils/stackEnv');
const { escapeSingleQuoted } = require('../utils/shellSafe');

function decryptRows(envVarModels) {
  return (envVarModels || []).map((e) => ({ key: e.key, value: readValue(e.value, e.isSecret) }));
}

async function deployStack(server, stack, plainEnvRows, { pull } = {}) {
  const composeCmd = buildWriteFileCommand(stack.deployPath, 'compose.yaml', stack.composeYaml);
  await sshService.executeCommand(server, composeCmd, { timeout: 60000 });

  const envContent = renderEnvFile(plainEnvRows || []);
  const envCmd = buildWriteFileCommand(stack.deployPath, '.env', envContent);
  await sshService.executeCommand(server, envCmd, { timeout: 60000 });

  const upCmd = buildComposeCommand({ name: stack.name, deployPath: stack.deployPath, action: 'up', pull });
  const result = await sshService.executeCommand(server, upCmd, { timeout: 600000, allowFailure: true });
  const out = `${result.stdout || ''}\n${result.stderr || ''}`;
  const success = result.code === 0 || /Container\s+\S+\s+(Started|Running|Created)/i.test(out);
  return { success, code: result.code, stdout: result.stdout || '', stderr: result.stderr || '' };
}

async function lifecycle(server, stack, action) {
  const cmd = buildComposeCommand({ name: stack.name, deployPath: stack.deployPath, action });
  const result = await sshService.executeCommand(server, cmd, { timeout: 300000, allowFailure: true });
  return { success: result.code === 0, code: result.code, stdout: result.stdout || '', stderr: result.stderr || '' };
}

async function discover(server) {
  const result = await sshService.executeCommand(
    server,
    'DOCKER_API_VERSION=1.41 docker compose ls --all --format json',
    { timeout: 60000, allowFailure: true }
  );
  if (result.code !== 0) {
    logger.warn(`discover: compose ls failed on ${server.host}: ${result.stderr}`);
    return [];
  }
  return parseComposeLs(result.stdout).map((p) => ({ ...p, managed: false }));
}

async function readRemoteFiles(server, paths) {
  const out = {};
  for (const p of paths) {
    const result = await sshService.executeCommand(server, `cat ${escapeSingleQuoted(p)}`, { timeout: 30000, allowFailure: true });
    out[p] = result.code === 0 ? result.stdout : null;
  }
  return out;
}

module.exports = { deployStack, lifecycle, discover, readRemoteFiles, decryptRows };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (all stack.service tests green).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/stack.service.js backend/src/services/stack.service.test.js
git commit -m "feat(stacks): stack service for deploy/lifecycle/discover/import IO"
```

---

## Task 6: Stacks controller + routes

**Files:**
- Create: `backend/src/modules/stacks/stacks.controller.js`
- Create: `backend/src/modules/stacks/stacks.routes.js`
- Modify: `backend/src/routes/index.js`
- Test: `backend/src/modules/stacks/stacks.controller.test.js`

**Interfaces:**
- Consumes: `db.{Stack,StackEnvVar,Server}`, `stackService.*`, `stackEnv.{storeValue,maskRows,flagSecret}`, `stack.builders.parseEnvFile`, `shellSafe.{validateComposeProjectName,STACK_DEPLOY_BASE}`.
- Produces: Express handlers `listStacks, getStack, createStack, updateStack, deleteStack, deployStack, downStack, restartStack, discover, importStacks`; router mounted at `/stacks` and import endpoints under `/servers`.

- [ ] **Step 1: Write the failing test (serializer behavior)**

Create `backend/src/modules/stacks/stacks.controller.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — cannot find module `./stacks.controller`.

- [ ] **Step 3: Implement the controller**

Create `backend/src/modules/stacks/stacks.controller.js`:

```js
const db = require('../../models');
const logger = require('../../config/logger');
const stackService = require('../../services/stack.service');
const { storeValue, maskRows, flagSecret } = require('../../utils/stackEnv');
const { parseEnvFile } = require('../../services/stack.builders');
const { validateComposeProjectName, validateStackDeployPath, STACK_DEPLOY_BASE } = require('../../utils/shellSafe');

const { Stack, StackEnvVar, Server } = db;

function serializeStack(stackModel) {
  const s = typeof stackModel.toJSON === 'function' ? stackModel.toJSON() : stackModel;
  const env = maskRows((s.envVars || []).map((e) => ({ key: e.key, value: e.value, isSecret: e.isSecret })));
  return {
    id: s.id, serverId: s.serverId, name: s.name, composeYaml: s.composeYaml,
    deployPath: s.deployPath, source: s.source,
    lastDeployedAt: s.lastDeployedAt, lastDeployStatus: s.lastDeployStatus, env,
  };
}

async function findUserServer(req, serverId) {
  return Server.findOne({ where: { id: serverId, userId: req.user.id } });
}

async function findUserStack(req, stackId) {
  const stack = await Stack.findByPk(stackId, { include: [{ model: StackEnvVar, as: 'envVars' }, { model: Server, as: 'server' }] });
  if (!stack) return null;
  if (stack.server.userId !== req.user.id) return null;
  return stack;
}

async function replaceEnv(stackId, envInput) {
  await StackEnvVar.destroy({ where: { stackId } });
  const rows = (envInput || []).map((e) => ({
    stackId, key: e.key,
    isSecret: !!e.isSecret,
    value: storeValue(e.value ?? '', !!e.isSecret),
  }));
  if (rows.length) await StackEnvVar.bulkCreate(rows);
}

const listStacks = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.serverId) where.serverId = req.query.serverId;
    const servers = await Server.findAll({ where: { userId: req.user.id }, attributes: ['id'] });
    const allowed = new Set(servers.map((s) => s.id));
    const stacks = await Stack.findAll({ where, include: [{ model: StackEnvVar, as: 'envVars' }] });
    res.json(stacks.filter((s) => allowed.has(s.serverId)).map(serializeStack));
  } catch (e) { next(e); }
};

const getStack = async (req, res, next) => {
  try {
    const stack = await findUserStack(req, req.params.id);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    res.json(serializeStack(stack));
  } catch (e) { next(e); }
};

const createStack = async (req, res, next) => {
  try {
    const { serverId, name, composeYaml, env } = req.body;
    const safeName = validateComposeProjectName(name);
    if (typeof composeYaml !== 'string' || !composeYaml.trim()) return res.status(400).json({ error: 'composeYaml is required' });
    const server = await findUserServer(req, serverId);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const deployPath = validateStackDeployPath(`${STACK_DEPLOY_BASE}/${safeName}`);
    const stack = await Stack.create({ serverId, name: safeName, composeYaml, deployPath, source: 'created' });
    await replaceEnv(stack.id, env);
    const full = await findUserStack(req, stack.id);
    res.status(201).json(serializeStack(full));
  } catch (e) { if (e.code === 'INVALID_INPUT') return res.status(400).json({ error: e.message }); next(e); }
};

const updateStack = async (req, res, next) => {
  try {
    const stack = await findUserStack(req, req.params.id);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    const { composeYaml, env } = req.body;
    if (typeof composeYaml === 'string' && composeYaml.trim()) stack.composeYaml = composeYaml;
    await stack.save();
    if (Array.isArray(env)) {
      // Blank secret value = keep existing
      const existing = await StackEnvVar.findAll({ where: { stackId: stack.id } });
      const byKey = Object.fromEntries(existing.map((e) => [e.key, e]));
      const merged = env.map((e) => {
        if (e.isSecret && (e.value === null || e.value === undefined || e.value === '') && byKey[e.key]) {
          return { key: e.key, isSecret: true, value: byKey[e.key].value, _stored: true };
        }
        return { key: e.key, isSecret: !!e.isSecret, value: e.value ?? '', _stored: false };
      });
      await StackEnvVar.destroy({ where: { stackId: stack.id } });
      const rows = merged.map((m) => ({ stackId: stack.id, key: m.key, isSecret: m.isSecret, value: m._stored ? m.value : storeValue(m.value, m.isSecret) }));
      if (rows.length) await StackEnvVar.bulkCreate(rows);
    }
    const full = await findUserStack(req, stack.id);
    res.json(serializeStack(full));
  } catch (e) { if (e.code === 'INVALID_INPUT') return res.status(400).json({ error: e.message }); next(e); }
};

const deleteStack = async (req, res, next) => {
  try {
    const stack = await findUserStack(req, req.params.id);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    if (req.query.down === 'true') {
      try { await stackService.lifecycle(stack.server, stack, 'down'); } catch (e) { logger.warn('down on delete failed:', e.message); }
    }
    await stack.destroy();
    res.json({ success: true });
  } catch (e) { next(e); }
};

const deployStack = async (req, res, next) => {
  try {
    const stack = await findUserStack(req, req.params.id);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    const plain = stackService.decryptRows(stack.envVars);
    const result = await stackService.deployStack(stack.server, stack, plain, { pull: req.query.pull === 'true' });
    stack.lastDeployedAt = new Date();
    stack.lastDeployStatus = result.success ? 'deployed' : 'error';
    await stack.save();
    res.json(result);
  } catch (e) { next(e); }
};

const lifecycleHandler = (action, statusOnSuccess) => async (req, res, next) => {
  try {
    const stack = await findUserStack(req, req.params.id);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    const result = await stackService.lifecycle(stack.server, stack, action);
    if (action === 'down') { stack.lastDeployStatus = result.success ? 'stopped' : 'error'; await stack.save(); }
    res.json(result);
  } catch (e) { next(e); }
};

const discover = async (req, res, next) => {
  try {
    const server = await findUserServer(req, req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const projects = await stackService.discover(server);
    const managed = await Stack.findAll({ where: { serverId: server.id }, attributes: ['name'] });
    const managedNames = new Set(managed.map((m) => m.name));
    res.json(projects.map((p) => ({ ...p, managed: managedNames.has(p.name) })));
  } catch (e) { next(e); }
};

const importStacks = async (req, res, next) => {
  try {
    const server = await findUserServer(req, req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const { projects } = req.body; // [{ name, configFiles: [...] }]
    if (!Array.isArray(projects) || !projects.length) return res.status(400).json({ error: 'projects[] required' });
    const results = [];
    for (const p of projects) {
      try {
        const safeName = validateComposeProjectName(p.name);
        const files = await stackService.readRemoteFiles(server, p.configFiles || []);
        const composeYaml = (p.configFiles || []).map((f) => files[f]).filter(Boolean).join('\n---\n');
        if (!composeYaml) throw new Error('No readable compose file');
        const deployPath = validateStackDeployPath(`${STACK_DEPLOY_BASE}/${safeName}`);
        const [stack] = await Stack.findOrCreate({
          where: { serverId: server.id, name: safeName },
          defaults: { serverId: server.id, name: safeName, composeYaml, deployPath, source: 'imported' },
        });
        // env: read .env next to first config file if present
        const firstDir = (p.configFiles && p.configFiles[0]) ? p.configFiles[0].replace(/\/[^/]+$/, '') : null;
        if (firstDir) {
          const envFiles = await stackService.readRemoteFiles(server, [`${firstDir}/.env`]);
          const envText = envFiles[`${firstDir}/.env`];
          if (envText) {
            const parsed = parseEnvFile(envText).map((e) => ({ ...e, isSecret: flagSecret(e.key) }));
            await StackEnvVar.destroy({ where: { stackId: stack.id } });
            await StackEnvVar.bulkCreate(parsed.map((e) => ({ stackId: stack.id, key: e.key, isSecret: e.isSecret, value: storeValue(e.value, e.isSecret) })));
          }
        }
        results.push({ name: safeName, imported: true });
      } catch (err) {
        results.push({ name: p.name, imported: false, error: err.message });
      }
    }
    res.json({ results });
  } catch (e) { next(e); }
};

module.exports = {
  serializeStack,
  listStacks, getStack, createStack, updateStack, deleteStack,
  deployStack, downStack: lifecycleHandler('down'), restartStack: lifecycleHandler('restart'),
  discover, importStacks,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS (`serializeStack` test green).

- [ ] **Step 5: Create the routes**

Create `backend/src/modules/stacks/stacks.routes.js`:

```js
const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../../middleware/auth.middleware');
const c = require('./stacks.controller');

router.get('/', c.listStacks);
router.post('/', requireAdmin, c.createStack);
router.get('/:id', c.getStack);
router.put('/:id', requireAdmin, c.updateStack);
router.delete('/:id', requireAdmin, c.deleteStack);
router.post('/:id/deploy', requireAdmin, c.deployStack);
router.post('/:id/down', requireAdmin, c.downStack);
router.post('/:id/restart', requireAdmin, c.restartStack);

module.exports = router;
```

> **Check:** confirm the admin guard export name in `backend/src/middleware/auth.middleware.js`. If it is not `requireAdmin`, use the actual exported admin middleware name (grep `module.exports` in that file). Reads (`GET`) require only `authenticate` (applied globally in `routes/index.js`).

Create the import sub-router as part of the servers routes. In `backend/src/modules/servers/servers.routes.js`, add near the other route definitions:

```js
const stacksController = require('../stacks/stacks.controller');
router.get('/:id/stacks/discover', stacksController.discover);
router.post('/:id/stacks/import', stacksController.importStacks);
```

- [ ] **Step 6: Mount the stacks router**

In `backend/src/routes/index.js`, add the require near the other module requires:

```js
const stacksRoutes = require('../modules/stacks/stacks.routes');
```

And after `router.use('/servers', imagesRoutes);`:

```js
router.use('/stacks', stacksRoutes);
```

- [ ] **Step 7: Verify the app boots**

Run: `cd backend && node -e "require('./src/routes'); console.log('routes load OK');"`
Expected: `routes load OK` (no throw).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/stacks backend/src/modules/servers/servers.routes.js backend/src/routes/index.js
git commit -m "feat(stacks): REST controller + routes (CRUD, lifecycle, discover, import)"
```

---

## Task 7: Remove superseded composeUp endpoint

**Files:**
- Modify: `backend/src/modules/servers/servers.controller.js` (remove `composeUp` + `COMPOSE_PROJECT_NAME_REGEX` if now unused there)
- Modify: `backend/src/modules/servers/servers.routes.js` (remove `composeUp` import + `POST /:id/compose/up` route)

**Interfaces:**
- Consumes: nothing new.
- Produces: removal only. (Frontend caller repointed in Task 11.)

- [ ] **Step 1: Remove the route**

In `backend/src/modules/servers/servers.routes.js`, delete the `composeUp` entry from the controller import list and delete the line:

```js
router.post('/:id/compose/up', composeUp);
```

- [ ] **Step 2: Remove the controller function**

In `backend/src/modules/servers/servers.controller.js`, delete the `composeUp` function (the `const composeUp = async (req, res, next) => { … };` block) and remove `composeUp` from `module.exports`. Leave `COMPOSE_PROJECT_NAME_REGEX` only if still referenced; otherwise delete it.

- [ ] **Step 3: Verify nothing else references composeUp**

Run: `cd backend && grep -rn "composeUp\|compose/up" src || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Verify app still boots**

Run: `cd backend && node -e "require('./src/routes'); console.log('OK');"`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/servers/servers.controller.js backend/src/modules/servers/servers.routes.js
git commit -m "refactor(stacks): remove superseded composeUp endpoint"
```

---

## Task 8: Frontend API client

**Files:**
- Create: `frontend/src/services/stacks.service.js`

**Interfaces:**
- Consumes: `frontend/src/services/api.js` default axios instance.
- Produces: `stacksService.{ list, get, create, update, remove, deploy, down, restart, discover, importStacks }`.

- [ ] **Step 1: Inspect an existing service for the axios pattern**

Run: `sed -n '1,30p' frontend/src/services/publicWww.service.js`
Expected: shows how `api` is imported and methods return `api.get/post(...)`. Mirror this exact pattern (import path, default export vs named).

- [ ] **Step 2: Implement the client**

Create `frontend/src/services/stacks.service.js` (adjust the `api` import to match Step 1):

```js
import api from './api';

const stacksService = {
  list: (serverId) => api.get('/stacks', { params: serverId ? { serverId } : {} }),
  get: (id) => api.get(`/stacks/${id}`),
  create: (payload) => api.post('/stacks', payload),
  update: (id, payload) => api.put(`/stacks/${id}`, payload),
  remove: (id, down = false) => api.delete(`/stacks/${id}`, { params: { down } }),
  deploy: (id, pull = false) => api.post(`/stacks/${id}/deploy`, null, { params: { pull } }),
  down: (id) => api.post(`/stacks/${id}/down`),
  restart: (id) => api.post(`/stacks/${id}/restart`),
  discover: (serverId) => api.get(`/servers/${serverId}/stacks/discover`),
  importStacks: (serverId, projects) => api.post(`/servers/${serverId}/stacks/import`, { projects }),
};

export default stacksService;
```

- [ ] **Step 3: Verify it builds**

Run: `cd frontend && npx eslint src/services/stacks.service.js`
Expected: no errors (warnings acceptable).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/stacks.service.js
git commit -m "feat(stacks): frontend API client"
```

---

## Task 9: Stacks catalog page + route + nav

**Files:**
- Create: `frontend/src/pages/Stacks.js`
- Modify: app router (where `pages/Images.js` route is registered — find with grep)
- Modify: nav component (where the Images/Servers nav links live — find with grep)

**Interfaces:**
- Consumes: `stacksService`, existing `ServerSelector` component, existing `LogsModal`.
- Produces: route `/stacks` rendering the catalog.

- [ ] **Step 1: Find where routes and nav are defined**

Run: `cd frontend && grep -rn "pages/Images\|path=\"/images\"\|Images" src/App.js src/components 2>/dev/null | head`
Expected: shows the router file and nav file + the exact pattern for adding a route and a nav link. Use those patterns in the next steps.

- [ ] **Step 2: Implement the page**

Create `frontend/src/pages/Stacks.js`:

```jsx
import React, { useEffect, useState, useCallback } from 'react';
import stacksService from '../services/stacks.service';

export default function Stacks() {
  const [stacks, setStacks] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await stacksService.list();
      setStacks(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (id, fn) => {
    setBusy(id);
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Stacks</h1>
      {error && <div className="bg-red-100 text-red-800 p-2 rounded mb-3">{error}</div>}
      <table className="w-full text-left">
        <thead>
          <tr className="border-b">
            <th className="p-2">Name</th><th className="p-2">Server</th>
            <th className="p-2">Last status</th><th className="p-2">Last deployed</th><th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {stacks.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="p-2 font-mono">{s.name}</td>
              <td className="p-2">{s.serverId}</td>
              <td className="p-2">{s.lastDeployStatus || '—'}</td>
              <td className="p-2">{s.lastDeployedAt ? new Date(s.lastDeployedAt).toLocaleString() : '—'}</td>
              <td className="p-2 space-x-2">
                <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.deploy(s.id, false))} className="text-blue-600">Deploy</button>
                <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.deploy(s.id, true))} className="text-blue-600">Pull+Deploy</button>
                <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.restart(s.id))} className="text-amber-600">Restart</button>
                <button disabled={busy === s.id} onClick={() => act(s.id, () => stacksService.down(s.id))} className="text-red-600">Down</button>
              </td>
            </tr>
          ))}
          {!stacks.length && <tr><td className="p-2" colSpan={5}>No managed stacks yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Register the route and nav link**

Using the patterns found in Step 1, add a protected route `/stacks` → `<Stacks />` (mirroring the Images route, wrapped in the same `PrivateRoute`/layout), and add a "Stacks" nav link next to the existing ones.

- [ ] **Step 4: Manual verification**

Run the app (`cd frontend && npm start`, backend running). Log in, navigate to `/stacks`.
Expected: page renders, shows "No managed stacks yet." (or existing stacks), no console errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Stacks.js frontend/src/App.js frontend/src/components
git commit -m "feat(stacks): catalog page, route and nav link"
```

---

## Task 10: Stack editor (create / edit with env table)

**Files:**
- Create: `frontend/src/components/StackEditor.js`
- Modify: `frontend/src/pages/Stacks.js` (open editor for New / Edit)

**Interfaces:**
- Consumes: `stacksService.{create,update,get}`, `ServerSelector`.
- Produces: `<StackEditor stack={null|stackObj} servers={...} onClose={fn} onSaved={fn} />`.

- [ ] **Step 1: Implement the editor**

Create `frontend/src/components/StackEditor.js`:

```jsx
import React, { useState } from 'react';
import stacksService from '../services/stacks.service';

export default function StackEditor({ stack, onClose, onSaved }) {
  const isEdit = !!stack;
  const [name, setName] = useState(stack?.name || '');
  const [serverId, setServerId] = useState(stack?.serverId || '');
  const [composeYaml, setComposeYaml] = useState(stack?.composeYaml || '');
  const [env, setEnv] = useState(stack?.env || []);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const setRow = (i, patch) => setEnv((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setEnv((rows) => [...rows, { key: '', value: '', isSecret: false }]);
  const delRow = (i) => setEnv((rows) => rows.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true); setError(null);
    try {
      if (isEdit) await stacksService.update(stack.id, { composeYaml, env });
      else await stacksService.create({ serverId, name, composeYaml, env });
      onSaved();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded p-4 w-full max-w-3xl max-h-[90vh] overflow-auto">
        <h2 className="text-xl font-bold mb-3">{isEdit ? `Edit ${stack.name}` : 'New stack'}</h2>
        {error && <div className="bg-red-100 text-red-800 p-2 rounded mb-2">{error}</div>}
        {!isEdit && (
          <>
            <label className="block text-sm">Name</label>
            <input className="border p-1 w-full mb-2" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="block text-sm">Server ID</label>
            <input className="border p-1 w-full mb-2" value={serverId} onChange={(e) => setServerId(e.target.value)} placeholder="server uuid" />
          </>
        )}
        <label className="block text-sm">Compose YAML</label>
        <textarea className="border p-1 w-full font-mono h-48 mb-3" value={composeYaml} onChange={(e) => setComposeYaml(e.target.value)} />
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold">Environment</span>
          <button onClick={addRow} className="text-blue-600 text-sm">+ Add</button>
        </div>
        {env.map((r, i) => (
          <div key={i} className="flex gap-2 mb-1">
            <input className="border p-1 flex-1" placeholder="KEY" value={r.key} onChange={(e) => setRow(i, { key: e.target.value })} />
            <input className="border p-1 flex-1" placeholder={r.isSecret ? '•••• (blank = keep)' : 'value'} type={r.isSecret ? 'password' : 'text'} value={r.value ?? ''} onChange={(e) => setRow(i, { value: e.target.value })} />
            <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={!!r.isSecret} onChange={(e) => setRow(i, { isSecret: e.target.checked })} />secret</label>
            <button onClick={() => delRow(i)} className="text-red-600">✕</button>
          </div>
        ))}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-blue-600 text-white px-3 py-1 rounded">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire New / Edit buttons into the page**

In `frontend/src/pages/Stacks.js`: add a `const [editing, setEditing] = useState(undefined);` (undefined = closed, null = new, object = edit), a "New stack" button (`onClick={() => setEditing(null)}`), an "Edit" button per row (`onClick={async () => setEditing((await stacksService.get(s.id)).data)}`), and render `{editing !== undefined && <StackEditor stack={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); load(); }} />}`.

- [ ] **Step 3: Manual verification — create**

In the running app: New stack → name `teststack`, paste a minimal compose (`services:\n  web:\n    image: nginx`), add env `TZ=Europe/London` and a secret `DEMO_PASS=x`, Save. Then Deploy on a test server.
Expected: stack appears; after Deploy, `last status = deployed`; re-open editor shows `DEMO_PASS` masked (empty password field), `TZ` visible.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/StackEditor.js frontend/src/pages/Stacks.js
git commit -m "feat(stacks): create/edit stack editor with env table"
```

---

## Task 11: Import modal + repoint old compose-install caller

**Files:**
- Create: `frontend/src/components/StackImportModal.js`
- Modify: `frontend/src/pages/Stacks.js` (Import button)
- Modify: whatever frontend code called the old `compose/up` endpoint (find with grep)

**Interfaces:**
- Consumes: `stacksService.{discover,importStacks}`.
- Produces: `<StackImportModal serverId={...} onClose={fn} onImported={fn} />`.

- [ ] **Step 1: Find the old compose-install caller**

Run: `cd frontend && grep -rn "compose/up\|composeUp\|compose_up" src || echo "none"`
Expected: lists the file(s) calling the removed endpoint (the "docker-compose.yml container install" UI), or `none`.

- [ ] **Step 2: Implement the import modal**

Create `frontend/src/components/StackImportModal.js`:

```jsx
import React, { useEffect, useState } from 'react';
import stacksService from '../services/stacks.service';

export default function StackImportModal({ serverId, onClose, onImported }) {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    (async () => {
      try { const { data } = await stacksService.discover(serverId); setProjects(data); }
      catch (e) { setError(e.response?.data?.error || e.message); }
      finally { setLoading(false); }
    })();
  }, [serverId]);

  const doImport = async () => {
    setImporting(true); setError(null);
    try {
      const chosen = projects.filter((p) => selected[p.name] && !p.managed);
      const { data } = await stacksService.importStacks(serverId, chosen.map((p) => ({ name: p.name, configFiles: p.configFiles })));
      onImported(data.results);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setImporting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded p-4 w-full max-w-2xl">
        <h2 className="text-xl font-bold mb-3">Import stacks</h2>
        {error && <div className="bg-red-100 text-red-800 p-2 rounded mb-2">{error}</div>}
        {loading ? <p>Discovering…</p> : (
          <table className="w-full text-left mb-3">
            <thead><tr className="border-b"><th></th><th className="p-1">Project</th><th className="p-1">Status</th><th className="p-1">State</th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.name} className="border-b">
                  <td className="p-1"><input type="checkbox" disabled={p.managed} checked={!!selected[p.name]} onChange={(e) => setSelected((s) => ({ ...s, [p.name]: e.target.checked }))} /></td>
                  <td className="p-1 font-mono">{p.name}</td>
                  <td className="p-1">{p.status}</td>
                  <td className="p-1">{p.managed ? 'managed' : 'unmanaged'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1">Close</button>
          <button onClick={doImport} disabled={importing} className="bg-blue-600 text-white px-3 py-1 rounded">{importing ? 'Importing…' : 'Import selected'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the Import button into the page**

In `frontend/src/pages/Stacks.js`: add `const [importServer, setImportServer] = useState(null);`, an "Import from server" control (reuse `ServerSelector` to pick, then set `importServer`), and render `{importServer && <StackImportModal serverId={importServer} onClose={() => setImportServer(null)} onImported={() => { setImportServer(null); load(); }} />}`.

- [ ] **Step 4: Repoint or remove the old compose-install UI**

For each file found in Step 1: if it was a generic "paste compose + install" form, change its submit to `stacksService.create({ serverId, name, composeYaml, env: [] })` followed by `stacksService.deploy(id)`. If it was a one-off button with no lasting value, remove it. Ensure no import of a now-deleted function remains.

- [ ] **Step 5: Manual verification — import**

In the running app: Stacks → Import from server → pick a host with existing compose projects (e.g. osiris). 
Expected: unmanaged projects listed; already-managed ones disabled; selecting + Import creates DB stacks; secret-looking env keys come in flagged as secret (masked in editor).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/StackImportModal.js frontend/src/pages/Stacks.js
git commit -m "feat(stacks): import modal + repoint legacy compose-install UI"
```

---

## Task 12: Docs + TODO update

**Files:**
- Create: `docs/STACKS.md`
- Modify: `README.md` (feature list)
- Modify: `TODO.md`

**Interfaces:** none.

- [ ] **Step 1: Write `docs/STACKS.md`**

Create `docs/STACKS.md` documenting: what a Stack is, DB-as-source-of-truth, deploy mechanism (`/opt/dockerfleet/stacks/<name>/` + `.env`), env secret encryption + masking, import flow, image-only scope (build stacks excluded), and the lifecycle endpoints. Keep to ~1 page; mirror the tone of `docs/PUBLIC_WWW.md`.

- [ ] **Step 2: Update README feature list**

In `README.md`, under the Container/Image management features, add a "Stacks" bullet group: "Centralized compose-stack management — store compose YAML + encrypted env in DockerFleet, deploy to hosts, import existing compose projects. See [docs/STACKS.md](docs/STACKS.md)."

- [ ] **Step 3: Update TODO.md**

In `TODO.md`, move *"Minimise docker compose yaml, move env variables to app configuration gui"* from `TODO` to `DONE` (reworded: "Centralized Stacks: compose + env managed in app, import existing stacks").

- [ ] **Step 4: Commit**

```bash
git add docs/STACKS.md README.md TODO.md
git commit -m "docs(stacks): document centralized stack management"
```

---

## Task 13: Full backend test run + manual end-to-end

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: all tests pass (shellSafe, stackEnv, stack.builders, stack.service, stacks.controller).

- [ ] **Step 2: End-to-end smoke against a real test host**

With backend + frontend running and a non-production test server registered:
1. Import a stack from the test host → appears in catalog.
2. Edit its compose/env → Save.
3. Deploy → `last status = deployed`; SSH to host and confirm `/opt/dockerfleet/stacks/<name>/compose.yaml` + `.env` exist and `docker compose -p <name> ls` shows it.
4. Down → containers stop; status `stopped`.
5. Delete with "down" → removed from catalog.
Expected: each step behaves as described; secrets never appear in API responses (check Network tab — secret values are `null`).

- [ ] **Step 3: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(stacks): full suite + e2e verification fixes"
```

---

## Self-review notes (for the implementer)

- **Admin middleware name** (Task 6 Step 5): verify the exact export in `auth.middleware.js` before using `requireAdmin`.
- **api import style** (Task 8): match `publicWww.service.js` exactly (default vs named import of `api`).
- **Router/nav files** (Task 9): the plan greps for them rather than assuming `App.js`; use what you find.
- **No frontend unit tests**: the repo has no React test harness; frontend tasks use explicit manual verification instead of inventing one. Backend logic is covered by `node:test`.
- **DOCKER_API_VERSION=1.41** is carried over from the old `composeUp` for older-daemon compatibility (osiris runs Docker 20.10).
