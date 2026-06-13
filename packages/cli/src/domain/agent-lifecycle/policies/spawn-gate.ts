export function shouldBypassConcurrentLimit(spawnReason: string): boolean {
  return spawnReason.startsWith('user.') || spawnReason === 'platform.crash_recovery';
}
