'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('container_grouping_rules', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      group_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      pattern: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'Pattern to match container names (supports prefix, suffix, contains, or regex)',
      },
      pattern_type: {
        type: Sequelize.ENUM('prefix', 'suffix', 'contains', 'regex'),
        allowNull: false,
        defaultValue: 'prefix',
      },
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Order in which groups should be displayed',
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

    await queryInterface.addIndex('container_grouping_rules', ['user_id']);
    await queryInterface.addIndex('container_grouping_rules', ['enabled']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('container_grouping_rules');
  },
};
