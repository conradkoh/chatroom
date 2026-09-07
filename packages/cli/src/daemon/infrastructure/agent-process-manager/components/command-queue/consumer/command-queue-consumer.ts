import type { CommandQueueConsumerDependencies, CommandQueueConsumerOptions } from './types.js';
import type { ReceivedCommandMessage } from '../entities/command-message.js';

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class CommandQueueConsumer<T> {
  private running = false;
  private loopPromise: Promise<void> | undefined;

  constructor(
    private readonly deps: CommandQueueConsumerDependencies<T>,
    private readonly options: CommandQueueConsumerOptions = {}
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.loopPromise = undefined;
  }

  async runOnce(): Promise<number> {
    const messages = await this.deps.queue.receiveMessages({
      maxNumberOfMessages: this.options.maxNumberOfMessages ?? 10,
      visibilityTimeoutMs: this.options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS,
    });
    await Promise.all(messages.map((message) => this.processMessage(message)));
    return messages.length;
  }

  private async runLoop(): Promise<void> {
    const sleep = this.deps.sleep ?? defaultSleep;
    const pollIntervalMs = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    while (this.running) {
      try {
        const processed = await this.runOnce();
        if (processed === 0) await sleep(pollIntervalMs);
      } catch (error) {
        this.deps.onError?.(error);
        await sleep(pollIntervalMs);
      }
    }
  }

  private async processMessage(message: ReceivedCommandMessage<T>): Promise<void> {
    const visibilityTimeoutMs = this.options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
    const renewalIntervalMs =
      this.options.visibilityRenewalIntervalMs ?? Math.max(1, Math.floor(visibilityTimeoutMs / 2));
    const renewalTimer = setInterval(() => {
      void this.deps.queue
        .changeMessageVisibility(message.receiptHandle, visibilityTimeoutMs)
        .catch((error: unknown) => this.deps.onError?.(error, message));
    }, renewalIntervalMs);
    renewalTimer.unref?.();

    try {
      await this.deps.dispatch(message);
      await this.deps.queue.deleteMessage(message.receiptHandle);
    } catch (error) {
      this.deps.onError?.(error, message);
    } finally {
      clearInterval(renewalTimer);
    }
  }
}
