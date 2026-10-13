import type { ChildProcess } from 'node:child_process';

export const LISTENING_URL_RE =
  /(?:opencode )?server listening on (https?:\/\/127\.0\.0\.1:\d+(?:\/[^\s]*)?)/;

/**
 * V2 `opencode serve` prints its private password once at startup. The client
 * authenticates with HTTP Basic (`opencode:<password>`).
 */
const SERVER_PASSWORD_RE = /server password (\S+)/;

export interface ServerStartupInfo {
  readonly url: string;
  /** Private service password, when authentication is enabled. */
  readonly password?: string | undefined;
}

/** Build the Basic auth header `opencode serve` expects, if a password was printed. */
export function serverAuthHeaders(
  password: string | undefined
): Record<string, string> | undefined {
  if (!password) return undefined;
  return {
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
  };
}

/** How long to wait for the password line after the listening URL appears. */
const PASSWORD_GRACE_MS = 250;

/**
 * Wait for `opencode serve` to print its listening URL (and password) and
 * resolve to them.
 *
 * The output may arrive in multiple `data` events when Node back-pressures the
 * child's stdout/stderr — the listening line can be split across chunks (e.g.
 * `…http://127.0.0.` then `1:5678\n`). We therefore accumulate per-stream
 * buffers and only run the regex against the joined buffer up to the most
 * recent newline. This makes the parser robust to chunk boundaries without
 * risking unbounded buffer growth on noisy output (we trim everything before
 * the last newline once a chunk is processed).
 *
 * The URL resolves first; the password line follows immediately after, so we
 * briefly wait for it (bounded by {@link PASSWORD_GRACE_MS}) before resolving so
 * the caller can authenticate.
 *
 * Resolves with the first matched URL. Rejects on early child exit or the
 * caller-supplied timeout.
 */
export async function waitForListeningUrl(
  child: ChildProcess,
  options: { timeoutMs: number }
): Promise<ServerStartupInfo> {
  return new Promise<ServerStartupInfo>((resolve, reject) => {
    const buffers = { stdout: '', stderr: '' };
    let url: string | undefined;
    let password: string | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      child.stdout?.removeListener('data', onStdout);
      child.stderr?.removeListener('data', onStderr);
      child.removeListener('exit', onExit);
    };

    const finish = () => {
      if (url === undefined) return;
      cleanup();
      resolve({ url, ...(password !== undefined ? { password } : {}) });
    };

    // fallow-ignore-next-line complexity
    const tryMatch = (key: 'stdout' | 'stderr', chunk: Buffer | string) => {
      buffers[key] += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const text = buffers[key];

      if (url === undefined) {
        const urlMatch = text.match(LISTENING_URL_RE);
        if (urlMatch) url = urlMatch[1];
      }
      if (password === undefined) {
        const passwordMatch = text.match(SERVER_PASSWORD_RE);
        if (passwordMatch) password = passwordMatch[1];
      }

      if (url !== undefined) {
        if (password !== undefined) {
          finish();
          return;
        }
        // URL seen; give the password line a brief window to arrive.
        settleTimer ??= setTimeout(finish, PASSWORD_GRACE_MS);
      }

      // Trim everything up to (and including) the last newline so the buffer
      // can't grow unbounded on a chatty serve process. The remainder is the
      // partial line we may still need to combine with the next chunk.
      const lastNl = buffers[key].lastIndexOf('\n');
      if (lastNl >= 0) {
        buffers[key] = buffers[key].slice(lastNl + 1);
      }
    };

    const onStdout = (chunk: Buffer | string) => tryMatch('stdout', chunk);
    const onStderr = (chunk: Buffer | string) => tryMatch('stderr', chunk);

    const onExit = (code: number | null, signal: string | null) => {
      cleanup();
      reject(
        new Error(
          `opencode serve exited unexpectedly during startup (code=${code}, signal=${signal})`
        )
      );
    };

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.on('exit', onExit);

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(`opencode serve did not print a listening URL within ${options.timeoutMs}ms`)
      );
    }, options.timeoutMs);
  });
}
