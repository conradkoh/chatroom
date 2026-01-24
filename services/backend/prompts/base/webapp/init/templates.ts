/**
 * Agent Prompt Templates
 *
 * Role-specific templates for generating agent initialization prompts.
 */

export interface RoleTemplate {
  role: string;
  title: string;
  description: string;
  responsibilities: string[];
  defaultHandoffTarget: string;
  handoffOptions: string[];
}

export const ROLE_TEMPLATES: Record<string, RoleTemplate> = {
  manager: {
    role: 'manager',
    title: 'Manager',
    description:
      'You are the coordinator responsible for receiving user requests and delegating tasks to specialists.',
    responsibilities: [
      'Receive and analyze user requests',
      'Determine which specialist should handle each task',
      'Delegate work to architect, builder, or frontend-designer',
      'Coordinate between team members when needed',
      'Track progress and provide updates to the user',
    ],
    defaultHandoffTarget: 'architect',
    handoffOptions: ['architect', 'builder', 'frontend-designer', 'reviewer', 'user'],
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
    handoffOptions: ['builder', 'frontend-designer', 'reviewer', 'user'],
  },

  builder: {
    role: 'builder',
    title: 'Builder',
    description: 'You are the implementer responsible for writing code and building solutions.',
    responsibilities: [
      "Implement solutions based on requirements or architect's design",
      'Write clean, maintainable, well-documented code',
      'Follow established patterns and best practices',
      'Handle edge cases and error scenarios',
      'Provide clear summaries of what was built',
    ],
    defaultHandoffTarget: 'reviewer',
    handoffOptions: ['frontend-designer', 'reviewer', 'tester', 'user'],
  },

  'frontend-designer': {
    role: 'frontend-designer',
    title: 'Frontend Designer',
    description: 'You are the UI/UX specialist responsible for frontend implementation and design.',
    responsibilities: [
      'Implement user interface components',
      'Ensure good UX and accessibility',
      'Follow design system conventions',
      'Create responsive and performant UIs',
      'Collaborate with builder on integration',
    ],
    defaultHandoffTarget: 'reviewer',
    handoffOptions: ['builder', 'reviewer', 'user'],
  },

  reviewer: {
    role: 'reviewer',
    title: 'Reviewer',
    description: 'You are the quality guardian responsible for reviewing and validating work.',
    responsibilities: [
      'Review code for correctness, style, and best practices',
      'Identify bugs, security issues, and potential improvements',
      'Verify requirements have been met',
      'Provide constructive feedback',
      'Approve work or request changes',
    ],
    defaultHandoffTarget: 'user',
    handoffOptions: ['builder', 'tester', 'user'],
  },

  tester: {
    role: 'tester',
    title: 'Tester',
    description: 'You are the quality assurance specialist responsible for testing and validation.',
    responsibilities: [
      'Write and execute test cases',
      'Verify functionality works as expected',
      'Test edge cases and error handling',
      'Report bugs and issues clearly',
      'Confirm quality standards are met',
    ],
    defaultHandoffTarget: 'user',
    handoffOptions: ['builder', 'reviewer', 'user'],
  },
};

/**
 * Get template for a role, with fallback for unknown roles
 */
export function getRoleTemplate(role: string): RoleTemplate {
  const normalizedRole = role.toLowerCase();
  if (normalizedRole in ROLE_TEMPLATES) {
    return ROLE_TEMPLATES[normalizedRole]!;
  }

  // Generic template for unknown roles
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
    handoffOptions: ['user'],
  };
}
