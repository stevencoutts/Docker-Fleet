'use strict';

const crypto = require('crypto');

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('backup_jobs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      schedule_type: {
        type: Sequelize.ENUM('interval', 'daily', 'weekly'),
        allowNull: false,
      },
      schedule_config: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      retention: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      last_run_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      next_run_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex('backup_jobs', ['user_id']);
    await queryInterface.addIndex('backup_jobs', ['next_run_at']);
    await queryInterface.addIndex('backup_jobs', ['enabled']);

    await queryInterface.createTable('backup_job_entries', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      backup_job_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'backup_jobs', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      server_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'servers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      container_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    await queryInterface.addIndex('backup_job_entries', ['backup_job_id']);
    await queryInterface.addIndex('backup_job_entries', ['server_id']);

    // Migrate existing backup_schedules into one job per (user_id, schedule_type, schedule_config, retention, enabled)
    const [schedules] = await queryInterface.sequelize.query(
      `SELECT id, user_id, server_id, container_name, schedule_type, schedule_config, retention, enabled, last_run_at, next_run_at, created_at
       FROM backup_schedules ORDER BY user_id, created_at`
    );
    if (schedules && schedules.length > 0) {
      const groups = new Map();
      for (const s of schedules) {
        const key = JSON.stringify({
          user_id: s.user_id,
          schedule_type: s.schedule_type,
          schedule_config: s.schedule_config,
          retention: s.retention,
          enabled: s.enabled,
        });
        if (!groups.has(key)) {
          groups.set(key, {
            user_id: s.user_id,
            schedule_type: s.schedule_type,
            schedule_config: s.schedule_config,
            retention: s.retention,
            enabled: s.enabled,
            last_run_at: s.last_run_at,
            next_run_at: s.next_run_at,
            entries: [],
          });
        }
        groups.get(key).entries.push({ server_id: s.server_id, container_name: s.container_name });
      }
      for (const [, group] of groups) {
        const jobId = crypto.randomUUID();
        const scheduleConfigJson = typeof group.schedule_config === 'string'
          ? group.schedule_config
          : JSON.stringify(group.schedule_config || {});
        await queryInterface.sequelize.query(
          `INSERT INTO backup_jobs (id, user_id, name, schedule_type, schedule_config, retention, enabled, last_run_at, next_run_at, created_at, updated_at)
           VALUES (:id, :user_id, NULL, :schedule_type, :schedule_config, :retention, :enabled, :last_run_at, :next_run_at, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          {
            replacements: {
              id: jobId,
              user_id: group.user_id,
              schedule_type: group.schedule_type,
              schedule_config: scheduleConfigJson,
              retention: group.retention,
              enabled: group.enabled,
              last_run_at: group.last_run_at,
              next_run_at: group.next_run_at,
            },
          }
        );
        for (const entry of group.entries) {
          await queryInterface.sequelize.query(
            `INSERT INTO backup_job_entries (id, backup_job_id, server_id, container_name, created_at, updated_at)
             VALUES (:id, :backup_job_id, :server_id, :container_name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            {
              replacements: {
                id: crypto.randomUUID(),
                backup_job_id: jobId,
                server_id: entry.server_id,
                container_name: entry.container_name,
              },
            }
          );
        }
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('backup_job_entries');
    await queryInterface.dropTable('backup_jobs');
  },
};
