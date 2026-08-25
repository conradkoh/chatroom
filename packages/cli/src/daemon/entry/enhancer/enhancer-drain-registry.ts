let drainFn: (() => Promise<void>) | null = null;

export function setEnhancerDrainHandler(fn: () => Promise<void>): void {
  drainFn = fn;
}

export async function drainPendingEnhancerJobsIfRegistered(): Promise<void> {
  if (drainFn) await drainFn();
}

export function clearEnhancerDrainHandlerForTests(): void {
  drainFn = null;
}
