import type { Readable, Writable } from 'node:stream';

export function forwardFiltered(
  source: Readable | undefined,
  target: Writable,
  shouldDrop: (line: string) => boolean
): void {
  if (!source) return;
  let buf = '';
  source.on('data', (chunk: Buffer | string) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!shouldDrop(line)) target.write(line + '\n');
    }
  });
  source.on('end', () => {
    if (buf.length > 0 && !shouldDrop(buf)) target.write(buf);
    buf = '';
  });
}
