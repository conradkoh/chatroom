export interface AgentTaskKey {
  readonly chatroomId: string;
  readonly role: string;
}

export interface ActiveTaskState {
  readonly chatroomId: string;
  readonly role: string;
  readonly taskId: string;
}

export interface StartActiveTaskInput extends AgentTaskKey {
  readonly taskId: string;
}
