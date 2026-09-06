/**
 * Tracks native task delivery attempts and successful deliveries.
 *
 * Constraints:
 * - An attempt lifetime is keyed by task id only, so session replacement
 *   (cold start) cannot orphan the in-flight reservation.
 * - Successful delivery is keyed by task plus the real resolved harness
 *   session id; only real session ids may reach receipts/delivery records.
 * - Session-loss cleanup removes completed records only and must not unlock
 *   a still-running attempt (e.g. during an intentional cold replacement).
 */
export class NativeDeliveryLedger {
  private readonly delivered = new Set<string>();
  private readonly inFlight = new Set<string>();

  private deliveryKey(taskId: string, harnessSessionId: string): string {
    return `${taskId}\0${harnessSessionId}`;
  }

  isDelivered(taskId: string, harnessSessionId: string): boolean {
    return this.delivered.has(this.deliveryKey(taskId, harnessSessionId));
  }

  isAttemptInFlight(taskId: string): boolean {
    return this.inFlight.has(taskId);
  }

  /**
   * Reserve a delivery attempt; returns false if an attempt is already in
   * flight for this task, or the task was already delivered in the existing
   * (real) harness session.
   */
  // fallow-ignore-next-line unused-class-member
  tryAcquire(taskId: string, existingSessionId?: string | undefined): boolean {
    if (this.inFlight.has(taskId)) {
      return false;
    }
    if (existingSessionId && this.delivered.has(this.deliveryKey(taskId, existingSessionId))) {
      return false;
    }
    this.inFlight.add(taskId);
    return true;
  }

  /** Release the attempt without recording delivery (failure/wait path). */
  // fallow-ignore-next-line unused-class-member
  releaseAttempt(taskId: string): void {
    this.inFlight.delete(taskId);
  }

  // fallow-ignore-next-line unused-class-member
  markDelivered(taskId: string, harnessSessionId: string): void {
    this.inFlight.delete(taskId);
    this.delivered.add(this.deliveryKey(taskId, harnessSessionId));
  }

  // fallow-ignore-next-line unused-class-member
  clearDelivery(taskId: string, harnessSessionId?: string | undefined): void {
    this.inFlight.delete(taskId);
    if (harnessSessionId) {
      this.delivered.delete(this.deliveryKey(taskId, harnessSessionId));
    } else {
      const prefix = `${taskId}\0`;
      for (const key of [...this.delivered]) {
        if (key.startsWith(prefix)) {
          this.delivered.delete(key);
        }
      }
    }
  }

  /** Drop completed delivery records for a harness session that ended. */
  // fallow-ignore-next-line unused-class-member
  clearSession(harnessSessionId: string): void {
    const suffix = `\0${harnessSessionId}`;
    for (const key of [...this.delivered]) {
      if (key.endsWith(suffix)) {
        this.delivered.delete(key);
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
