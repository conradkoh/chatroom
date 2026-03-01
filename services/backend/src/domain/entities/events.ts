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

export type AgentRequestStartEvent = {
  type: 'agent.requestStart';
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  agentHarness: 'opencode' | 'pi';
  model: string;
  workingDir: string;
  reason: string;
  deadline: number;
  timestamp: number;
};

export type AgentRequestStopEvent = {
  type: 'agent.requestStop';
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  reason: string;
  deadline: number;
  timestamp: number;
};

export type AgentRegisteredEvent = {
  type: 'agent.registered';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentType: 'custom' | 'remote';
  machineId?: string;
  timestamp: number;
};

export type AgentWaitingEvent = {
  type: 'agent.waiting';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId?: string;
  timestamp: number;
};

export type TaskAcknowledgedEvent = {
  type: 'task.acknowledged';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  taskId: Id<'chatroom_tasks'>;
  timestamp: number;
};

export type TaskInProgressEvent = {
  type: 'task.inProgress';
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  taskId: Id<'chatroom_tasks'>;
  timestamp: number;
};

export type DaemonPingEvent = {
  type: 'daemon.ping';
  machineId: string;
  timestamp: number;
};

export type DaemonPongEvent = {
  type: 'daemon.pong';
  machineId: string;
  pingEventId: Id<'chatroom_eventStream'>;
  timestamp: number;
};

export type ChatroomEvent =
  | AgentStartedEvent
  | AgentExitedEvent
  | TaskActivatedEvent
  | TaskCompletedEvent
  | AgentRequestStartEvent
  | AgentRequestStopEvent
  | AgentRegisteredEvent
  | AgentWaitingEvent
  | TaskAcknowledgedEvent
  | TaskInProgressEvent
  | DaemonPingEvent
  | DaemonPongEvent;
