const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validation.middleware');
const { body } = require('express-validator');
const {
  getAllRules,
  getRuleById,
  createRule,
  updateRule,
  deleteRule,
} = require('./grouping.controller');

// Validation rules
const createRuleValidation = [
  body('groupName').notEmpty().withMessage('Group name is required'),
  body('pattern').notEmpty().withMessage('Pattern is required'),
  body('patternType').optional().isIn(['prefix', 'suffix', 'contains', 'regex']).withMessage('Invalid pattern type'),
  body('enabled').optional().isBoolean().withMessage('Enabled must be a boolean'),
  body('sortOrder').optional().isInt().withMessage('Sort order must be an integer'),
];

const updateRuleValidation = [
  body('groupName').optional().notEmpty().withMessage('Group name cannot be empty'),
  body('pattern').optional().notEmpty().withMessage('Pattern cannot be empty'),
  body('patternType').optional().isIn(['prefix', 'suffix', 'contains', 'regex']).withMessage('Invalid pattern type'),
  body('enabled').optional().isBoolean().withMessage('Enabled must be a boolean'),
  body('sortOrder').optional().isInt().withMessage('Sort order must be an integer'),
];

// All routes require authentication
router.use(authenticate);

router.get('/', getAllRules);
router.get('/:id', getRuleById);
router.post('/', createRuleValidation, validate, createRule);
router.put('/:id', updateRuleValidation, validate, updateRule);
router.delete('/:id', deleteRule);

module.exports = router;
