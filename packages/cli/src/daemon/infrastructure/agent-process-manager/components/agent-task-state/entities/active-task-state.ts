export interface AgentTaskKey {
  readonly chatroomId: string;
  readonly role: string;
}

export type ActiveTaskStatus = 'in_flight' | 'handed_off' | 'reminder_requested';

export interface ActiveTaskState {
  readonly chatroomId: string;
  readonly role: string;
  readonly taskId: string;
  readonly generation: number;
  readonly status: ActiveTaskStatus;
  readonly handedOff: boolean;
  readonly reminderAttempts: number;
  readonly lastTurnEndEventId?: string | undefined;
}

export interface StartActiveTaskInput extends AgentTaskKey {
  readonly taskId: string;
}

export interface TaskStateVersion {
  readonly taskId: string;
  readonly generation: number;
}
