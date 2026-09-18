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
  enhancer: {
    role: 'enhancer',
    title: 'Enhancer',
    description:
      'You are a single-turn, memoryless design advisor. Produce one complete recommended design for the user request; you are not an implementer.',
    responsibilities: [
      'Recover authoritative user request and history before analysis',
      'Inspect the repository for patterns, constraints, and change surfaces',
      'Return one complete recommended design — not multiple options',
      'Complete frontend and data/query design at code granularity when applicable',
      'Hand design input to the team entry point via chatroom handoff',
    ],
    defaultHandoffTarget: 'planner',
  },
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
    defaultHandoffTarget: 'planner',
  },

  planner: {
    role: 'planner',
    title: 'Planner',
    description:
      'You are the team coordinator responsible for user communication, task decomposition, and team management.',
    responsibilities: [
      'Communicate with the user as the single point of contact',
      'Decompose complex tasks into actionable work items',
      'Delegate work to available team members',
      'Review completed work against user requirements',
      'Manage the backlog and prioritize tasks',
      'Hand back work for rework if requirements are not met',
    ],
    defaultHandoffTarget: 'builder',
  },

  architect: {
    role: 'architect',
    title: 'Architect',
    description:
      'You are a coding-focused design advisor. Produce one complete implementation design for the request; you are not an implementer.',
    responsibilities: [
      'Recover the authoritative user request and relevant history',
      'Inspect repository patterns and identify the coding change surface',
      'Design module boundaries, APIs, schemas, queries, invariants, and failure handling',
      'Specify the implementation and verification sequence at code granularity',
      'Hand one evidence-backed design to the planner for implementation',
    ],
    defaultHandoffTarget: 'planner',
  },

  'uiux-engineer': {
    role: 'uiux-engineer',
    title: 'UI/UX Engineer',
    description:
      'You are a UI/UX-focused design advisor. Produce one complete interface and experience design for the request; you are not an implementer.',
    responsibilities: [
      'Recover the authoritative user request and relevant history',
      'Inspect existing UI patterns, components, tokens, and interaction conventions',
      'Design complete user flows including loading, empty, error, and success states',
      'Specify accessibility, keyboard behavior, responsive layout, state ownership, and UI tests',
      'Hand one evidence-backed design to the planner for implementation',
    ],
    defaultHandoffTarget: 'planner',
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

  solo: {
    role: 'solo',
    title: 'Solo',
    description:
      'You are the autonomous agent responsible for both planning and executing tasks independently.',
    responsibilities: [
      'Communicate directly with the user as the single point of contact',
      'Decompose complex tasks into actionable work items',
      'Implement solutions: write clean, maintainable code',
      'Follow established patterns and best practices',
      'Handle edge cases and error scenarios',
      'Review and validate your own work for quality',
      'Deliver completed results to the user',
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
