import { homedir } from 'node:os';
import { join } from 'node:path';

import { resolveEnvSlug } from './resolve-env-slug.js';
import { getConvexUrl } from '../convex/client.js';

export function resolveLogsDbPath(convexUrl?: string): string {
  return join(homedir(), '.chatroom', resolveEnvSlug(convexUrl ?? getConvexUrl()), 'logs.sqlite');
}
