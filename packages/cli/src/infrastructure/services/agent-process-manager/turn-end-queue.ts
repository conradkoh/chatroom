/**
 * Serializes async turn-end handlers so production and tests can await completion.
 */
export class TurnEndQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue(work: () => Promise<void>): void {
    this.tail = this.tail.then(work).catch((err: Error) => {
      console.log(`[TurnEndQueue] turn-end handler failed: ${err.message}`);
    });
  }

  async whenIdle(): Promise<void> {
    await this.tail;
  }
}
