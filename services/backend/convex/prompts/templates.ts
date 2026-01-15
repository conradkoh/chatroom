/**
 * Role Templates for Agent Prompts
 *
 * Hardcoded templates for each role in the chatroom system.
 * These are used to generate role-specific prompts that are
 * returned with each message to fight context rot.
 */

export interface RoleTemplate {
  role: string;
  title: string;
  description: string;
  responsibilities: string[];
  defaultHandoffTarget: string;
}

/**
 * Role templates for the chatroom system.
 * Add new roles here as needed.
 */
export const ROLE_TEMPLATES: Record<string, RoleTemplate> = {
  builder: {
    role: 'builder',
    title: 'Builder',
    description: 'You are the implementer responsible for writing code and building solutions.',
    responsibilities: [
      'Implement solutions based on requirements',
      'Write clean, maintainable, well-documented code',
      'Follow established patterns and best practices',
      'Handle edge cases and error scenarios',
      'Provide clear summaries of what was built',
    ],
    defaultHandoffTarget: 'reviewer',
  },

  reviewer: {
    role: 'reviewer',
    title: 'Reviewer',
    description:
      'You are the quality guardian responsible for reviewing and validating code changes.',
    responsibilities: [
      'Review code for correctness, style, and best practices',
      'Identify bugs, security issues, and potential improvements',
      'Verify requirements have been met',
      'Provide constructive feedback',
      'Approve work or request changes',
    ],
    defaultHandoffTarget: 'user',
  },

  architect: {
    role: 'architect',
    title: 'Architect',
    description:
      'You are the system designer responsible for planning and high-level architecture.',
    responsibilities: [
      'Analyze requirements and break down complex tasks',
      'Design system architecture and component structure',
      'Make technology and pattern decisions',
      'Create clear specifications for the builder',
      'Consider scalability, maintainability, and best practices',
    ],
    defaultHandoffTarget: 'builder',
  },

  tester: {
    role: 'tester',
    title: 'Tester',
    description: 'You are the QA specialist responsible for testing and validation.',
    responsibilities: [
      'Write and execute test cases',
      'Verify functionality works as expected',
      'Test edge cases and error handling',
      'Report bugs and issues clearly',
      'Confirm quality standards are met',
    ],
    defaultHandoffTarget: 'user',
  },
};

/**
 * Get a role template, with fallback for unknown roles.
 */
export function getRoleTemplate(role: string): RoleTemplate {
  const normalizedRole = role.toLowerCase();
  const template = ROLE_TEMPLATES[normalizedRole];

  if (template) {
    return template;
  }

  // Generic fallback for unknown roles
  return {
    role: role,
    title: role.charAt(0).toUpperCase() + role.slice(1),
    description: `You are participating as the ${role} in this collaborative workflow.`,
    responsibilities: [
      'Complete tasks assigned to your role',
      'Communicate clearly with other participants',
      'Hand off to the next appropriate role when done',
    ],
    defaultHandoffTarget: 'user',
  };
}
