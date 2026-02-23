# Security Review Report — Docker Fleet Manager

**Date:** 2026-02  
**Scope:** Full codebase (backend Node/Express, frontend React, auth, SSH, Tailscale, backups).  
**Remediation:** Fixes applied on branch `security/fixes` (2026-02).

---

## Executive Summary

| Severity | Count | Main topics | Status |
|----------|--------|-------------|--------|
| **Critical** | 1 | Host-level command injection via `executeCommand` (`containerId` / `shell`) | **Fixed** |
| **High** | 6 | Command injection in docker.service (more/less, pullImage, removeImage, commitContainer, exportImage, createContainerFromImage ports) | **Fixed** |
| **Medium** | 5 | JWT/encryption default secrets; backup import validation; snapshot download filename; encryption fixed salt; rate limit config | **Fixed** |
| **Low** | 4 | Refresh validation; backup-schedules validation; CORS; general validation gaps | **Fixed** (refresh + backup-schedules; CORS unchanged) |
| **Info** | 2 | Logging care; run npm audit | Addressed / documented |

**Critical (fixed):** Command injection in `executeCommand` and all other user-controlled arguments to shell in `docker.service.js` are now validated via `backend/src/utils/shellSafe.js` (allowlist/escape) and invalid input returns 400 via `INVALID_INPUT` in error middleware.

**Dependencies:** Backend `npm audit --production`: **0 vulnerabilities**. Frontend: **2 high** (jsonpath/bfj); `npm audit fix` run — no fix available (transitive from react-scripts; jsonpath has no patched version per advisory).

### Summary of fixes (branch `security/fixes`)

| Area | Files / change |
|------|-----------------|
| Command injection | New `backend/src/utils/shellSafe.js`; `backend/src/services/docker.service.js` uses validators + `escapeSingleQuoted`; `listContainers` uses `filterValidContainerIds` |
| Encryption salt | `backend/src/utils/encryption.js`: random salt per encrypt, stored in payload; decrypt supports legacy salt |
| Backup import | `backend/src/modules/backup/backup.controller.js`: max payload 5MB, max array lengths (servers, routes, grouping, schedules, jobs) |
| Snapshot filename | `backend/src/modules/containers/containers.controller.js`: sanitize `Content-Disposition` filename |
| Rate limit | `backend/src/app.js`: general + auth limiters use `config.rateLimit` |
| Production secrets | `backend/src/app.js`: warn on missing JWT/encryption secrets when `NODE_ENV=production` |
| Refresh validation | `backend/src/modules/auth/auth.controller.js` + `auth.routes.js`: `refreshValidation` on POST /auth/refresh |
| Backup-schedules validation | `backend/src/modules/backup-schedules/backup-schedules.controller.js`: max targets, scheduleConfig schema/size |
| INVALID_INPUT handling | `backend/src/middleware/error.middleware.js`: 400 response for `err.code === 'INVALID_INPUT'` |

---

## 1. Authentication & Authorization

- **API routes:** All non-auth routes sit behind `router.use(authenticate)` in `backend/src/routes/index.js`. Only `/auth/setup`, `/auth/login`, `/auth/register`, `/auth/refresh` are public; `/auth/me` uses `authenticate` in its route.
- **Ownership:** Server, container, image, backup, backup-schedules, grouping, monitoring, and user operations all scope by `userId: req.user.id` or admin check. No cross-user access found.
- **WebSocket:** Socket.IO middleware verifies JWT; `stream:logs` and `stream:stats` load server with `userId: socket.userId`. No cross-user access.
- **JWT:** Secrets from env; no in-code secrets. **Medium (fixed):** Startup now logs a strong warning when `NODE_ENV=production` and `JWT_SECRET`/`JWT_REFRESH_SECRET` or `ENCRYPTION_KEY` are not set (`backend/src/app.js`).
- **Refresh:** **Low (fixed)** — express-validator added for `POST /auth/refresh`: `refreshValidation` with `body('refreshToken').notEmpty().isString()` in `auth.controller.js` and applied in `auth.routes.js`.

---

## 2. Injection & Input Validation

### Critical / High — Command injection (backend/src/services/docker.service.js) — **FIXED**

User- and route-controlled input was concatenated into shell commands; all such inputs are now validated/escaped.

| Location | Input | Risk | Remediation |
|----------|--------|------|-------------|
| `executeCommand` | `containerId`, `shell` from params/body | **Critical** | `validateContainerId`, `validateShell`; args for more/less wrapped with `escapeSingleQuoted` |
| `executeCommand` | `args` for more/less | **High** | `escapeSingleQuoted(args)` |
| `pullImage` | `imageName` from body | **High** | `validateImageName`, command uses `escapeSingleQuoted(safeName)` |
| `removeImage` | `imageId` from params | **High** | `validateImageId`, safe id in command |
| `commitContainer` | `imageName`, `tag` from body | **High** | Validated; `escapeSingleQuoted(fullImageName)` |
| `exportImage` | `imageName`, `outputPath` | **High** | `validateImageName`, `validateExportPath`; safe values in command |
| `createContainerFromImage` | `options.ports` | **High** | Each port passed through `validatePortMapping` |
| `listContainers` (inspect) | IDs from docker ps | — | IDs filtered with `filterValidContainerIds` (DOCKER_ID_REGEX) before `docker inspect` |

**Implemented:** New `backend/src/utils/shellSafe.js` provides validators (`validateContainerId`, `validateImageId`, `validateShell`, `validateImageName`, `validateTag`, `validatePortMapping`, `validateExportPath`) and `escapeSingleQuoted`. Invalid input throws with `err.code = 'INVALID_INPUT'`. Global error middleware returns 400 for `INVALID_INPUT` without leaking stack.

### Database

- Sequelize used with parameterized queries; no raw SQL with user input. No SQL injection identified.

### Validation gaps

- **Backup import (fixed):** Max payload size (5MB), max array lengths for servers, proxy routes, grouping rules, schedules, jobs. Basic structure checks in `backend/src/modules/backup/backup.controller.js` (importData).
- **Backup schedules (fixed):** Bulk create limited to 200 targets; `scheduleConfig` must be object with max keys and max JSON size. Update job validates `scheduleConfig` same way. `backend/src/modules/backup-schedules/backup-schedules.controller.js`.
- **Containers:** Execute, deploy, recreate, etc.: injection risk covered by shellSafe in docker.service; invalid input returns 400 via INVALID_INPUT.
- **Images / proxy routes:** Shell-side validation in docker.service for imageName/imageId; domain etc. remain low priority.

### XSS (frontend)

- No `dangerouslySetInnerHTML` or `innerHTML` found. User-controlled URLs/content should be validated/sanitized if added later.

---

## 3. Secrets & Sensitive Data

- **Secrets:** All from env via `config`; `.env` gitignored. No hardcoded secrets.
- **SSH keys:** Stored encrypted (aes-256-gcm); controllers strip `privateKeyEncrypted` from API responses. **Medium (fixed):** `backend/src/utils/encryption.js` now uses a random salt per encryption, stored in the payload (`salt`); decrypt uses stored salt with fallback to legacy `'salt'` for backward compatibility.
- **Logging:** No passwords, tokens, or keys logged; avoid logging `req.body`/Authorization in future.

---

## 4. API & Infrastructure

- **CORS:** Allowlist of origins; credentials enabled. Private IP ranges allowed; tighten if app has a single known origin.
- **Helmet:** Applied. Good.
- **Rate limiting (fixed):** General API limiter now uses `config.rateLimit.max` and `config.rateLimit.windowMs`; auth limiter uses same window. Stricter production defaults via config (e.g. 100 req/window).
- **Errors:** Stack traces only in development. Errors with `err.code === 'INVALID_INPUT'` return 400 with safe message only (`backend/src/middleware/error.middleware.js`).
- **Snapshot download (fixed):** `Content-Disposition` filename sanitized in `containers.controller.js`: control chars, `\`, `"`, newlines replaced with `_`; length capped at 200; fallback `snapshot.tar` if empty.

---

## 5. Dependencies

- **Backend:** `npm audit --production` → 0 vulnerabilities.
- **Frontend:** 2 high (jsonpath, bfj transitive from react-scripts). `npm audit fix` run; no fix available — jsonpath has no patched version per advisory (all versions affected). Risk accepted as transitive; re-evaluate when react-scripts/upstream changes.
- Re-run audit and `npm update` regularly.

---

## 6. Access Control

- All server/container/image/backup/grouping/monitoring/user operations enforce ownership or admin. No endpoint found that allows cross-user access without an explicit check.

---

## Recommended Action Order (remediation status)

1. **Critical:** Fix command injection in `docker.service.js` — **Done** (shellSafe.js + docker.service.js).
2. **High:** Fix remaining command-injection points — **Done** (all listed locations).
3. **High (frontend):** Run `npm audit fix` in frontend — **Done**; remaining 2 high are transitive, no patch available.
4. **Medium:** Production secrets warning; random salt for encryption; backup import validation; snapshot filename sanitization; config for rate limit — **Done**.
5. **Low:** Add validation for refresh, backup-schedules — **Done**. CORS and other validation gaps left as-is per original low rating.
