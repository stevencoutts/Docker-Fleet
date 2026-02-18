## DockerFleet Manager v1.0.0

### 🎉 Initial Stable Release

DockerFleet Manager is a production-ready web application for managing Docker containers across multiple remote servers via SSH.

### ✨ Key Features

- **Multi-Server Management**: Manage Docker containers on multiple remote servers
- **SSH-Based Access**: Secure SSH key authentication for remote server access
- **Real-Time Monitoring**: Live container status updates and resource monitoring
- **Container Management**: Start, stop, restart, remove containers with ease
- **Container Grouping**: Organize containers with user-defined grouping rules
- **Live Logs**: Stream container logs in real-time
- **Container Console**: Interactive terminal access to containers
- **Snapshot Management**: Create and restore container snapshots
- **Email Alerts**: Configurable email notifications for container issues
- **User Management**: Multi-user support with role-based access control
- **Modern UI**: Beautiful, responsive interface with dark/light mode

### 📦 Installation

1. Clone the repository
2. Copy `.env.example` to `.env` and configure
3. Run `docker-compose up -d`

See README.md for detailed installation instructions.

### 🔧 Technical Stack

- **Frontend**: React.js with Tailwind CSS
- **Backend**: Node.js with Express
- **Database**: PostgreSQL
- **Containerization**: Docker & Docker Compose

### 📝 Changelog

#### Recent (post–v1.0)

- **Image updates and version tracking**
  - Check for image updates per container (digest and registry tags); pull & update recreates the container with the latest image.
  - Version numbers are read from image labels (`build_version`, `org.opencontainers.image.version`, etc.) and shown in the UI; after a successful update the UI shows previous → new version.
  - Each successful pull-and-update is logged to `logs/container-updates.log` (JSON lines with timestamp, server, container, image refs, and versions).
- **Update-availability logic**
  - Only suggests a “newest” tag when it’s within one major version (e.g. avoids suggesting 8.x when you’re on 3.x).
  - When your image digest already matches the registry, “Update available” is shown only if we have a resolved/tag version that is strictly older than the newest tag (avoids false updates for `latest` with same digest or for tags like 0.4 that point to the same image as 0.4.208).
  - For floating tags (`latest`, `dev`), resolved version from image labels is used so same-version checks are accurate.
- **Snapshot restore to another host**
  - Restore modal includes a “Restore to server” dropdown; you can restore a snapshot to a different Docker host. The image is exported on the source server, transferred, and loaded on the target server, then a new container is created there.
  - Port mappings from the current container are applied when restoring (same host or different host), so the new container gets the same host port bindings.
- **Container details loading**
  - Shorter timeouts for container details (15s backend, 20s frontend) and a Retry button with a clear error message if the request times out.

See git log for full commit history.

### 🐛 Known Issues

None at this time.

### 🙏 Credits

Built by [Steven Coutts](https://stevec.couttsnet.com)
