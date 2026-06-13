# Public WWW (Nginx proxy + Let's Encrypt)

On a host with a public IP you can enable **Public WWW** so that:

- The host is only reachable on **ports 80 and 443** (and SSH). Firewall (UFW) allows only SSH, 80, 443; default deny incoming so **Docker-mapped ports (e.g. 8083, 8084) are blocked** from the public internet. Any existing allow rules for other ports are removed when you Enable.
- **Nginx** runs as a reverse proxy and forwards each configured domain to a container port (e.g. `app.example.com` → `localhost:8080`).
- **Let's Encrypt** is used to obtain TLS certificates for each domain (HTTP → HTTPS redirect).

## Requirements

- Host: Debian/Ubuntu (apt). The backend installs **host** nginx and certbot (`apt-get install nginx certbot python3-certbot-nginx`) and, if missing, UFW.
- SSH access with sudo (the deploy user must be able to run `sudo ufw`, `sudo tee`, `sudo nginx`, `sudo certbot`).
- DNS: each domain must point to the host’s public IP before enabling or syncing (Let’s Encrypt will validate the domain).

**Nginx in containers vs host:** If you see nginx in `ps` with `daemon off`, that is nginx **inside a container**. Public WWW installs **system nginx on the host** as the reverse proxy. Ports 80/443 must be free on the host; stop any container binding directly to 80/443 if you want host nginx to use them.

### Docker ports still open from the internet?

UFW is set to allow only 22, 80, 443 and to explicitly deny common container ports (e.g. 8080–8095, 3000, 5000). Even so, **Docker adds its own iptables rules** when you publish ports; on many systems those rules are evaluated before UFW, so ports like 8083 or 8084 can still appear open to the internet (e.g. `nmap` shows them).

**Reliable fix:** in your app’s **docker-compose**, bind published ports to **127.0.0.1** only so they are not listening on the public interface. Nginx on the host can still proxy to `127.0.0.1:PORT`.

```yaml
ports:
  - "127.0.0.1:8083:80"    # only localhost; nginx can proxy to this
  - "127.0.0.1:8084:8083"
```

Avoid `"8083:80"` (which binds to `0.0.0.0:8083` and can be reached from the internet despite UFW on some setups). After changing to `127.0.0.1:...`, redeploy the stack and run **Sync config** so nginx keeps proxying to the same ports.

If you see **port 53** (or others) open, that is from another service (e.g. Pi-hole). To expose only 22, 80, 443, either bind that service to 127.0.0.1 or add a UFW deny for that port and re-enable Public WWW.

## Configuration

- **Backend:** Set `LETSENCRYPT_EMAIL` (or `DOCKERFLEET_LETSENCRYPT_EMAIL`) for Let’s Encrypt agreement (e.g. `admin@example.com`).
- **UI:** Server details → **Public WWW**: add proxy routes (domain, container name, container port), then click **Enable Public WWW**.

## Debugging timeouts

If Enable times out (e.g. on slow or constrained hosts):

1. **Watch backend logs** to see which command ran and what output was captured when it timed out:
   - **Docker:** `docker logs -f dockerfleet-backend`
   - **Local:** tail the backend `logs/combined.log` (and stderr) while you click Enable.

   You’ll see lines like:
   - `Public WWW: running command` with `label`, `timeoutMs`, and `commandPreview`
   - On timeout: `SSH command timed out` with `host`, `timeoutMs`, `commandPreview`, `stdoutTail`, and `stderrTail` (last 800 chars of output so you can see if apt was still downloading or waiting for input).

2. **Increase the apt timeout** for slow networks or first-run installs. In the backend environment set:
   - `PUBLIC_WWW_APT_TIMEOUT_MS=600000` (10 minutes)
   Then restart the backend and try Enable again.

3. **"Unable to resolve host X: Temporary failure in name resolution"** – If logs show this and commands time out, the host’s hostname (e.g. `finland`) is not in `/etc/hosts`, so `sudo` blocks on DNS. Enable now runs a first step that adds `127.0.0.1 <hostname>` to `/etc/hosts` using `sudo -h localhost`. If that still times out (e.g. old sudo), on the host run once: `echo "127.0.0.1 $(hostname)" | sudo tee -a /etc/hosts` (over SSH with a session that already has working DNS or after fixing DNS), then try Enable again.

## Behaviour

- **Enable:** Ensures the host’s hostname resolves (adds it to `/etc/hosts` if needed), configures UFW so only 22, 80, 443 are allowed (removes any other allow rules so Docker ports stay blocked), installs nginx and certbot if needed, writes nginx config from current proxy routes, reloads nginx, runs certbot for each domain, sets `publicWwwEnabled` on the server.
- **Sync:** Rewrites nginx config from current routes, reloads nginx, runs certbot for any new domains.
- **Disable:** Removes the generated nginx config and reloads nginx; sets `publicWwwEnabled` to false. UFW is **not** reverted (ports 80/443 may still be open).

## DNS certificate (Get cert (DNS))

To get a certificate via DNS-01 (e.g. for wildcards or when HTTP isn’t reachable): add a proxy route, open **Get cert (DNS)**, enter the domain (and optionally “Include wildcard”), then click **Request challenge**. Add the TXT record at your DNS provider and click **I’ve added the record – Continue**.

**If the challenge never appears** (e.g. backend logs say “runner did not start”): the runner may not start in the background over SSH on some hosts. As a fallback, on the **server** run once:

```bash
sudo /tmp/certbot-dns-runner.sh
```

Leave it running. When the TXT record name and value appear in the UI (or in `/tmp/certbot-dns-name.txt` and `/tmp/certbot-dns-value.txt` on the server), add the record at your DNS provider. Then either: create the continue file so certbot proceeds (`sudo touch /tmp/certbot-dns-continue`), or click **Continue** in the UI (which does the same). The runner will then finish and the certificate will be installed.

**Renewing DNS-validated certificates:** **Renew certificates** opens the same guided flow (TXT record + **I've added the record – Continue**) instead of a blocking error. Use **Renew (DNS)** on a domain, or **Request challenge** with force renewal when re-issuing before expiry.

## Certbot renew failures (CrowdSec, rate limits)

If `certbot renew` prints **Could not parse file: /etc/nginx/conf.d/crowdsec_nginx.conf** (or similar), the certbot **nginx** plugin uses a strict config parser that does not understand CrowdSec/OpenResty/Lua directives (`init_by_lua`, etc.). Nginx itself may still run fine.

**Workaround** (after any Let's Encrypt rate limit has cleared):

```bash
sudo mv /etc/nginx/conf.d/crowdsec_nginx.conf /tmp/crowdsec_nginx.conf.bak
sudo nginx -t && sudo certbot renew --cert-name mtx.couttsnet.com
sudo mv /tmp/crowdsec_nginx.conf.bak /etc/nginx/conf.d/crowdsec_nginx.conf
sudo nginx -t && sudo systemctl reload nginx
```

**Rate limit** (`too many failed authorizations`): Let's Encrypt blocks new attempts for that hostname for about an hour. Do not click **Renew certificates** or run `--force-renewal` repeatedly — wait until the time shown in the error (`retry after … UTC`), fix nginx/certbot first, then try once.

Longer term: keep CrowdSec snippets outside `conf.d` (e.g. include from `nginx.conf` only), or renew mtx with a non-nginx authenticator (webroot/standalone) if you change the renewal config.

### HTTP-01 returns 404 for `.well-known/acme-challenge`

Let's Encrypt reached your server (often via IPv6) but nginx returned **404**. Common causes:

1. **No `server_name` for that host on port 80** — e.g. `mtx.couttsnet.com` has a cert in `/etc/letsencrypt/live/` but no **proxy route** in Public WWW, so only `default_server` answers and the challenge fails.
2. **Fix:** In the UI add a proxy route for that domain (point at the real backend), click **Sync config**, then renew. Or, after upgrading dockerMgmr, **Sync config** alone adds a minimal port-80 block for certs that exist on disk but have no route.
3. Confirm: `curl -4 -I http://mtx.couttsnet.com/.well-known/acme-challenge/test` and `curl -6 -I ...` (expect 404 for a fake token, not connection refused).

### Domain already in `sites-enabled` (e.g. Matrix / mtx)

If `grep mtx /etc/nginx/sites-enabled/` shows a vhost (common for Synapse), **do not** add a duplicate Public WWW route unless you intend to migrate that site into `dockerfleet-proxy.conf`. Renewal must work in the **existing** file (e.g. `/etc/nginx/sites-enabled/matrix`).

Let's Encrypt often validates over **IPv6**. If the matrix vhost has `listen 80` but not `listen [::]:80`, requests can hit dockerMgmr's `default_server` on IPv6 and return 404. Add to the **port 80** `server` block in `sites-available/matrix`:

```nginx
listen [::]:80;
```

Ensure that block exists (not only 443), reload nginx, then:

```bash
sudo certbot renew --cert-name mtx.couttsnet.com
```

Inspect the live config: `sudo nginx -T 2>/dev/null | grep -A25 'server_name mtx'`

## Existing nginx (`sites-enabled`) on the host

If Public WWW was **enabled** while nginx already had vhosts, Docker Fleet **imports routes** but leaves `sites-enabled` unchanged — **`/etc/nginx/conf.d/dockerfleet-proxy.conf` is not created until you click Sync config**.

On **Sync**, domains already in **sites-enabled** or other `conf.d` files (except `dockerfleet-proxy.conf`) are **not** duplicated in `dockerfleet-proxy.conf` — the host vhost keeps serving them. New routes like `sow.example.com` with no `sites-enabled` block are written to `dockerfleet-proxy.conf` on each sync.

If a Docker Fleet route points at the wrong backend (e.g. apex `couttsnet.com` → Bluesky PDS), change or remove that route in the UI; Sync will not override an existing `sites-enabled` vhost for the same name.

New routes with a DNS cert still need **Sync config** once so HTTPS is configured on the server.

**Sync config** rewrites `dockerfleet-proxy.conf` from routes and installed certs. It does **not** run `certbot --nginx` on domains that already have a certificate (including DNS-validated certs like sow) — that previously mutated the nginx file and could break redirects/backends.

## Proxy routes

Each route maps a **domain** to a **container name** and **port** on the same host. Nginx listens on 80/443 and `proxy_pass`es to `http://127.0.0.1:<containerPort>`. The container must be listening on that port (e.g. bind to `0.0.0.0:8080`).

**Static root (optional):** Set e.g. `/var/www` on a route to serve `index.html` from that path on the host for `/`. Leave empty to proxy `/` to the main container port.

**PDS port (optional):** Set e.g. `6010` when Bluesky/AT Protocol paths must hit a different backend than `/`. Nginx always proxies **`/xrpc/`** and **`/.well-known/`** to this port when set (otherwise they use the main container port).

**Example — apex site + monitor + Bluesky PDS on one domain:**

| Field | Value |
|-------|-------|
| Proxy | `couttsnet-monitor:3001` |
| PDS port | `6010` |
| Static root | `/var/www` (optional; omit to serve the monitor at `/`) |

After saving, click **Sync config** on the server.
