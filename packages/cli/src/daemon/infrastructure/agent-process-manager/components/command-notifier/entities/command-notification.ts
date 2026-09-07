export type CommandNotificationStatus = 'succeeded' | 'failed';

/** Event emitted after a queue message has finished an execution attempt. */
export interface CommandNotification<T = unknown> {
  eventId: string;
  operationId: string;
  messageId: string;
  messageGroupId: string;
  body: T;
  status: CommandNotificationStatus;
  completedAt: number;
  receiveCount: number;
  error?: unknown;
}

export interface CommandNotificationFilter {
  messageId?: string;
  messageGroupId?: string;
  status?: CommandNotificationStatus;
}
