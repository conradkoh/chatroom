/** Per-(chatroom, role) delivery coordination — replaces per-task ledger dedup. */

function roleKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}

class RoleDeliveryState {
  private readonly generation = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private readonly nativeNudgeFailures = new Map<string, number>();

  getGeneration(chatroomId: string, role: string): number {
    return this.generation.get(roleKey(chatroomId, role)) ?? 0;
  }

  /** Bump generation — invalidates in-flight delivery attempts (restart / session loss). */
  resetDeliveryState(chatroomId: string, role: string): number {
    const key = roleKey(chatroomId, role);
    const next = (this.generation.get(key) ?? 0) + 1;
    this.generation.set(key, next);
    this.inFlight.delete(key);
    this.nativeNudgeFailures.delete(key);
    return next;
  }

  tryAcquireDelivery(chatroomId: string, role: string): boolean {
    const key = roleKey(chatroomId, role);
    if (this.inFlight.has(key)) return false;
    this.inFlight.add(key);
    return true;
  }

  releaseDelivery(chatroomId: string, role: string): void {
    this.inFlight.delete(roleKey(chatroomId, role));
  }

  recordNativeNudgeFailure(chatroomId: string, role: string): number {
    const key = roleKey(chatroomId, role);
    const count = (this.nativeNudgeFailures.get(key) ?? 0) + 1;
    this.nativeNudgeFailures.set(key, count);
    return count;
  }

  clearNativeNudgeFailures(chatroomId: string, role: string): void {
    this.nativeNudgeFailures.delete(roleKey(chatroomId, role));
  }

  getNativeNudgeFailures(chatroomId: string, role: string): number {
    return this.nativeNudgeFailures.get(roleKey(chatroomId, role)) ?? 0;
  }
}

let shared: RoleDeliveryState | undefined;

export function getRoleDeliveryState(): RoleDeliveryState {
  shared ??= new RoleDeliveryState();
  return shared;
}
