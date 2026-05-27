import type { ChatroomConfig } from './schema';

/**
 * Default configuration used when no .chatroom/chatroom.jsonc is found
 */
export const DEFAULT_CONFIG: ChatroomConfig = {
  defaultTeam: 'duo',
  teams: {
    duo: {
      name: 'Duo',
      description: 'A planner and builder working together, planner as entry point',
      roles: ['planner', 'builder'],
      entryPoint: 'planner',
    },
    squad: {
      name: 'Squad',
      description: 'A planner, builder, and reviewer working as a coordinated team',
      roles: ['planner', 'builder', 'reviewer'],
      entryPoint: 'planner',
    },
  },
};

/**
 * Default configuration as JSONC string (with comments)
 */
export const DEFAULT_CONFIG_JSONC = `{
  // Chatroom CLI Configuration
  // This file defines agent teams and prompt customization.
  
  // The default team to use when --team flag is not specified
  "defaultTeam": "duo",
  
  // Team definitions
  // Each team specifies the roles that must be present before messages can be sent
  // entryPoint: The role that receives all user messages (defaults to first role)
  "teams": {
    // Duo: A planner-builder pair with planner as entry point
    "duo": {
      "name": "Duo",
      "description": "A planner and builder working together, planner as entry point",
      "roles": ["planner", "builder"],
      "entryPoint": "planner"
    },
    
    // Squad: A coordinated team for complex tasks
    "squad": {
      "name": "Squad",
      "description": "A planner, builder, and reviewer working as a coordinated team",
      "roles": ["planner", "builder", "reviewer"],
      "entryPoint": "planner"
    }
  }
  
  // Prompt customization (optional)
  // Uncomment to customize agent prompts
  // "prompts": {
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
