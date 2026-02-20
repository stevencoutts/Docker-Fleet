const { Sequelize } = require('sequelize');
const config = require('../config/database');
const logger = require('../config/logger');

const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

if (process.env.DB_NAME && process.env.DB_USER && process.env.DB_NAME === process.env.DB_USER) {
  logger.warn('DB_NAME equals DB_USER. DB_NAME should be the database name (e.g. dockerfleet), not the username. Set DB_NAME=dockerfleet in .env and restart.');
}

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: dbConfig.dialect,
    logging: dbConfig.logging,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  }
);

const db = {};

db.User = require('./User')(sequelize, Sequelize);
db.Server = require('./Server')(sequelize, Sequelize);
db.MonitoringSettings = require('./MonitoringSettings')(sequelize, Sequelize);
db.ContainerGroupingRule = require('./ContainerGroupingRule')(sequelize, Sequelize);
db.BackupSchedule = require('./BackupSchedule')(sequelize, Sequelize);
db.BackupJob = require('./BackupJob')(sequelize, Sequelize);
db.BackupJobEntry = require('./BackupJobEntry')(sequelize, Sequelize);
db.ServerContainerCache = require('./ServerContainerCache')(sequelize, Sequelize);
db.ServerHostInfoCache = require('./ServerHostInfoCache')(sequelize, Sequelize);
db.ServerProxyRoute = require('./ServerProxyRoute')(sequelize, Sequelize);

// Associations
db.Server.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.User.hasMany(db.Server, { foreignKey: 'userId', as: 'servers' });
db.MonitoringSettings.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.User.hasOne(db.MonitoringSettings, { foreignKey: 'userId', as: 'monitoringSettings' });
db.ContainerGroupingRule.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.User.hasMany(db.ContainerGroupingRule, { foreignKey: 'userId', as: 'containerGroupingRules' });
db.BackupSchedule.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.BackupSchedule.belongsTo(db.Server, { foreignKey: 'serverId', as: 'server' });
db.User.hasMany(db.BackupSchedule, { foreignKey: 'userId', as: 'backupSchedules' });
db.Server.hasMany(db.BackupSchedule, { foreignKey: 'serverId', as: 'backupSchedules' });
db.BackupJob.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.User.hasMany(db.BackupJob, { foreignKey: 'userId', as: 'backupJobs' });
db.BackupJobEntry.belongsTo(db.BackupJob, { foreignKey: 'backupJobId', as: 'job' });
db.BackupJobEntry.belongsTo(db.Server, { foreignKey: 'serverId', as: 'server' });
db.BackupJob.hasMany(db.BackupJobEntry, { foreignKey: 'backupJobId', as: 'entries' });
db.Server.hasMany(db.BackupJobEntry, { foreignKey: 'serverId', as: 'backupJobEntries' });
db.Server.hasMany(db.ServerContainerCache, { foreignKey: 'serverId', as: 'containerCache' });
db.ServerContainerCache.belongsTo(db.Server, { foreignKey: 'serverId', as: 'server' });
db.Server.hasOne(db.ServerHostInfoCache, { foreignKey: 'serverId', as: 'hostInfoCache' });
db.ServerHostInfoCache.belongsTo(db.Server, { foreignKey: 'serverId', as: 'server' });
db.Server.hasMany(db.ServerProxyRoute, { foreignKey: 'serverId', as: 'proxyRoutes' });
db.ServerProxyRoute.belongsTo(db.Server, { foreignKey: 'serverId', as: 'server' });

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// Test connection
sequelize
  .authenticate()
  .then(() => {
    logger.info('Database connection established successfully.');
  })
  .catch((err) => {
    logger.error('Unable to connect to the database:', err);
  });

module.exports = db;
