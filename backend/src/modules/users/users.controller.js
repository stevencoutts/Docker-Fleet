const { body, validationResult } = require('express-validator');
const { User } = require('../../models');
const logger = require('../../config/logger');

// Get all users (admin only)
const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'email', 'role', 'letsEncryptEmail', 'createdAt', 'updatedAt'],
      order: [['createdAt', 'DESC']],
    });

    res.json({ users });
  } catch (error) {
    logger.error('Error fetching users:', error);
    next(error);
  }
};

// Get user by ID (admin only, or own profile)
const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const requestingUser = req.user;

    // Users can only view their own profile unless they're admin
    if (requestingUser.id !== id && requestingUser.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const user = await User.findByPk(id, {
      attributes: ['id', 'email', 'role', 'letsEncryptEmail', 'createdAt', 'updatedAt'],
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    logger.error('Error fetching user:', error);
    next(error);
  }
};

// Update user (admin can update anyone, users can only update themselves)
const updateUser = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { email, role, letsEncryptEmail } = req.body;
    const requestingUser = req.user;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Users can only update their own email, admins can update anyone
    if (requestingUser.id !== id && requestingUser.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Only admins can change roles
    if (role && requestingUser.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can change user roles' });
    }

    // Prevent removing the last admin
    if (role === 'user' && user.role === 'admin') {
      const adminCount = await User.count({ where: { role: 'admin' } });
      if (adminCount === 1) {
        return res.status(400).json({ error: 'Cannot remove the last admin' });
      }
    }

    // Check if email is already taken
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    }

    // Update user
    if (email) user.email = email;
    if (role && requestingUser.role === 'admin') user.role = role;
    if (letsEncryptEmail !== undefined) user.letsEncryptEmail = letsEncryptEmail === '' ? null : letsEncryptEmail;

    await user.save();

    logger.info(`User ${user.id} updated by ${requestingUser.email}`);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        letsEncryptEmail: user.letsEncryptEmail,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    logger.error('Error updating user:', error);
    next(error);
  }
};

// Update user password (users can update their own, admins can update anyone)
const updatePassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { password } = req.body;
    const requestingUser = req.user;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Users can only update their own password, admins can update anyone
    if (requestingUser.id !== id && requestingUser.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Update password (will be hashed by model hook)
    user.passwordHash = password;
    await user.save();

    logger.info(`Password updated for user ${user.id} by ${requestingUser.email}`);

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    logger.error('Error updating password:', error);
    next(error);
  }
};

// Delete user (admin only)
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const requestingUser = req.user;

    // Prevent self-deletion
    if (requestingUser.id === id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting the last admin
    if (user.role === 'admin') {
      const adminCount = await User.count({ where: { role: 'admin' } });
      if (adminCount === 1) {
        return res.status(400).json({ error: 'Cannot delete the last admin' });
      }
    }

    await user.destroy();

    logger.info(`User ${user.id} deleted by ${requestingUser.email}`);

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    logger.error('Error deleting user:', error);
    next(error);
  }
};

// Validation rules
const userValidation = [
  body('email').optional().isEmail().withMessage('Invalid email address'),
  body('role').optional().isIn(['admin', 'user']).withMessage('Role must be admin or user'),
  body('letsEncryptEmail').optional().custom((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)).withMessage('Let\'s Encrypt email must be valid'),
];

const passwordValidation = [
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
];

module.exports = {
  getAllUsers,
  getUserById,
  updateUser,
  updatePassword,
  deleteUser,
  userValidation,
  passwordValidation,
};
