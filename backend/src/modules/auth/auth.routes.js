const express = require('express');
const router = express.Router();
const {
  login,
  register,
  refreshToken,
  getMe,
  checkSetup,
  loginValidation,
  registerValidation,
} = require('./auth.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validation.middleware');

router.get('/setup', checkSetup);
router.post('/login', loginValidation, validate, login);
router.post('/register', registerValidation, validate, register);
router.post('/refresh', refreshToken);
router.get('/me', authenticate, getMe);

module.exports = router;
