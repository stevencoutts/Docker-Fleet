const { ContainerGroupingRule } = require('../../models');
const logger = require('../../config/logger');

const getAllRules = async (req, res, next) => {
  try {
    const rules = await ContainerGroupingRule.findAll({
      where: { userId: req.user.id },
      order: [['sortOrder', 'ASC'], ['groupName', 'ASC']],
    });

    res.json({ rules });
  } catch (error) {
    logger.error('Error fetching grouping rules:', error);
    next(error);
  }
};

const getRuleById = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const rule = await ContainerGroupingRule.findOne({
      where: { id, userId: req.user.id },
    });

    if (!rule) {
      return res.status(404).json({ error: 'Grouping rule not found' });
    }

    res.json({ rule });
  } catch (error) {
    logger.error('Error fetching grouping rule:', error);
    next(error);
  }
};

const createRule = async (req, res, next) => {
  try {
    const { groupName, pattern, patternType, enabled, sortOrder } = req.body;

    if (!groupName || !pattern) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: 'Group name and pattern are required',
      });
    }

    // Validate pattern if it's a regex
    if (patternType === 'regex') {
      try {
        new RegExp(pattern);
      } catch (e) {
        return res.status(400).json({ 
          error: 'Invalid regex pattern',
          details: e.message,
        });
      }
    }

    const rule = await ContainerGroupingRule.create({
      userId: req.user.id,
      groupName,
      pattern,
      patternType: patternType || 'prefix',
      enabled: enabled !== undefined ? enabled : true,
      sortOrder: sortOrder || 0,
    });

    logger.info(`Grouping rule ${rule.id} created by user ${req.user.id}`);

    res.status(201).json({ rule });
  } catch (error) {
    logger.error('Error creating grouping rule:', error);
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({ 
        error: 'Validation error',
        details: error.errors.map(e => e.message).join(', '),
      });
    }
    next(error);
  }
};

const updateRule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { groupName, pattern, patternType, enabled, sortOrder } = req.body;

    const rule = await ContainerGroupingRule.findOne({
      where: { id, userId: req.user.id },
    });

    if (!rule) {
      return res.status(404).json({ error: 'Grouping rule not found' });
    }

    // Validate pattern if it's a regex and pattern is being updated
    if (patternType === 'regex' || (rule.patternType === 'regex' && pattern)) {
      const patternToValidate = pattern || rule.pattern;
      try {
        new RegExp(patternToValidate);
      } catch (e) {
        return res.status(400).json({ 
          error: 'Invalid regex pattern',
          details: e.message,
        });
      }
    }

    if (groupName !== undefined) rule.groupName = groupName;
    if (pattern !== undefined) rule.pattern = pattern;
    if (patternType !== undefined) rule.patternType = patternType;
    if (enabled !== undefined) rule.enabled = enabled;
    if (sortOrder !== undefined) rule.sortOrder = sortOrder;

    await rule.save();

    logger.info(`Grouping rule ${rule.id} updated by user ${req.user.id}`);

    res.json({ rule });
  } catch (error) {
    logger.error('Error updating grouping rule:', error);
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({ 
        error: 'Validation error',
        details: error.errors.map(e => e.message).join(', '),
      });
    }
    next(error);
  }
};

const deleteRule = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const rule = await ContainerGroupingRule.findOne({
      where: { id, userId: req.user.id },
    });

    if (!rule) {
      return res.status(404).json({ error: 'Grouping rule not found' });
    }

    await rule.destroy();

    logger.info(`Grouping rule ${id} deleted by user ${req.user.id}`);

    res.json({ message: 'Grouping rule deleted successfully' });
  } catch (error) {
    logger.error('Error deleting grouping rule:', error);
    next(error);
  }
};

// Helper function to group containers based on user's rules
const groupContainers = async (userId, containers) => {
  try {
    const rules = await ContainerGroupingRule.findAll({
      where: { userId, enabled: true },
      order: [['sortOrder', 'ASC'], ['groupName', 'ASC']],
    });

    const grouped = {};
    const ungrouped = [];

    // Helper to get container name
    const getContainerName = (container) => {
      let name = container.Names || container['.Names'] || container.name || '';
      if (name) {
        name = name.replace(/^\//, ''); // Remove leading slash
      }
      if (!name) {
        name = (container.ID || container.Id || container['.ID'] || container.id || '').substring(0, 12);
      }
      return name;
    };

    // First, try to match each container to a rule
    containers.forEach((container) => {
      const containerName = getContainerName(container);
      let matched = false;

      for (const rule of rules) {
        if (rule.matches(containerName)) {
          if (!grouped[rule.groupName]) {
            grouped[rule.groupName] = [];
          }
          grouped[rule.groupName].push(container);
          matched = true;
          break; // Only match to first rule
        }
      }

      if (!matched) {
        ungrouped.push(container);
      }
    });

    return { grouped, ungrouped };
  } catch (error) {
    logger.error('Error grouping containers:', error);
    // Return ungrouped containers if grouping fails
    return { grouped: {}, ungrouped: containers };
  }
};

module.exports = {
  getAllRules,
  getRuleById,
  createRule,
  updateRule,
  deleteRule,
  groupContainers,
};
