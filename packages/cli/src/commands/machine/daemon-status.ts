/**
 * Daemon Status Command
 *
 * Check if the machine daemon is running.
 */

import { isDaemonRunning, getPidFilePath } from './pid.js';

/**
 * Check and display daemon status
 */
export async function daemonStatus(): Promise<void> {
  const { running, pid } = isDaemonRunning();

  if (running) {
    console.log(`✅ Daemon is running`);
    console.log(`   PID: ${pid}`);
    console.log(`   PID file: ${getPidFilePath()}`);
  } else {
    console.log(`⚪ Daemon is not running`);
    console.log(`\nTo start the daemon:`);
    console.log(`   chatroom machine daemon start`);
  }
}
