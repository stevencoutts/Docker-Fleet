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

## Proxy routes

Each route maps a **domain** to a **container name** and **port** on the same host. Nginx listens on 80/443 and `proxy_pass`es to `http://127.0.0.1:<containerPort>`. The container must be listening on that port (e.g. bind to `0.0.0.0:8080`).
