import { join } from 'node:path';

/** Pi session directory for a working directory. Shared by the pi-sdk service and the pi-sdk direct adapter. */
export function getPiSessionDir(workingDir: string): string {
  return join(workingDir, '.chatroom', 'pi-sessions');
}
