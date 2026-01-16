/**
 * Create a new chatroom
 */

import { api } from '../api.js';
import { loadConfig, getTeam, getDefaultTeam, getTeamIds } from '../config/loader.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

interface CreateOptions {
  team?: string;
}

export async function createChatroom(options: CreateOptions = {}): Promise<void> {
  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  // Load configuration
  const { config, configPath } = loadConfig();

  // Determine which team to use
  let teamId: string;
  let team;

  if (options.team) {
    team = getTeam(config, options.team);
    if (!team) {
      console.error(`❌ Team '${options.team}' not found`);
      console.error(`   Available teams: ${getTeamIds(config).join(', ')}`);
      process.exit(1);
    }
    teamId = options.team;
  } else {
    teamId = config.defaultTeam;
    team = getDefaultTeam(config);
  }

  // Determine entry point (defaults to first role)
  const entryPoint = team.entryPoint ?? team.roles[0];

  // Create the chatroom with team info
  const chatroomId = await client.mutation(api.chatrooms.create, {
    sessionId,
    teamId,
    teamName: team.name,
    teamRoles: team.roles,
    teamEntryPoint: entryPoint,
  });

  console.log(`\n✅ Chatroom created!`);
  console.log(`📋 Chatroom ID: ${chatroomId}`);
  console.log(`👥 Team: ${team.name} (${team.roles.join(', ')})`);
  if (configPath) {
    console.log(`📁 Config: ${configPath}`);
  }

  console.log(`\n🚀 Next steps:`);
  console.log(`   1. Start agents for each role:`);
  for (const role of team.roles) {
    console.log(`      chatroom wait-for-message ${chatroomId} --role=${role}`);
  }
  console.log(`\n   2. Send a message via the WebUI to get started`);
}
