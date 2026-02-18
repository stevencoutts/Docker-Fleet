# Release Process Guide

This guide explains how to create a proper v1.0 release for DockerFleet Manager.

## Prerequisites

1. Ensure all changes are committed and pushed to `main`
2. Verify the codebase is stable and tested
3. Update version numbers if needed (already at 1.0.0 in package.json files)

## Step 1: Create Git Tag

Create an annotated tag for v1.0.0:

```bash
git tag -a v1.0.0 -m "Release version 1.0.0 - Initial stable release"
```

Push the tag to GitHub:

```bash
git push origin v1.0.0
```

## Step 2: Build and Tag Docker Images

Build the Docker images with version tags:

```bash
# Build with version tag
docker-compose build

# Find the actual image names (Docker Compose names them based on directory name)
# Replace 'dockermgmr' with your actual directory name if different
BACKEND_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "backend.*latest" | head -1)
FRONTEND_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "frontend.*latest" | head -1)

# Extract base names
BACKEND_BASE=$(echo $BACKEND_IMAGE | cut -d: -f1)
FRONTEND_BASE=$(echo $FRONTEND_IMAGE | cut -d: -f1)

# Tag with version
docker tag ${BACKEND_IMAGE} ${BACKEND_BASE}:1.0.0
docker tag ${FRONTEND_IMAGE} ${FRONTEND_BASE}:1.0.0
docker tag ${BACKEND_IMAGE} ${BACKEND_BASE}:v1.0.0
docker tag ${FRONTEND_IMAGE} ${FRONTEND_BASE}:v1.0.0

# Or manually if you know the image names:
# docker tag dockermgmr-backend:latest dockerfleet-manager-backend:1.0.0
# docker tag dockermgmr-frontend:latest dockerfleet-manager-frontend:1.0.0
```

## Step 3: Push Docker Images (if using a registry)

If you're using Docker Hub or another registry:

```bash
# Login to your registry
docker login

# Tag with your registry name (replace 'yourusername' with your Docker Hub username)
# Use the actual image names from your build
docker tag ${BACKEND_BASE}:1.0.0 yourusername/dockerfleet-manager-backend:1.0.0
docker tag ${FRONTEND_BASE}:1.0.0 yourusername/dockerfleet-manager-frontend:1.0.0
docker tag ${BACKEND_BASE}:1.0.0 yourusername/dockerfleet-manager-backend:latest
docker tag ${FRONTEND_BASE}:1.0.0 yourusername/dockerfleet-manager-frontend:latest

# Push images
docker push yourusername/dockerfleet-manager-backend:1.0.0
docker push yourusername/dockerfleet-manager-frontend:1.0.0
docker push yourusername/dockerfleet-manager-backend:latest
docker push yourusername/dockerfleet-manager-frontend:latest
```

## Step 4: Create GitHub Release

### Option A: Using GitHub Web Interface

1. Go to your repository on GitHub
2. Click on "Releases" → "Create a new release"
3. Select tag: `v1.0.0`
4. Release title: `v1.0.0 - Initial Stable Release`
5. Description: Add release notes (see template below)
6. Check "Set as the latest release"
7. Click "Publish release"

### Option B: Using GitHub CLI

```bash
# Install gh CLI if not already installed
# brew install gh  # macOS
# Then authenticate: gh auth login

gh release create v1.0.0 \
  --title "v1.0.0 - Initial Stable Release" \
  --notes "## DockerFleet Manager v1.0.0

### Features
- Multi-server Docker container management
- SSH-based remote server access
- Real-time container monitoring
- Container grouping and organization
- Live logs streaming
- Container console access
- Snapshot management
- Email alerts for container issues
- User management and authentication
- Dark/light mode support

### Installation
See README.md for installation instructions.

### Docker Images
- Backend: `dockerfleet-manager-backend:1.0.0`
- Frontend: `dockerfleet-manager-frontend:1.0.0`"
```

## Step 5: Update docker-compose.yml for Production (Optional)

For production deployments, you may want to pin image versions:

```yaml
backend:
  image: dockerfleet-manager-backend:1.0.0  # or your-registry/dockerfleet-manager-backend:1.0.0
  # ... rest of config

frontend:
  image: dockerfleet-manager-frontend:1.0.0  # or your-registry/dockerfleet-manager-frontend:1.0.0
  # ... rest of config
```

## Release Notes Template

```markdown
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

See git log for detailed commit history.

### 🐛 Known Issues

None at this time.

### 🙏 Credits

Built by Steven Coutts
```

## Verification Checklist

- [ ] All code committed and pushed
- [ ] Git tag `v1.0.0` created and pushed
- [ ] Docker images built and tagged
- [ ] GitHub release created
- [ ] Release notes added
- [ ] README.md is up to date
- [ ] .env.example is complete
- [ ] Documentation is accurate

## Post-Release

After creating the release:

1. Continue development on `main` branch
2. For hotfixes, create a `v1.0.1` tag from the appropriate commit
3. For new features, plan for `v1.1.0` or `v2.0.0` depending on scope
