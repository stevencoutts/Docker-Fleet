const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const {
  getAllUsers,
  getUserById,
  updateUser,
  updatePassword,
  deleteUser,
  userValidation,
  passwordValidation,
} = require('./users.controller');

// All routes require authentication
router.use(authenticate);

// Get all users (admin only)
router.get('/', authorize('admin'), getAllUsers);

// Get user by ID (admin or own profile)
router.get('/:id', getUserById);

// Update user (admin can update anyone, users can only update themselves)
router.put('/:id', userValidation, updateUser);

// Update user password (admin can update anyone, users can only update themselves)
router.put('/:id/password', passwordValidation, updatePassword);

// Delete user (admin only)
router.delete('/:id', authorize('admin'), deleteUser);

module.exports = router;
