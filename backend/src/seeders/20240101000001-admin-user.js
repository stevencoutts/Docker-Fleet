'use strict';
// This seeder is disabled - first user registration creates the admin account
// Keeping file for migration compatibility

module.exports = {
  async up(queryInterface, Sequelize) {
    // No default admin user - first registered user becomes admin
    // This is handled in the auth controller
  },

  async down(queryInterface, Sequelize) {
    // Nothing to rollback
  },
};
