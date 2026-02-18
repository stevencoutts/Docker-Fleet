const { Sequelize } = require('sequelize');
const config = require('../config/database');
const logger = require('../config/logger');

const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

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

// Associations
db.Server.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.User.hasMany(db.Server, { foreignKey: 'userId', as: 'servers' });
db.MonitoringSettings.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.User.hasOne(db.MonitoringSettings, { foreignKey: 'userId', as: 'monitoringSettings' });
db.ContainerGroupingRule.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.User.hasMany(db.ContainerGroupingRule, { foreignKey: 'userId', as: 'containerGroupingRules' });

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
