const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ContainerGroupingRule = sequelize.define(
    'ContainerGroupingRule',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: {
          model: 'users',
          key: 'id',
        },
      },
      groupName: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'group_name',
        validate: {
          notEmpty: {
            msg: 'Group name is required',
          },
        },
      },
      pattern: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notEmpty: {
            msg: 'Pattern is required',
          },
        },
      },
      patternType: {
        type: DataTypes.ENUM('prefix', 'suffix', 'contains', 'regex'),
        allowNull: false,
        defaultValue: 'prefix',
        field: 'pattern_type',
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'sort_order',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    {
      tableName: 'container_grouping_rules',
      timestamps: true,
    }
  );

  // Helper method to check if a container name matches this rule
  ContainerGroupingRule.prototype.matches = function(containerName) {
    if (!this.enabled) return false;
    
    const name = containerName.toLowerCase();
    const pattern = this.pattern.toLowerCase();
    
    switch (this.patternType) {
      case 'prefix':
        return name.startsWith(pattern);
      case 'suffix':
        return name.endsWith(pattern);
      case 'contains':
        return name.includes(pattern);
      case 'regex':
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(containerName);
        } catch (e) {
          return false;
        }
      default:
        return false;
    }
  };

  return ContainerGroupingRule;
};
