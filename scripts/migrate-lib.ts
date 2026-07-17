import path from 'path';
import { fileURLToPath } from 'url';

import { $ } from 'bun';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../services/backend');

export function isLocalMigrationTarget(): boolean {
  return !process.env.CONVEX_DEPLOY_KEY;
}

export async function runMigrations(): Promise<void> {
  const convexArgs = isLocalMigrationTarget() ? [] : ['--prod'];
  const cmd =
    convexArgs.length > 0
      ? $`npx convex run migrations:runAll ${convexArgs[0]}`.cwd(BACKEND_DIR)
      : $`npx convex run migrations:runAll`.cwd(BACKEND_DIR);
  await cmd.quiet();
}
