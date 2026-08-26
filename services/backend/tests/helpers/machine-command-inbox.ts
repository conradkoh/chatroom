import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { MachineCommandType } from '../../src/domain/entities/machine-command';
import { t } from '../../test.setup';

type InboxRow = Doc<'chatroom_machineCommandInbox'>;

export async function getMachineCommandInbox(machineId: string) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', machineId).eq('status', 'pending')
      )
      .collect()
  );
}

export async function getMachineCommandInboxAll(machineId: string) {
  return t.run(async (ctx) => [
    ...(await ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', machineId).eq('status', 'pending')
      )
      .collect()),
    ...(await ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', machineId).eq('status', 'processing')
      )
      .collect()),
  ]);
}

export async function getInboxCommandsForMachine(
  machineId: string,
  commandType?: MachineCommandType
): Promise<InboxRow[]> {
  const rows = await getMachineCommandInboxAll(machineId);
  if (!commandType) return rows;
  return rows.filter((row) => row.command.type === commandType);
}

export async function getInboxCommandsForChatroom(
  chatroomId: Id<'chatroom_rooms'>,
  commandType: MachineCommandType
): Promise<InboxRow[]> {
  return t.run(async (ctx) => {
    const rows = await ctx.db.query('chatroom_machineCommandInbox').collect();
    return rows.filter(
      (row) =>
        'chatroomId' in row.command &&
        row.command.chatroomId === chatroomId &&
        row.command.type === commandType
    );
  });
}

export async function getStopCommandMachineIdsForRole(
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<string[]> {
  const rows = await getInboxCommandsForChatroom(chatroomId, 'agent.requestStop');
  return rows
    .filter((row) => row.command.type === 'agent.requestStop' && row.command.role === role)
    .map((row) => row.machineId);
}

export async function getGitRefreshCommandsForMachine(
  machineId: string,
  workingDir: string
): Promise<InboxRow[]> {
  const rows = await getInboxCommandsForMachine(machineId, 'daemon.gitRefresh');
  return rows.filter(
    (row) => row.command.type === 'daemon.gitRefresh' && row.command.workingDir === workingDir
  );
}

export async function getStopScopeCommandsForChatroom(chatroomId: Id<'chatroom_rooms'>) {
  return getInboxCommandsForChatroom(chatroomId, 'agent.stopScope');
}
export async function getStopCommandTargetCount(stopCommandId: Id<'chatroom_agentStopCommands'>) {
  return t.run(async (ctx) => (await ctx.db.query('chatroom_agentStopTargets').withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', stopCommandId)).collect()).length);
}
export async function countStopCommandsForChatroom(chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) => (await ctx.db.query('chatroom_agentStopCommands').withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId)).collect()).length);
}
