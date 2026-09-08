import type { AssignedTaskWithContent } from '../../../domain/entities/assigned-task.js';

export type TaskOutboxEntry = {
  readonly task: AssignedTaskWithContent;
  readonly harnessSessionId: string | undefined;
  readonly onTaskDelivered:
    | ((args: {
        chatroomId: string;
        role: string;
        taskId: string;
        harnessSessionId: string;
      }) => void)
    | undefined;
};

type Sender = (entry: TaskOutboxEntry) => Promise<void>;

/**
 * Task-service-owned content outbox.
 *
 * Delivery is serialized per chatroom/role, so callers can enqueue work
 * without creating a second delivery coordinator or sending content directly.
 */
export class TaskOutbox {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly sender: Sender) {}

  enqueue(entry: TaskOutboxEntry): Promise<void> {
    const key = `${entry.task.chatroomId}:${entry.task.agentConfig.role.toLowerCase()}`;
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.sender(entry));
    this.tails.set(key, next);
    void next.then(
      () => {
        if (this.tails.get(key) === next) this.tails.delete(key);
      },
      () => {
        if (this.tails.get(key) === next) this.tails.delete(key);
      }
    );
    return next;
  }

  stop(): void {
    this.tails.clear();
  }
}
