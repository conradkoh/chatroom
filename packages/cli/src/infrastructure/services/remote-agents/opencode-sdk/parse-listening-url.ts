import type { EventEmitter } from 'node:events';

export const LISTENING_URL_RE =
  /opencode server listening on (https?:\/\/127\.0\.0\.1:\d+(?:\/[^\s]*)?)/;

export interface ChildLike {
  pid: number | undefined;
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: string | null) => void): this;
  emit(event: string, ...args: unknown[]): boolean;
  listenerCount(event: string): number;
  off(event: string, listener: (...args: unknown[]) => void): this;
  removeListener(event: string, listener: (...args: unknown[]) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export async function waitForListeningUrl(
  child: ChildLike,
  options: { timeoutMs: number }
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`opencode serve did not print a listening URL within ${options.timeoutMs}ms`)
        ),
      options.timeoutMs
    );

    const onData = (buf: Buffer) => {
      const s = buf.toString();
      const match = s.match(LISTENING_URL_RE);
      if (match) {
        clearTimeout(timer);
        child.stdout?.removeListener('data', onData as (...args: unknown[]) => void);
        child.stderr?.removeListener('data', onData as (...args: unknown[]) => void);
        resolve(match[1]);
      }
    };

    child.stdout?.on('data', onData as (...args: unknown[]) => void);
    child.stderr?.on('data', onData as (...args: unknown[]) => void);

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      child.stdout?.removeListener('data', onData as (...args: unknown[]) => void);
      child.stderr?.removeListener('data', onData as (...args: unknown[]) => void);
      reject(
        new Error(
          `opencode serve exited unexpectedly during startup (code=${code}, signal=${signal})`
        )
      );
    });
  });
}
