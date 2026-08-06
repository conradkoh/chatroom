/** Tracks successful native task deliveries per harness session generation. */
export class NativeDeliveryLedger {
  private readonly delivered = new Set<string>();
  private readonly inFlight = new Set<string>();

  private deliveryKey(taskId: string, harnessSessionId: string): string {
    return `${taskId}\0${harnessSessionId}`;
  }

  isDelivered(taskId: string, harnessSessionId: string): boolean {
    return this.delivered.has(this.deliveryKey(taskId, harnessSessionId));
  }

  /** Reserve a delivery attempt; returns false if already delivered or in flight. */
  // fallow-ignore-next-line unused-class-member
  tryAcquire(taskId: string, harnessSessionId: string): boolean {
    const key = this.deliveryKey(taskId, harnessSessionId);
    if (this.delivered.has(key) || this.inFlight.has(key)) {
      return false;
    }
    this.inFlight.add(key);
    return true;
  }

  // fallow-ignore-next-line unused-class-member
  markDelivered(taskId: string, harnessSessionId: string): void {
    const key = this.deliveryKey(taskId, harnessSessionId);
    this.inFlight.delete(key);
    this.delivered.add(key);
  }

  // fallow-ignore-next-line unused-class-member
  clearDelivery(taskId: string, harnessSessionId: string): void {
    const key = this.deliveryKey(taskId, harnessSessionId);
    this.inFlight.delete(key);
    this.delivered.delete(key);
  }

  /** Drop ledger entries for a harness session that ended. */
  // fallow-ignore-next-line unused-class-member
  clearSession(harnessSessionId: string): void {
    const suffix = `\0${harnessSessionId}`;
    for (const key of [...this.delivered, ...this.inFlight]) {
      if (key.endsWith(suffix)) {
        this.delivered.delete(key);
        this.inFlight.delete(key);
      }
    }
  }
}

let sharedLedger: NativeDeliveryLedger | undefined;

export function getNativeDeliveryLedger(): NativeDeliveryLedger {
  sharedLedger ??= new NativeDeliveryLedger();
  return sharedLedger;
}

/** Test-only reset. */
// fallow-ignore-next-line unused-export
export function resetNativeDeliveryLedgerForTests(): void {
  sharedLedger = undefined;
}
