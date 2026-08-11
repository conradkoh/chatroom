import {
  DEFAULT_TEAM_PRESET_ID,
  TEAM_PRESETS,
  getTeamPreset,
  listTeamPresetIds,
} from '@workspace/backend/src/domain/entities/team-presets.js';

import type { TeamDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId } from '../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../infrastructure/convex/client.js';

interface ChatroomTeam {
  teamId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint: string;
}

async function createDefaultDeps(): Promise<TeamDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: { getSessionId },
  };
}

async function requireSession(deps: TeamDeps): Promise<string> {
  const sessionId = await deps.session.getSessionId();
  if (!sessionId) throw new Error('Not authenticated. Please run: chatroom auth login');
  return sessionId;
}

export async function listTeamPresets(): Promise<void> {
  console.log('Team presets:');
  const teamIds = [
    DEFAULT_TEAM_PRESET_ID,
    ...listTeamPresetIds().filter((teamId) => teamId !== DEFAULT_TEAM_PRESET_ID),
  ];
  for (const teamId of teamIds) {
    const preset = TEAM_PRESETS[teamId];
    if (!preset) continue;
    console.log(
      `  ${teamId} — ${preset.name} (${preset.roles.join(', ')}) entry: ${preset.entryPoint}`
    );
  }
}

export async function getTeam(chatroomId: string, deps?: TeamDeps): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = await requireSession(d);
  const team = (await d.backend.query(api.chatrooms.get, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as ChatroomTeam | null;
  if (!team) throw new Error(`Chatroom not found or access denied: ${chatroomId}`);
  console.log(`Current team: ${team.teamId} (${team.teamName})`);
  console.log(`  Roles: ${team.teamRoles.join(', ')}`);
  console.log(`  Entry point: ${team.teamEntryPoint}`);
}

export async function setTeam(chatroomId: string, teamId: string, deps?: TeamDeps): Promise<void> {
  const preset = getTeamPreset(teamId);
  if (!preset) {
    throw new Error(
      `Unknown team preset "${teamId}". Available presets: ${listTeamPresetIds().join(', ')}`
    );
  }
  const d = deps ?? (await createDefaultDeps());
  const sessionId = await requireSession(d);
  await d.backend.mutation(api.chatrooms.updateTeam, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    teamId,
    teamName: preset.name,
    teamRoles: preset.roles,
    teamEntryPoint: preset.entryPoint,
  });
  console.log(`✅ Team set to ${teamId} (${preset.name})`);
  console.log(`  Roles: ${preset.roles.join(', ')}`);
  console.log(`  Entry point: ${preset.entryPoint}`);
}
