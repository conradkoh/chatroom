import type { ChatroomConfig } from './schema';

/**
 * Default Convex URL - this should be updated to your actual deployment
 */
export const DEFAULT_CONVEX_URL = 'https://your-deployment.convex.cloud';

/**
 * Default configuration used when no .chatroom/chatroom.jsonc is found
 * or as the template for `chatroom init`
 */
export const DEFAULT_CONFIG: ChatroomConfig = {
  convexUrl: DEFAULT_CONVEX_URL,
  defaultTeam: 'pair',
  teams: {
    pair: {
      name: 'Pair',
      description: 'A builder and reviewer working together',
      roles: ['builder', 'reviewer'],
      entryPoint: 'builder',
    },
    squad: {
      name: 'Squad',
      description: 'Full team with manager, architects, builders, and reviewers',
      roles: ['manager', 'architect', 'builder', 'frontend-designer', 'reviewer', 'tester'],
      entryPoint: 'manager',
    },
  },
};

/**
 * Default configuration as JSONC string (with comments)
 * Used when generating .chatroom/chatroom.jsonc via `chatroom init`
 */
export const DEFAULT_CONFIG_JSONC = `{
  // Chatroom CLI Configuration
  // This file defines the Convex backend, agent teams, and prompt customization.
  
  // The Convex deployment URL (required)
  "convexUrl": "${DEFAULT_CONVEX_URL}",
  
  // The default team to use when --team flag is not specified
  "defaultTeam": "pair",
  
  // Team definitions
  // Each team specifies the roles that must be present before messages can be sent
  // entryPoint: The role that receives all user messages (defaults to first role)
  "teams": {
    // Pair: A minimal team for simple tasks
    "pair": {
      "name": "Pair",
      "description": "A builder and reviewer working together",
      "roles": ["builder", "reviewer"],
      "entryPoint": "builder"
    },
    
    // Squad: A full team for complex tasks
    "squad": {
      "name": "Squad",
      "description": "Full team with manager, architects, builders, and reviewers",
      "roles": ["manager", "architect", "builder", "frontend-designer", "reviewer", "tester"],
      "entryPoint": "manager"
    }
  }
  
  // Prompt customization (optional)
  // Uncomment to customize agent prompts
  // "prompts": {
  //   // Path to custom init prompt template (replaces default)
  //   // "initPrompt": "prompts/init.md",
  //   
  //   // System reminders shown to agents
  //   "systemReminders": {
  //     // Set to false to disable system reminders
  //     "enabled": true
  //     // Custom reminder file path
  //     // "waitReminder": "prompts/wait-reminder.md"
  //   }
  // }
}
`;
