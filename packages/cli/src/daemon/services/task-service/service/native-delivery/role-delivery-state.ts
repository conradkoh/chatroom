/** Per-(chatroom, role) delivery coordination — replaces per-task ledger dedup. */

function roleKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}

class RoleDeliveryState {
  private readonly generation = new Map<string, number>();
  private readonly inFlight = new Set<string>();

  getGeneration(chatroomId: string, role: string): number {
    return this.generation.get(roleKey(chatroomId, role)) ?? 0;
  }

  /** Bump generation — invalidates in-flight delivery attempts (restart / session loss). */
  resetDeliveryState(chatroomId: string, role: string): number {
    const key = roleKey(chatroomId, role);
    const next = (this.generation.get(key) ?? 0) + 1;
    this.generation.set(key, next);
    this.inFlight.delete(key);
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
}

let shared: RoleDeliveryState | undefined;

export function getRoleDeliveryState(): RoleDeliveryState {
  shared ??= new RoleDeliveryState();
  return shared;
}
