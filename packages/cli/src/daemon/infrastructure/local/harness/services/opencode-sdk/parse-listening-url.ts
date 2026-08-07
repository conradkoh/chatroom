import type { ChildProcess } from 'node:child_process';

export const LISTENING_URL_RE =
  /opencode server listening on (https?:\/\/127\.0\.0\.1:\d+(?:\/[^\s]*)?)/;

/**
 * Wait for `opencode serve` to print its listening URL line and resolve to it.
 *
 * The output may arrive in multiple `data` events when Node back-pressures the
 * child's stdout/stderr — the listening line can be split across chunks (e.g.
 * `…http://127.0.0.` then `1:5678\n`). We therefore accumulate per-stream
 * buffers and only run the regex against the joined buffer up to the most
 * recent newline. This makes the parser robust to chunk boundaries without
 * risking unbounded buffer growth on noisy output (we trim everything before
 * the last newline once a chunk is processed).
 *
 * Resolves with the first matched URL. Rejects on early child exit or the
 * caller-supplied timeout.
 */
export async function waitForListeningUrl(
  child: ChildProcess,
  options: { timeoutMs: number }
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const buffers = { stdout: '', stderr: '' };

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.removeListener('data', onStdout);
      child.stderr?.removeListener('data', onStderr);
      child.removeListener('exit', onExit);
    };

    const tryMatch = (key: 'stdout' | 'stderr', chunk: Buffer | string) => {
      buffers[key] += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const match = buffers[key].match(LISTENING_URL_RE);
      if (match) {
        cleanup();
        resolve(match[1]);
        return;
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
