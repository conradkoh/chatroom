import type { LogLine } from '../api/types.js';

export function getLogHarness(line: LogLine): string | undefined {
  const v = line.metadata?.harness;
  return typeof v === 'string'
    ? v
    : line.source.startsWith('harness:')
      ? line.source.slice(8)
      : undefined;
}
export function getLogChatroomId(line: LogLine): string | undefined {
  const v = line.metadata?.chatroomId;
  return typeof v === 'string' ? v : undefined;
}
export function getLogRole(line: LogLine): string | undefined {
  const v = line.metadata?.role;
  return typeof v === 'string' ? v : undefined;
}
