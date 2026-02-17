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
- Secure SSH key-based authentication
- Encrypted private key storage
- Connection testing

### Container Management
- List all containers (running and stopped)
- View detailed container information
- Start, stop, restart, and remove containers
- View container logs with live streaming
- Monitor container stats (CPU, memory, network)

### Image Management
- List all Docker images
- Pull images from registries
- Remove images

### Security
- JWT-based authentication
- Role-based access control (admin/user)
- Encrypted SSH private keys
- Helmet security headers
- Rate limiting
- Input validation and sanitization

### Real-time Updates
- WebSocket support for live log streaming
- Real-time container status updates
- Live container statistics

### Email Alerts
- Automatic email notifications when containers with auto-restart go down
- Recovery alerts when containers come back online
- Configurable SMTP settings
- Alert cooldown to prevent spam

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- PostgreSQL (if running database separately)

### Using Docker Compose (Recommended)

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd dockerMgmr
   ```

2. **Set up environment variables**
   ```bash
   cp backend/env.example backend/.env
   ```
   
   Edit `backend/.env` and update the following:
   - `JWT_SECRET`: Generate a strong secret key
   - `JWT_REFRESH_SECRET`: Generate another strong secret key
   - `ENCRYPTION_KEY`: A 32-character key for encrypting SSH keys
   - `DB_PASSWORD`: Strong database password
   - `CORS_ORIGIN`: Frontend URL (default: http://localhost:3020)
   - `EMAIL_ENABLED`: Set to `true` to enable email alerts
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`: Configure your SMTP server

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
dockerMgmr/
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
│   │   │   └── images/      # Image management
│   │   ├── services/        # Business logic services
│   │   │   ├── ssh.service.js
│   │   │   └── docker.service.js
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
   - Click "Add Server"
   - Fill in:
     - Name: Friendly name for the server
     - Host: IP address or hostname
     - Port: SSH port (default: 22)
     - Username: SSH username
     - Private Key: Contents of your private key file

4. **Test connection** before saving

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

### Images
- `GET /api/v1/servers/:serverId/images` - List images
- `POST /api/v1/servers/:serverId/images/pull` - Pull image
- `DELETE /api/v1/servers/:serverId/images/:imageId` - Remove image

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
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_SECURE` | Use TLS/SSL | `false` |
| `SMTP_USER` | SMTP username | - |
| `SMTP_PASSWORD` | SMTP password | - |
| `SMTP_REJECT_UNAUTHORIZED` | Reject unauthorized certs | `true` |
| `MONITORING_CHECK_INTERVAL_MS` | Container check interval | `60000` (1 min) |
| `MONITORING_ALERT_COOLDOWN_MS` | Alert cooldown period | `300000` (5 min) |

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

1. **Enable email alerts** in `backend/.env`:
   ```bash
   EMAIL_ENABLED=true
   EMAIL_FROM_ADDRESS=your-email@example.com
   EMAIL_FROM_NAME=DockerFleet Manager
   ```

2. **Configure SMTP settings**:
   ```bash
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASSWORD=your-app-password
   ```

3. **For Gmail**, you'll need to:
   - Enable 2-factor authentication
   - Generate an "App Password" (not your regular password)
   - Use the app password in `SMTP_PASSWORD`

4. **Restart the backend**:
   ```bash
   docker-compose restart backend
   ```

### Monitoring Settings

- `MONITORING_CHECK_INTERVAL_MS`: How often to check containers (default: 60000ms = 1 minute)
- `MONITORING_ALERT_COOLDOWN_MS`: Minimum time between alerts for the same container (default: 300000ms = 5 minutes)

### How It Works

- The monitoring service automatically checks all containers every minute
- Alerts are sent when:
  - A container with auto-restart enabled goes down
  - A previously down container recovers
- Alerts are sent to the email address of the user who owns the server
- Cooldown prevents spam - alerts for the same container are limited to once per cooldown period

## 🔮 Future Enhancements

- [ ] Kubernetes support
- [ ] Container filtering and search
- [ ] Activity audit logs
- [ ] API documentation with Swagger
- [ ] Automated backups
- [ ] Multi-user collaboration
- [ ] Container templates
- [ ] Docker Compose file management

## 📄 License

MIT License - see LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For issues and questions, please open an issue on GitHub.

---

**Built with ❤️ for managing Docker containers at scale**
