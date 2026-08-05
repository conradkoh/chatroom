/**
 * v2 daemon entry point — NOT ACTIVE until final migration slice.
 * Legacy: packages/cli/src/commands/machine/daemon-start/index.ts
 */
export async function startDaemonV2(): Promise<void> {
  throw new Error('v2 entry not active — migrate subscribers first');
}
