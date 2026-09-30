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

const roleKey = (chatroomId: string, role: string): string => `${chatroomId}:${role.toLowerCase()}`;

/**
 * Internal native-agent delivery scheduler. It serializes delivery per
 * chatroom/role; it is not a task-update subscription or a Convex outbox.
 */
export class NativeTaskDeliveryQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly epochs = new Map<string, number>();
  private stopped = false;

  constructor(private readonly sender: Sender) {}

  enqueue(entry: NativeTaskDeliveryQueueEntry): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const key = roleKey(entry.task.chatroomId, entry.task.agentConfig.role);
    const epoch = this.epochs.get(key) ?? 0;
    this.epochs.set(key, epoch);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.stopped || epoch !== (this.epochs.get(key) ?? 0)) return;
        await this.sender(entry);
      });
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

  // This role-scoped contract is consumed by the lifecycle gate in the next slice.
  /** Invalidates queued work immediately, then drains the previous role tail. */
  // fallow-ignore-next-line unused-class-member
  invalidateRole(chatroomId: string, role: string): Promise<void> {
    const key = roleKey(chatroomId, role);
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
    const previous = this.tails.get(key);
    return previous?.catch(() => undefined) ?? Promise.resolve();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const [key, epoch] of this.epochs) this.epochs.set(key, epoch + 1);
    const tails = [...this.tails.values()];
    this.tails.clear();
    // stop remains synchronous for existing owners; observe detached failures.
    void Promise.allSettled(tails);
  }
}
