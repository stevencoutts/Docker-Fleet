'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('stack_env_vars', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      stack_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'stacks', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      key: { type: Sequelize.STRING, allowNull: false },
      value: { type: Sequelize.TEXT, allowNull: true },
      is_secret: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('stack_env_vars', ['stack_id', 'key'], { unique: true, name: 'stack_env_vars_stack_id_key_unique' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('stack_env_vars');
  },
};
