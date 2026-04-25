import type { ChildProcess } from 'node:child_process';

export const LISTENING_URL_RE =
  /opencode server listening on (https?:\/\/127\.0\.0\.1:\d+(?:\/[^\s]*)?)/;

export async function waitForListeningUrl(
  child: ChildProcess,
  options: { timeoutMs: number }
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const onData = (buf: Buffer) => {
      const s = buf.toString();
      const match = s.match(LISTENING_URL_RE);
      if (match) {
        clearTimeout(timer);
        child.stdout?.removeListener('data', onData as (...args: unknown[]) => void);
        child.stderr?.removeListener('data', onData as (...args: unknown[]) => void);
        child.removeListener('exit', onExit);
        resolve(match[1]);
      }
    };

    const onExit = (code: number | null, signal: string | null) => {
      clearTimeout(timer);
      child.stdout?.removeListener('data', onData as (...args: unknown[]) => void);
      child.stderr?.removeListener('data', onData as (...args: unknown[]) => void);
      child.removeListener('exit', onExit);
      reject(
        new Error(
          `opencode serve exited unexpectedly during startup (code=${code}, signal=${signal})`
        )
      );
    };

    child.stdout?.on('data', onData as (...args: unknown[]) => void);
    child.stderr?.on('data', onData as (...args: unknown[]) => void);
    child.on('exit', onExit);

    const timer = setTimeout(() => {
      child.stdout?.removeListener('data', onData as (...args: unknown[]) => void);
      child.stderr?.removeListener('data', onData as (...args: unknown[]) => void);
      child.removeListener('exit', onExit);
      reject(
        new Error(`opencode serve did not print a listening URL within ${options.timeoutMs}ms`)
      );
    }, options.timeoutMs);
  });
}
