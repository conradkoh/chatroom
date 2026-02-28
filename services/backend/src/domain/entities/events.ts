/**
 * ChatroomEvent — union type for all events in the chatroom_eventStream table.
 *
 * Each variant carries full state — consumers never need to fetch additional data
 * after receiving an event.
 */

import type { Id } from '../../../convex/_generated/dataModel';

export type AgentStartedEvent = {
  type: 'agent.started';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  agentHarness: 'opencode' | 'pi';
  model: string;
  workingDir: string;
  pid: number;
  timestamp: number;
};

export type AgentExitedEvent = {
  type: 'agent.exited';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  pid: number;
  intentional: boolean;
  exitCode?: number;
  signal?: string;
  timestamp: number;
};

export type TaskActivatedEvent = {
  type: 'task.activated';
  chatroomId: Id<'chatroom_rooms'>;
  taskId: Id<'chatroom_tasks'>;
  role: string;
  taskStatus: string;
  taskContent: string;
  timestamp: number;
};

export type TaskCompletedEvent = {
  type: 'task.completed';
  chatroomId: Id<'chatroom_rooms'>;
  taskId: Id<'chatroom_tasks'>;
  role: string;
  finalStatus: string;
  timestamp: number;
};

export type CommandStartAgentEvent = {
  type: 'command.startAgent';
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  agentHarness: 'opencode' | 'pi';
  model: string;
  workingDir: string;
  reason: string;
  timestamp: number;
};

export type CommandStopAgentEvent = {
  type: 'command.stopAgent';
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  reason: string;
  timestamp: number;
};

export type ChatroomEvent =
  | AgentStartedEvent
  | AgentExitedEvent
  | TaskActivatedEvent
  | TaskCompletedEvent
  | CommandStartAgentEvent
  | CommandStopAgentEvent;
