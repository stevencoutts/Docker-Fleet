# DockerFleet Manager

A production-ready full-stack web application for managing Docker containers across multiple remote servers via SSH.

## 🏗️ Architecture

- **Frontend**: React.js with React Router v6, Tailwind CSS
- **Backend**: Node.js with Express.js
- **Database**: PostgreSQL with Sequelize ORM
- **Real-time**: Socket.IO for live logs and stats
- **Containerization**: Docker with Alpine Linux base images

## ✨ Features

### Multi-Server Management
- Add and manage multiple remote Docker hosts
- Support for IP addresses and DNS hostnames
- Secure SSH key-based authentication
- Encrypted private key storage
- Connection testing
- View host system information (architecture, CPU, memory, hostname)

### Container Management
- List all containers (running and stopped) with filtering
- View detailed container information with visual stats graphs
- Start, stop, restart, and remove containers
- **Image updates**: Check for image updates (digest and registry tags), pull & update containers in place; version numbers from image labels are shown and recorded
- View container logs with live streaming via WebSocket
- Monitor container stats (CPU, memory, network I/O, block I/O) with real-time graphs
- Manage container restart policies (no, always, unless-stopped, on-failure)
- Interactive console/terminal access for running containers
- Container snapshots: commit containers to images, view snapshots, restore from snapshots (optionally to a **different server**; the snapshot image is copied to the target host and port mappings from the source container are applied)
- Delete snapshot images

### Image Management
- List all Docker images
- Pull images from registries
- Remove images

### Security
- JWT-based authentication
- Role-based access control (admin/user)
- User management (admin can manage all users)
- Encrypted SSH private keys
- Helmet security headers
- Rate limiting (disabled for localhost/development)
- Input validation and sanitization
- Dark/light mode support

### Real-time Updates
- WebSocket support for live log streaming
- Real-time container status updates on dashboard
- Live container statistics with auto-refresh
- Instant dashboard updates when container states change

### Email Alerts
- Automatic email notifications when containers with auto-restart go down
- Recovery alerts when containers come back online
- Alerts for containers running without auto-restart policy
- Configurable SMTP settings via environment variables
- **Web UI configuration** for per-user alert preferences:
  - Enable/disable specific alert types
  - Configure alert cooldown periods (default: 12 hours)
  - Set minimum down time threshold before alerting
- Per-user settings stored in database with config fallback

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- PostgreSQL (if running database separately)

### Using Docker Compose (Recommended)

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd dockerfleet-manager  # or your project directory name
   ```

2. **Set up environment variables**
   
   **For Docker Compose (Production):**
   - Create a `.env` file in the project root (same directory as `docker-compose.yml`)
   - Docker Compose reads environment variables from the root `.env` file
   - Copy .env.example to the root `.env`
   
   **For Local Development:**
   ```bash
   cp .env.example .env
   ```
   
   Edit your `.env` file(s) and update the following:
   - `JWT_SECRET`: Generate a strong secret key
   - `JWT_REFRESH_SECRET`: Generate another strong secret key
   - `ENCRYPTION_KEY`: A 32-character key for encrypting SSH keys
   - `DB_PASSWORD`: Strong database password
   - `CORS_ORIGIN`: Frontend URL (default: http://localhost:3020)
   - `EMAIL_ENABLED`: Set to `true` to enable email alerts
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`: Configure your SMTP server
   - **Note**: For port 25 (unauthenticated SMTP), `SMTP_USER` and `SMTP_PASSWORD` can be left empty

3. **Build and start services**
   ```bash
   docker-compose up -d --build
   ```

4. **Run database migrations**
   ```bash
   docker-compose exec backend npm run migrate
   ```

5. **Create your admin account**
   - Access the application at http://localhost:3020
   - You will be automatically redirected to the registration page
   - Create the first administrator account (the first user automatically becomes admin)
   - After registration, you'll be logged in and can start managing servers

6. **Access the application**
   - Frontend: http://localhost:3020
   - Backend API: http://localhost:5020
   - Health check: http://localhost:5020/health

### Local Development

#### Backend Setup

1. **Navigate to backend directory**
   ```bash
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

4. **Start PostgreSQL** (or use Docker)
   ```bash
   docker run -d \
     --name dockerfleet-postgres \
     -e POSTGRES_DB=dockerfleet \
     -e POSTGRES_USER=dockerfleet_user \
     -e POSTGRES_PASSWORD=dockerfleet_password \
     -p 5432:5432 \
     postgres:15-alpine
   ```

5. **Run migrations**
   ```bash
   npm run migrate
   ```

6. **Create your admin account**
   - Access the application at http://localhost:3000
   - You will be automatically redirected to the registration page if no users exist
   - Create the first administrator account (the first user automatically becomes admin)

7. **Start development server**
   ```bash
   npm run dev
   ```

#### Frontend Setup

1. **Navigate to frontend directory**
   ```bash
   cd frontend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm start
   ```

   The frontend will be available at http://localhost:3020

## 📁 Project Structure

```
dockerfleet-manager/  # or your project directory name
├── backend/
│   ├── src/
│   │   ├── config/          # Configuration files
│   │   ├── middleware/       # Express middleware
│   │   ├── models/          # Sequelize models
│   │   ├── migrations/      # Database migrations
│   │   ├── seeders/         # Database seeders
│   │   ├── modules/         # Feature modules
│   │   │   ├── auth/        # Authentication
│   │   │   ├── servers/     # Server management
│   │   │   ├── containers/  # Container management
│   │   │   ├── images/      # Image management
│   │   │   ├── users/       # User management
│   │   │   └── monitoring/  # Monitoring settings
│   │   ├── services/        # Business logic services
│   │   │   ├── ssh.service.js
│   │   │   ├── docker.service.js
│   │   │   ├── email.service.js
│   │   │   └── monitoring.service.js
│   │   ├── routes/          # Route definitions
│   │   ├── utils/           # Utility functions
│   │   ├── websocket/       # Socket.IO handlers
│   │   └── app.js           # Express app entry point
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/      # Reusable components
│   │   ├── pages/          # Page components
│   │   ├── services/       # API services
│   │   ├── context/        # React contexts
│   │   ├── layouts/        # Layout components
│   │   └── App.js          # React app entry point
│   ├── public/
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
└── README.md
```

## 🔐 Security Best Practices

1. **Change default credentials** immediately after first login
2. **Use strong JWT secrets** - Generate random strings:
   ```bash
   openssl rand -base64 32
   ```
3. **Use strong encryption key** - 32 characters for SSH key encryption
4. **Enable HTTPS** in production using a reverse proxy (nginx/traefik)
5. **Restrict CORS** to your frontend domain only
6. **Use environment variables** for all secrets
7. **Regularly update dependencies** for security patches

## 🔌 Adding a Remote Server

1. **Generate SSH key pair** (if you don't have one)
   ```bash
   ssh-keygen -t rsa -b 4096 -f ~/.ssh/dockerfleet_key
   ```

2. **Copy public key to remote server**
   ```bash
   ssh-copy-id -i ~/.ssh/dockerfleet_key.pub user@remote-server
   ```

3. **Add server in the application**
   - Login to the web interface
   - Navigate to Dashboard
   - Click "Add Server" button (always visible in header)
   - Fill in:
     - Name: Friendly name for the server
     - Host: IP address or DNS hostname (e.g., `192.168.1.100` or `server.example.com`)
     - Port: SSH port (default: 22)
     - Username: SSH username
     - Private Key: Contents of your private key file

4. **Test connection** before saving

## 📦 Image Updates and Version Tracking

- **Check for update**: On each container’s details page, the app checks whether a newer image is available by comparing the local image digest to the registry and (when available) comparing version tags (e.g. LinuxServer, GHCR timestamp, semver).
- **Pull & update**: Recreates the container with the latest image for its tag while preserving configuration; the UI shows previous and new version when available (from image labels such as `build_version`, `org.opencontainers.image.version`).
- **Update history**: Each successful pull-and-update is appended as one JSON line to **`logs/container-updates.log`** (under the backend working directory). Each line includes `timestamp`, `serverId`, `containerName`, `previousImageRef`, `newImageRef`, `previousVersion`, and `newVersion`. The `logs/` directory is in `.gitignore` and is created automatically when the first update is recorded.

## 📡 API Endpoints

### Authentication
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/refresh` - Refresh token
- `GET /api/v1/auth/me` - Get current user

### Servers
- `GET /api/v1/servers` - List all servers
- `GET /api/v1/servers/:id` - Get server details
- `POST /api/v1/servers` - Create server
- `PUT /api/v1/servers/:id` - Update server
- `DELETE /api/v1/servers/:id` - Delete server
- `POST /api/v1/servers/:id/test` - Test connection

### Containers
- `GET /api/v1/servers/:serverId/containers` - List containers
- `GET /api/v1/servers/:serverId/containers/:containerId` - Get container details
- `GET /api/v1/servers/:serverId/containers/:containerId/logs` - Get logs
- `GET /api/v1/servers/:serverId/containers/:containerId/stats` - Get stats
- `POST /api/v1/servers/:serverId/containers/:containerId/start` - Start container
- `POST /api/v1/servers/:serverId/containers/:containerId/stop` - Stop container
- `POST /api/v1/servers/:serverId/containers/:containerId/restart` - Restart container
- `DELETE /api/v1/servers/:serverId/containers/:containerId` - Remove container
- `PUT /api/v1/servers/:serverId/containers/:containerId/restart-policy` - Update restart policy
- `GET /api/v1/servers/:serverId/containers/:containerId/update-status` - Get image update availability (digest and version)
- `POST /api/v1/servers/:serverId/containers/:containerId/pull-and-update` - Pull latest image and recreate container
- `POST /api/v1/servers/:serverId/containers/:containerId/execute` - Execute command in container
- `GET /api/v1/servers/:serverId/containers/:containerId/snapshots` - List snapshots
- `POST /api/v1/servers/:serverId/containers/:containerId/snapshots` - Create snapshot
- `POST /api/v1/servers/:serverId/containers/restore` - Restore container from snapshot

### Images
- `GET /api/v1/servers/:serverId/images` - List images
- `POST /api/v1/servers/:serverId/images/pull` - Pull image
- `DELETE /api/v1/servers/:serverId/images/:imageId` - Remove image

### Users (Admin Only)
- `GET /api/v1/users` - List all users
- `GET /api/v1/users/:id` - Get user details
- `PUT /api/v1/users/:id` - Update user
- `PUT /api/v1/users/:id/password` - Update user password
- `DELETE /api/v1/users/:id` - Delete user

### Monitoring Settings
- `GET /api/v1/monitoring` - Get current user's monitoring settings
- `PUT /api/v1/monitoring` - Update current user's monitoring settings

## 🔌 WebSocket Events

### Client → Server
- `stream:logs` - Start streaming container logs
  ```javascript
  socket.emit('stream:logs', { serverId, containerId, tail: 100 });
  ```
- `stream:logs:stop` - Stop streaming logs
- `stream:stats` - Start streaming container stats
  ```javascript
  socket.emit('stream:stats', { serverId, containerId });
  ```

### Server → Client
- `logs:data` - Log data chunk
- `logs:error` - Log streaming error
- `stats:data` - Container stats update
- `container:status:changed` - Container status changed (triggers dashboard refresh)
- `error` - General error

## 🛠️ Development

### Running Tests
```bash
# Backend tests (when implemented)
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

### Database Migrations
```bash
# Create new migration
cd backend
npx sequelize-cli migration:generate --name migration-name

# Run migrations
npm run migrate

# Rollback last migration
npm run migrate:undo
```

### Code Style
- Backend: Follow Node.js best practices
- Frontend: Follow React best practices
- Use ESLint and Prettier (when configured)

## 🐳 Docker Commands

```bash
# Build and start all services
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Rebuild specific service
docker-compose build backend
docker-compose up -d backend

# Execute command in container
docker-compose exec backend npm run migrate
```

## 📝 Environment Variables

### Important Notes

- **Docker Compose**: Environment variables must be set in a root `.env` file (same directory as `docker-compose.yml`)
- **Local Development**: Environment variables are loaded from `backend/.env`
- The backend only loads `backend/.env` in non-production mode to avoid conflicts with Docker Compose environment variables

### Backend (.env)

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Server port | `5000` |
| `DB_HOST` | PostgreSQL host | `postgres` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `dockerfleet` |
| `DB_USER` | Database user | `dockerfleet_user` |
| `DB_PASSWORD` | Database password | - |
| `JWT_SECRET` | JWT signing secret | - |
| `JWT_EXPIRES_IN` | JWT expiration | `24h` |
| `JWT_REFRESH_SECRET` | Refresh token secret | - |
| `ENCRYPTION_KEY` | SSH key encryption key | - |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:3020` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `900000` |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `100` |
| `LOG_LEVEL` | Logging level | `info` |
| `EMAIL_ENABLED` | Enable email alerts | `false` |
| `EMAIL_FROM_ADDRESS` | Email sender address | `noreply@dockerfleet.local` |
| `EMAIL_FROM_NAME` | Email sender name | `DockerFleet Manager` |
| `SMTP_HOST` | SMTP server host | `localhost` |
| `SMTP_PORT` | SMTP server port | `587` (or `25` for unauthenticated) |
| `SMTP_SECURE` | Use TLS/SSL | `false` (use `true` for port 465) |
| `SMTP_USER` | SMTP username | - (optional for port 25) |
| `SMTP_PASSWORD` | SMTP password | - (optional for port 25) |
| `SMTP_REJECT_UNAUTHORIZED` | Reject unauthorized certs | `true` |
| `MONITORING_CHECK_INTERVAL_MS` | Container check interval | `60000` (1 min) |
| `MONITORING_ALERT_COOLDOWN_MS` | Alert cooldown period | `43200000` (12 hours) |
| `MONITORING_NO_AUTO_RESTART_COOLDOWN_MS` | No auto-restart alert cooldown | `43200000` (12 hours) |
| `MONITORING_ALERT_ON_CONTAINER_DOWN` | Enable down alerts | `true` |
| `MONITORING_ALERT_ON_CONTAINER_RECOVERY` | Enable recovery alerts | `true` |
| `MONITORING_ALERT_ON_NO_AUTO_RESTART` | Enable no auto-restart alerts | `true` |
| `MONITORING_MIN_DOWN_TIME_MS` | Min down time before alert | `0` (immediate) |

### Frontend

| Variable | Description | Default |
|----------|-------------|---------|
| `REACT_APP_API_URL` | Backend API URL | `http://localhost:5020` |

## 🚨 Troubleshooting

### Connection Issues
- Verify SSH key is correct and has proper permissions
- Check firewall rules allow SSH access
- Ensure Docker is installed and running on remote server
- Test SSH connection manually: `ssh -i keyfile user@host`

### Database Issues
- Ensure PostgreSQL is running and accessible
- Check database credentials in `.env`
- Verify migrations have run: `npm run migrate`

### Container Issues
- Check Docker daemon is running on remote server
- Verify user has Docker permissions (may need to add to docker group)
- Check container logs for errors

## 📧 Email Alerts Configuration

The application can send email alerts when containers with auto-restart enabled go down or recover.

### Setup

**Important**: When using Docker Compose, environment variables must be set in a root `.env` file (same directory as `docker-compose.yml`), not just in `backend/.env`. The backend only loads `backend/.env` in development mode.

1. **Create/Edit root `.env` file** (for Docker Compose):
   ```bash
   # In project root directory
   EMAIL_ENABLED=true
   EMAIL_FROM_ADDRESS=your-email@example.com
   EMAIL_FROM_NAME=DockerFleet Manager
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASSWORD=your-app-password
   ```

   **For local development**, edit `backend/.env` instead.

2. **Configure SMTP settings**:
   
   **For authenticated SMTP (Gmail, Outlook, etc.):**
   ```bash
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASSWORD=your-app-password
   ```
   
   **For unauthenticated SMTP (port 25, local relay):**
   ```bash
   SMTP_HOST=your-smtp-server.local
   SMTP_PORT=25
   SMTP_SECURE=false
   SMTP_USER=          # Leave empty
   SMTP_PASSWORD=      # Leave empty
   ```

3. **For Gmail**, you'll need to:
   - Enable 2-factor authentication
   - Generate an "App Password" (not your regular password)
   - Use the app password in `SMTP_PASSWORD`

4. **Restart the backend**:
   ```bash
   docker-compose restart backend
   ```
   
   Check the logs to verify email service initialization:
   ```bash
   docker-compose logs backend | grep -i email
   ```

### Monitoring Settings

#### Environment Variables (Global Defaults)

- `MONITORING_CHECK_INTERVAL_MS`: How often to check containers (default: 60000ms = 1 minute)
- `MONITORING_ALERT_COOLDOWN_MS`: Minimum time between alerts for the same container (default: 43200000ms = 12 hours)
- `MONITORING_NO_AUTO_RESTART_COOLDOWN_MS`: Cooldown for no auto-restart alerts (default: 43200000ms = 12 hours)
- `MONITORING_ALERT_ON_CONTAINER_DOWN`: Enable/disable down alerts (default: `true`)
- `MONITORING_ALERT_ON_CONTAINER_RECOVERY`: Enable/disable recovery alerts (default: `true`)
- `MONITORING_ALERT_ON_NO_AUTO_RESTART`: Enable/disable no auto-restart alerts (default: `true`)
- `MONITORING_MIN_DOWN_TIME_MS`: Minimum time container must be down before first alert (default: 0 = immediate)

#### Web UI Configuration

You can configure monitoring settings per-user via the web interface:

1. Navigate to **Monitoring** in the navigation menu
2. Configure your preferences:
   - **Alert Types**: Toggle which alerts you want to receive
   - **Alert Cooldown Periods**: Set how long to wait before resending alerts (in hours)
   - **Alert Thresholds**: Set minimum down time before alerting (in minutes)
3. Click **Save Settings**

**Note**: Web UI settings override environment variable defaults for your user account. Settings are stored per-user in the database.

### How It Works

- The monitoring service automatically checks all containers every minute
- Alerts are sent when:
  - A container with auto-restart enabled goes down (if enabled)
  - A previously down container recovers (if enabled)
  - A container is running without auto-restart policy (if enabled)
- Alerts are sent to the email address of the user who owns the server
- Cooldown prevents spam - alerts for the same container are limited to once per cooldown period (default: 12 hours)
- Each user can configure their own alert preferences via the web UI

## 🎨 User Interface Features

- **Dark/Light Mode**: Toggle between themes with system preference detection
- **Dashboard Overview**: Real-time overview of all servers and containers with health indicators
- **Container Filtering**: Filter containers by status (All, Running, Stopped)
- **Visual Stats**: Interactive graphs for CPU, Memory, Network I/O, and Block I/O
- **Live Logs**: Real-time log streaming with auto-scroll toggle
- **Container Console**: Interactive terminal for executing commands in containers
- **Snapshots**: Create, view, and restore container snapshots
- **User Management**: Admin interface for managing users (admin only)
- **Profile Management**: Personal settings and password management
- **Monitoring Settings**: Per-user email alert configuration

## 🔮 Future Enhancements

- [ ] Kubernetes support
- [ ] Activity audit logs
- [ ] API documentation with Swagger
- [ ] Automated backups
- [ ] Container templates
- [ ] Docker Compose file management
- [ ] Container health checks
- [ ] Resource usage alerts

## 📄 License

MIT License - see LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For issues and questions, please open an issue on GitHub.
