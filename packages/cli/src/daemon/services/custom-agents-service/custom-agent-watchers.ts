/**
 * File watchers for the custom-agent roots.
 *
 * Watches `<workspace>/.chatroom/agents` and `~/.chatroom/agents` so an edit
 * reaches the service inside the debounce window instead of waiting for the
 * fallback poll. Every event only signals `onChange`; filtering, validation, and
 * coalescing stay in the loader and the service.
 *
 * Constraints:
 * - Only existing roots are watched. Creating a directory to make a watcher work
 *   would add filesystem state the user did not ask for; the poll is the backstop
 *   for a root that appears later.
 * - Watcher errors are logged once per watcher and never thrown. A failed watcher
 *   must not stop the daemon, and the poll keeps covering the root.
 * - Root removal closes watchers synchronously (the close promise is not awaited),
 *   so no event from a removed workspace can reach the service.
 * - No debounce here: `awaitWriteFinish` absorbs partial writes and the service's
 *   own trailing debounce absorbs bursts.
 */

import type { FSWatcher, watch as chokidarWatch } from 'chokidar';

/** Depth covers `<root>/<agent>/AGENT.md` and the two optional template files. */
const WATCH_OPTIONS = {
  depth: 2,
  ignoreInitial: true,
  ignorePermissionErrors: true,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
} as const;

const WATCHED_EVENTS = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const;

export interface CustomAgentWatchers {
  /** Attach watchers for roots that exist, and close watchers for roots no longer wanted. */
  syncRoots(roots: readonly string[]): void;
  /** Close every watcher. Resolves once all closes have settled. */
  closeAll(): Promise<void>;
}

export interface CreateCustomAgentWatchersInput {
  /** Called for every watcher event. The caller passes `() => service.refresh('watch')`. */
  onChange(): void;
  log(message: string): void;
  watch: typeof chokidarWatch;
  existsSync(path: string): boolean;
}

export function createCustomAgentWatchers(
  input: CreateCustomAgentWatchersInput
): CustomAgentWatchers {
  const watchers = new Map<string, FSWatcher>();
  let closed = false;

  return {
    syncRoots(roots) {
      if (closed) return;
      closeUnwanted(watchers, new Set(roots));
      attachMissing(input, watchers, roots);
    },

    async closeAll() {
      closed = true;
      const pending = [...watchers.values()];
      watchers.clear();
      await Promise.all(pending.map((watcher) => watcher.close().catch(() => undefined)));
    },
  };
}

/** Logs the first error per watcher only; a broken watcher is not a broken daemon. */
function attachErrorLogger(watcher: FSWatcher, root: string, log: (message: string) => void): void {
  let logged = false;
  watcher.on('error', (error: unknown) => {
    if (logged) return;
    logged = true;
    log(`[custom-agents] watcher error for ${root}: ${String(error)}`);
  });
}

function closeUnwanted(watchers: Map<string, FSWatcher>, wanted: ReadonlySet<string>): void {
  for (const [root, watcher] of watchers) {
    if (wanted.has(root)) continue;
    watchers.delete(root);
    void watcher.close().catch(() => undefined);
  }
}

function attachMissing(
  input: CreateCustomAgentWatchersInput,
  watchers: Map<string, FSWatcher>,
  roots: readonly string[]
): void {
  for (const root of roots) {
    if (watchers.has(root) || !input.existsSync(root)) continue;
    watchers.set(root, attachFor(input, root));
  }
}

function attachFor(input: CreateCustomAgentWatchersInput, root: string): FSWatcher {
  const watcher = input.watch(root, WATCH_OPTIONS);
  for (const event of WATCHED_EVENTS) watcher.on(event, () => input.onChange());
  attachErrorLogger(watcher, root, input.log);
  return watcher;
}
