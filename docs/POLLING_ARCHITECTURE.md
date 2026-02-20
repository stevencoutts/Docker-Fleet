# Polling architecture (DB-backed cache)

Data is kept in the database at all times. The web app loads only from the DB. A background poller syncs Docker/SSH data into the DB.

## Flow

1. **Background poller** (`backend/src/services/polling.service.js`)
   - Runs on a fixed interval (default 30s; set `POLLING_INTERVAL_MS` or `DOCKERFLEET_POLLING_INTERVAL_MS`, min 5000).
   - For each server: fetches container list and host info via SSH/Docker, writes to `server_container_cache` and `server_host_info_cache`.
   - Emits WebSocket events: `server:containers:updated`, `server:hostinfo:updated` so the frontend can refetch from the API.

2. **API**
   - `GET /api/v1/servers/:serverId/containers` → reads from `server_container_cache` (no SSH).
   - `GET /api/v1/servers/:serverId/host-info` → reads from `server_host_info_cache` (no SSH).
   - After start/stop/restart/remove container, the backend triggers an immediate sync for that server so the cache updates quickly.

3. **Frontend**
   - No short-interval polling. Fetches once on load, then refetches when it receives WebSocket events or on a long fallback interval (e.g. 60s).
   - Dashboard: listens for `server:containers:updated`, `server:hostinfo:updated`, `container:status:changed`; fallback refetch every 60s.
   - Server details: listens for `server:containers:updated`, `server:hostinfo:updated`, `container:status:changed` for that server; host info fallback 60s.

## DB tables

- **server_container_cache**: `(server_id, container_id)` + `payload` (JSONB, same shape as listContainers item) + `updated_at`.
- **server_host_info_cache**: `server_id` (PK) + `host_info` (JSONB) + `updated_at`.

## Efficiency

- SSH/Docker only in the background poller, one sync per server per interval.
- Web requests are DB-only, so they stay fast and don’t block on SSH.
- User actions (start/stop/restart/remove) trigger an immediate sync for that server so the UI updates without waiting for the next interval.
