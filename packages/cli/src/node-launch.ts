#!/usr/bin/env node
/**
 * Re-exec chatroom with Node flags required by @cursor/sdk@1.0.19+.
 *
 * As of 2026-06-23, pinned to @cursor/sdk@1.0.19 — later SDK releases may drop
 * `node:sqlite` or change how local storage works; re-check this wrapper when bumping
 * the SDK pin in packages/cli/package.json.
 *
 * ## Why this wrapper exists
 *
 * `@cursor/sdk` uses Node's built-in `node:sqlite` for local agent run storage.
 * NODE_OPTIONS must be set before the process starts; the SDK loads sqlite during
 * harness detection when `CURSOR_API_KEY` is set (see cursor-sdk-agent-service.ts).
 *
 * ## About the ExperimentalWarning
 *
 * Daemon logs may show:
 *   ExperimentalWarning: SQLite is an experimental feature and might change at any time
 *
 * This is expected and harmless — not a daemon bug (verified with @cursor/sdk@1.0.19,
 * 2026-06-23). Node still marks `node:sqlite` as experimental on v22–v24 even after
 * the `--experimental-sqlite` gate was removed. The warning fires when the daemon
 * probes the cursor-sdk harness, not on every command.
 *
 * Do not try to fix it by:
 * - Removing `--experimental-sqlite` (older Node needs it; harmless on newer Node)
 * - Eagerly importing or avoiding `@cursor/sdk` in chatroom (SDK already deferred via loadSdk())
 *
 * To silence the warning deliberately, add `--disable-warning=ExperimentalWarning` below.
 * See: https://nodejs.org/api/cli.html#--disable-warningcode-or-type
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const main = join(dirname(fileURLToPath(import.meta.url)), 'index.js');
const nodeOptions = (process.env.NODE_OPTIONS ?? '').split(/\s+/).filter(Boolean);
// Required for @cursor/sdk → node:sqlite on Node <24.2; no-op on newer releases.
if (!nodeOptions.some((opt) => opt.includes('experimental-sqlite'))) {
  nodeOptions.push('--experimental-sqlite');
}

const result = spawnSync(process.execPath, [main, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions.join(' ') },
});

if (result.signal) {
  process.exit(1);
}
process.exit(result.status ?? 1);
