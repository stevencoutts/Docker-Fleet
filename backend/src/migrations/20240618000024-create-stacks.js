'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('stacks', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      server_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'servers', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING, allowNull: false },
      compose_yaml: { type: Sequelize.TEXT, allowNull: false },
      deploy_path: { type: Sequelize.STRING(512), allowNull: false },
      source: { type: Sequelize.STRING, allowNull: false, defaultValue: 'created' },
      last_deployed_at: { type: Sequelize.DATE, allowNull: true },
      last_deploy_status: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('stacks', ['server_id', 'name'], { unique: true, name: 'stacks_server_id_name_unique' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('stacks');
  },
};
