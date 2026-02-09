/**
 * Daemon Stop Command
 *
 * Stop the running machine daemon.
 */

import { isDaemonRunning, removePid } from './pid.js';

/**
 * Stop the daemon
 */
export async function daemonStop(): Promise<void> {
  const { running, pid } = isDaemonRunning();

  if (!running) {
    console.log(`⚪ Daemon is not running`);
    return;
  }

  console.log(`Stopping daemon (PID: ${pid})...`);

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(pid!, 'SIGTERM');

    // Wait a moment for process to exit
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if still running
    try {
      process.kill(pid!, 0);
      // Still running - send SIGKILL
      console.log(`Process did not exit gracefully, forcing...`);
      process.kill(pid!, 'SIGKILL');
    } catch {
      // Process exited
    }

    // Clean up PID file
    removePid();

    console.log(`✅ Daemon stopped`);
  } catch (error) {
    console.error(`❌ Failed to stop daemon: ${(error as Error).message}`);
    // Clean up stale PID file
    removePid();
  }
}
