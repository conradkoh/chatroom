import type { AssignedTaskWithContent } from '../../../domain/entities/assigned-task.js';

export type NativeTaskDeliveryQueueEntry = {
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

type Sender = (entry: NativeTaskDeliveryQueueEntry) => Promise<void>;

/**
 * Internal native-agent delivery scheduler. It serializes delivery per
 * chatroom/role; it is not a task-update subscription or a Convex outbox.
 */
export class NativeTaskDeliveryQueue {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly sender: Sender) {}

  enqueue(entry: NativeTaskDeliveryQueueEntry): Promise<void> {
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
