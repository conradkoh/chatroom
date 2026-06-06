/**
 * Prevents stray promise rejections (e.g. from SDK stream cleanup) from
 * terminating the long-running machine daemon process.
 */

let installed = false;

function formatReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.stack ?? reason.message;
  }
  return String(reason);
}

/**
 * Install a process-level guard so unhandled rejections are logged but do not
 * crash the daemon. Safe to call more than once (subsequent calls are no-ops).
 */
export function installDaemonFatalErrorGuard(): void {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => {
    console.error(
      `[${new Date().toISOString()}] [daemon] Unhandled promise rejection — daemon continuing:\n${formatReason(reason)}`
    );
  });
}
