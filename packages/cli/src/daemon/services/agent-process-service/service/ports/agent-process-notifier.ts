export type AgentProcessNotificationStatus = 'succeeded' | 'failed' | 'cancelled';

export interface AgentProcessNotification<T = unknown> {
  readonly eventId: string;
  readonly operationId: string;
  readonly messageId: string;
  readonly messageGroupId: string;
  readonly body: T;
  readonly status: AgentProcessNotificationStatus;
  readonly completedAt: number;
  readonly receiveCount: number;
  readonly error?: unknown;
}

export interface AgentProcessNotificationFilter {
  readonly messageId?: string;
  readonly messageGroupId?: string;
  readonly status?: AgentProcessNotificationStatus;
}

export type AgentProcessNotificationListener<T> = (
  event: AgentProcessNotification<T>
) => void | Promise<void>;

export interface AgentProcessNotifier<T = unknown> {
  publish(event: AgentProcessNotification<T>): void;
  subscribe(
    filter: AgentProcessNotificationFilter,
    listener: AgentProcessNotificationListener<T>
  ): () => void;
}
