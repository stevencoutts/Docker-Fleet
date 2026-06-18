# Stacks (Docker Compose Management)

A **Stack** is a centralized Docker Compose project managed in DockerFleet. Store and version control your `docker-compose.yaml` and environment variables in the app, deploy to any host via SSH, and import existing compose projects from remote servers.

## Overview

Stacks are image-based only — building images from source repositories is out of scope. Use stacks to manage deployment of pre-built images across your infrastructure.

- **DB is source of truth**: Stack configuration (compose YAML, environment variables) is stored in the database. Hosts have no persistent state; redeploying overwrites the stack directory.
- **Encrypted secrets**: Environment variables that look like secrets are encrypted at rest. Secrets are never returned in plaintext via the API; on edit, blank secret fields retain their existing encrypted value.
- **Deploy to hosts**: Write the compose YAML and a generated `.env` file to `/opt/dockerfleet/stacks/<name>/` on the host via SSH (base64-encoded), then run `docker compose -p <name> --env-file .env -f compose.yaml up -d`.
- **Import existing stacks**: Discover compose projects on a host with `docker compose ls`, read their `compose.yaml` and `.env` over SSH, auto-flag secret-like keys, and import into DockerFleet.
- **Guided lifecycle**: Start, stop, restart, or remove stacks on any host without leaving the app.

## Secret Masking and Encryption

Environment variables with names matching common secret patterns (e.g. `*PASSWORD*`, `*TOKEN*`, `*KEY*`, `*SECRET*`, `*API_KEY*`) are flagged as secrets:

- **Encrypted at rest** in the database using the app's encryption key.
- **Never returned in plaintext** via the API or UI — replace with a placeholder (e.g. `[REDACTED]`).
- **Editing secrets**: Leave the secret field blank to keep the existing encrypted value; enter a new value to update it.
- **Importing secrets**: When importing a stack from a host, secret-like keys are automatically flagged and encrypted on import.

## Deploying a Stack

1. **Create or edit a stack**: Paste or write your `docker-compose.yaml` and add environment variables.
2. **Click Deploy**: The app generates a `.env` file from your variables, base64-encodes both files, sends them to the host via SSH, and writes them to `/opt/dockerfleet/stacks/<stackName>/`.
3. **Run compose up**: The host executes `docker compose -p <stackName> --env-file .env -f compose.yaml up -d` to start all services.
4. **Logs and status**: View real-time logs and container status from the app.

## Importing Existing Stacks

The **Discover** endpoint lists existing docker-compose projects on a host using `docker compose ls`. For each project:

1. Read the `compose.yaml` and `.env` over SSH.
2. Parse environment variables and auto-flag secrets.
3. Store in DockerFleet (encrypted).

**Note**: Imported stacks are now managed by DockerFleet. If you redeploy, the host's directory is overwritten.

## REST Endpoints

### Stack CRUD

- `GET /api/v1/stacks` — List all stacks
- `POST /api/v1/stacks` — Create stack (`{ name, composeYaml, env: { KEY: 'value', ... } }`)
- `GET /api/v1/stacks/:id` — Get stack details (env secrets redacted)
- `PUT /api/v1/stacks/:id` — Update stack (keep existing secrets blank)
- `DELETE /api/v1/stacks/:id` — Delete stack (keeps files on hosts unless removed via lifecycle endpoint)

### Stack Lifecycle

- `POST /api/v1/stacks/:id/deploy` — Write files and run `docker compose up -d`
- `POST /api/v1/stacks/:id/down` — Run `docker compose down`
- `POST /api/v1/stacks/:id/restart` — Run `docker compose restart`

### Discovery & Import

- `POST /api/v1/servers/:id/stacks/discover` — List compose projects on a host
- `POST /api/v1/servers/:id/stacks/import` — Import a compose project (`{ projectName }`)

## Example Workflow

1. **Create a stack**:
   ```bash
   POST /api/v1/stacks
   {
     "name": "my-app",
     "composeYaml": "version: '3.8'\nservices:\n  web:\n    image: nginx:latest\n    ports:\n      - '8080:80'",
     "env": {
       "ENVIRONMENT": "production",
       "DB_PASSWORD": "secret123"
     }
   }
   ```

2. **Deploy to a host**:
   ```bash
   POST /api/v1/stacks/:id/deploy?serverId=<serverId>
   ```

3. **Discover and import an existing stack** from another host:
   ```bash
   POST /api/v1/servers/:id/stacks/discover
   # Returns [{ "projectName": "legacy-app", ... }]
   
   POST /api/v1/servers/:id/stacks/import
   { "projectName": "legacy-app" }
   ```

4. **View logs** via the container dashboard (all containers in the stack appear as normal containers).

5. **Manage the stack** (stop, restart, redeploy) from the UI or via endpoints.
