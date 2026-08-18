/**
 * Daemon Stop Command
 *
 * Stop the running machine daemon.
 */

import { isDaemonRunning, removePid, stopExistingDaemons } from './pid.js';

/**
 * Stop the daemon
 */
// fallow-ignore-next-line complexity
export async function daemonStop(): Promise<void> {
  const { running, pid } = isDaemonRunning();

  const stopped = await stopExistingDaemons();
  removePid();

  if (!running && stopped.length === 0) {
    console.log(`⚪ Daemon is not running`);
    return;
  }

  if (stopped.length === 0 && pid !== null) {
    console.log(`Stopping daemon (PID: ${pid})...`);
  }

  console.log(`✅ Daemon stopped`);
}
