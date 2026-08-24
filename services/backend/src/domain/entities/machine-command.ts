// fallow-ignore-file unused-export
import { v } from 'convex/values';

import { agentHarnessValidator } from './agent';
import {
  AGENT_REQUEST_DEADLINE_MS,
  MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS,
  MACHINE_COMMAND_LOCAL_ACTION_TTL_MS,
} from '../../../config/reliability';

export const localActionValidator = v.union(
  ...(
    [
      'open-vscode',
      'open-finder',
      'open-github-desktop',
      'open-cursor',
      'open-daemon-logs',
      'git-discard-file',
      'git-discard-all',
      'git-pull',
      'git-push',
      'git-sync',
    ] as const
  ).map(v.literal)
);
export const machineCommandPayloadValidator = v.union(
  v.object({
    type: v.literal('agent.requestStart'),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    agentHarness: agentHarnessValidator,
    model: v.string(),
    workingDir: v.string(),
    reason: v.string(),
    wantResume: v.optional(v.boolean()),
  }),
  v.object({
    type: v.literal('agent.restart'),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    agentHarness: agentHarnessValidator,
    model: v.string(),
    workingDir: v.string(),
    correlationId: v.string(),
    wantResume: v.optional(v.boolean()),
  }),
  v.object({
    type: v.literal('agent.requestStop'),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    reason: v.string(),
    pid: v.optional(v.number()),
  }),
  v.object({ type: v.literal('daemon.ping') }),
  v.object({ type: v.literal('daemon.gitRefresh'), workingDir: v.string() }),
  v.object({
    type: v.literal('daemon.refreshCapabilities'),
    batchId: v.optional(v.id('chatroom_capabilities_refresh_batches')),
  }),
  v.object({
    type: v.literal('daemon.localAction'),
    chatroomId: v.optional(v.string()),
    action: localActionValidator,
    workingDir: v.string(),
  }),
  v.object({
    type: v.literal('daemon.pickFolder'),
    requestId: v.id('chatroom_folderPickerRequests'),
  })
);
export type MachineCommandPayload = typeof machineCommandPayloadValidator.type;
export type MachineCommandType = MachineCommandPayload['type'];
export const MACHINE_COMMAND_TTL_MS: Record<MachineCommandType, number> = {
  'agent.requestStart': AGENT_REQUEST_DEADLINE_MS,
  'agent.restart': AGENT_REQUEST_DEADLINE_MS,
  'agent.requestStop': AGENT_REQUEST_DEADLINE_MS,
  'daemon.ping': MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS,
  'daemon.gitRefresh': MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS,
  'daemon.refreshCapabilities': MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS,
  'daemon.localAction': MACHINE_COMMAND_LOCAL_ACTION_TTL_MS,
  'daemon.pickFolder': MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS,
};
