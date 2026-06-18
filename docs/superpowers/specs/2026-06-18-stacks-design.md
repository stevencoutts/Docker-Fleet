# DockerFleet — Centralized Stack Management (Stacks)

> Design spec · 2026-06-18 · Status: approved for planning

## Problem

Compose files are scattered across hosts (e.g. on `osiris`: `~/Docker/<app>/`,
`~/docker-compose.yml`, `/pds/compose.yaml`, plus per-repo files). There is no
single place to see, edit, or deploy them. DockerFleet today can deploy a compose
YAML via `POST /servers/:id/compose/up` (piped to `docker compose -f - up -d`),
but the YAML is **not stored** — it's fire-and-forget, with no `.env` support and
no recovery. The `TODO.md` already points here: *"Minimise docker compose yaml,
move env variables to app configuration gui."*

## Goal

Make compose stacks a first-class, **DB-backed** entity in DockerFleet: store
each stack's compose YAML + structured env centrally, deploy it to its host,
manage its lifecycle, and **import** the stacks already running on a host so the
scattered files can be adopted in one pass.

## Scope

**In scope**
- Image-only stacks (compose files that reference prebuilt `image:`s).
- DB as the source of truth for compose YAML + env.
- Structured, per-key env with secret encryption at rest.
- Guided import of existing compose projects on a host.
- Lifecycle: deploy/up, pull+deploy, down, restart, edit→redeploy, delete, logs.

**Out of scope (YAGNI)**
- Build-from-source stacks (`build:`). These keep their existing repo + compose
  workflow; DockerFleet may still deploy them via the existing app-config style
  `git pull && compose up`, but that is not part of this feature.
- Git-backed stack storage.
- Multi-host / replicated stacks.
- Editing *unmanaged* stacks in place — unmanaged projects are read-only until
  imported.

## Architecture overview

```
DockerFleet (DB = source of truth)
  Stack { compose_yaml, env[] }  ──deploy──▶  host:/opt/dockerfleet/stacks/<name>/
                                                ├── compose.yaml   (rendered)
                                                └── .env           (rendered, secrets decrypted)
                                              docker compose -p <name> --env-file .env -f compose.yaml up -d
```

- Deploy writes files on the host (base64-transferred over SSH, decoded
  host-side) and runs compose from the managed directory. This **supersedes** the
  stdin-piped `composeUp` (which cannot support `.env` files or recovery).
- Live running state continues to come from the existing container
  cache/polling; the Stack row only records the **last DockerFleet action**
  outcome, so we don't introduce a competing source of truth for "is it up".

## Data model

Two new tables, following existing conventions (UUID PKs, snake_case `field:`
mapping, CASCADE FKs to `servers`, Sequelize migrations).

### `stacks` (model `Stack`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID PK | `UUIDV4` |
| `server_id` | UUID FK → `servers` | `onDelete: CASCADE` |
| `name` | STRING | compose project name; validated by existing `COMPOSE_PROJECT_NAME_REGEX` |
| `compose_yaml` | TEXT | source of truth |
| `deploy_path` | STRING(512) | host dir; default `/opt/dockerfleet/stacks/<name>` |
| `source` | STRING | `created` \| `imported` |
| `last_deployed_at` | DATE nullable | |
| `last_deploy_status` | STRING nullable | `deployed` \| `stopped` \| `error` |
| `created_at` / `updated_at` | DATE | |

Unique index `(server_id, name)`.

### `stack_env_vars` (model `StackEnvVar`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID PK | |
| `stack_id` | UUID FK → `stacks` | `onDelete: CASCADE` |
| `key` | STRING | |
| `value` | TEXT | encrypted at rest via `encryption.js` when `is_secret` |
| `is_secret` | BOOLEAN | default `false` |
| `created_at` / `updated_at` | DATE | |

Unique index `(stack_id, key)`.

**Secret handling:** secret values are encrypted at rest and **never returned in
plaintext** by the API; the UI shows them masked, and a blank value on edit means
"keep existing". Plaintext is decrypted server-side only at deploy time to render
`.env`. Non-secret values are stored/returned as-is.

**Rationale**
- Env as rows (not a single blob): enables per-key masking and the structured GUI
  editor the TODO asks for.
- No duplicated live status: avoids a second source of truth versus polling.

## Backend

New module `backend/src/modules/stacks/` (`stacks.routes.js`,
`stacks.controller.js`) and `backend/src/services/stack.service.js`. Reuses
`ssh.service.js`, `docker.service.js`, `encryption.js`, `shellSafe.js`,
`validation.middleware.js`, `error.middleware.js`.

### Endpoints

| Method · path | Purpose |
|---|---|
| `GET /stacks` | List all managed stacks (optional `?serverId`); env keys with secrets masked. |
| `POST /stacks` | Create (`serverId`, `name`, `composeYaml`, `env[]`). |
| `GET /stacks/:id` | Detail — compose YAML + env (secrets masked). |
| `PUT /stacks/:id` | Update YAML / env / name. Blank secret = keep existing. |
| `DELETE /stacks/:id` | Remove from DB; `?down=true` also `compose down` + remove host dir. |
| `POST /stacks/:id/deploy` | Render files + `compose up -d`; `?pull=true` → `compose pull` first. |
| `POST /stacks/:id/down` | `compose down`. |
| `POST /stacks/:id/restart` | restart (down+up or `compose restart`). |
| `GET /servers/:id/stacks/discover` | `docker compose ls` on host → projects tagged managed/unmanaged (cross-ref DB). |
| `POST /servers/:id/stacks/import` | Read selected projects' compose + env files over SSH, parse, create rows. |

Mutations are admin-only (matching proxy-route/RBAC pattern). Logs reuse the
existing container-logs WebSocket, selecting a stack's containers by the
`com.docker.compose.project` label — no new streaming code.

### Deploy mechanism (`stack.service.js`)

1. `mkdir -p <deploy_path>` on host.
2. Write `compose.yaml` and `.env`, transferred **base64-encoded** over SSH and
   decoded host-side (content cannot break shell quoting or inject commands).
3. `docker compose -p <name> --env-file .env -f compose.yaml up -d [--pull]`.
4. Record `last_deployed_at` / `last_deploy_status`; on failure keep files and
   surface stderr.

### Import

- `docker compose ls --format json` → for each project, read the `ConfigFiles`
  paths plus any referenced `env_file`/`.env` over SSH.
- Parse env into `stack_env_vars` rows; **auto-flag likely secrets** (keys
  matching `PASSWORD|SECRET|TOKEN|KEY|PASS|API`) as `is_secret`.
- Per-project `try/catch`: partial success reports which imported and which
  failed (unreadable file, unparseable YAML, permission).

### Security

- Commands built via `shellSafe.js`.
- `name` validated by `COMPOSE_PROJECT_NAME_REGEX`.
- `deploy_path` constrained to the `/opt/dockerfleet/stacks/` base (no traversal).
- Secret plaintext never crosses the API boundary.

### Migration of existing endpoint

`POST /servers/:id/compose/up` (stdin-piped) is superseded. Its single frontend
caller (the "docker-compose.yml container install") is repointed to
`POST /stacks` + `POST /stacks/:id/deploy`.

## Frontend

Conventions: `pages/*.js`, `services/*.service.js` (axios via `api.js`),
reusable `LogsModal` / `ServerSelector`.

- **`pages/Stacks.js`** — central catalog: table of every managed stack across
  servers (name, server, last-deploy status, last-deployed), filter by server via
  `ServerSelector`. Row actions: Deploy, Pull+Deploy, Down, Restart, Logs, Edit,
  Delete.
- **`StackEditor`** (page or modal) — compose YAML editor + structured env table
  (key / value / secret toggle); secrets masked; blank-on-edit keeps existing.
- **`StackImportModal`** — pick server → `discover` → checkbox list of unmanaged
  projects → import selected.
- **`services/stacks.service.js`** — axios client; reuse `LogsModal` for stack
  logs.
- Nav + route entry, guarded; mutations admin-only.

## Error handling

- Deploy is two-phase; `compose up` failure leaves files in place, sets
  `last_deploy_status = error`, surfaces stderr to the UI.
- Import: per-project try/catch with a partial-success report.
- SSH/host-unreachable errors propagate via `error.middleware.js`.

## Testing

- **Unit (pure logic):** `.env` rendering incl. encryption round-trip + masking;
  compose command builder (`-p` / `--env-file` / `-f`, `shellSafe` quoting);
  import parser (`docker compose ls` JSON → files → env parse → secret flagging).
- **Integration:** stack controller endpoints with `ssh.service` mocked — deploy
  success/failure, secret never returned in plaintext, name validation,
  path-traversal rejection.
- Follow the repo's existing test runner (confirm exact harness during planning).

## Open items to confirm during planning

- Exact test harness / how migrations are run in CI.
- Whether `StackEditor` is a full page or a modal (UI preference).
- Default deploy base path (`/opt/dockerfleet/stacks/`) — confirm it doesn't
  collide with anything on the managed hosts.
