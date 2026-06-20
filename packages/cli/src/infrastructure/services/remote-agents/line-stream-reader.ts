import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

export function attachLineReader(stream: Readable, onLine: (line: string) => void): void {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  rl.on('line', onLine);
}
