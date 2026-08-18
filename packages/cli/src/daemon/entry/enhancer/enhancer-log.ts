import { ENHANCER_AGENT_ROLE } from './constants.js';
import type { AgentLogSink } from '../../../infrastructure/log-server/index.js';

export const ENHANCER_LOG_PREFIX = '[enhancer]';

export type EnhancerLogContext = {
  chatroomId: string;
  harness: string;
  pid?: number;
};

export type EnhancerLogWriter = {
  write(message: string): void;
};

export function formatEnhancerLogLine(message: string): string {
  const trimmed = message.trimEnd();
  if (trimmed.startsWith(ENHANCER_LOG_PREFIX)) return trimmed;
  return `${ENHANCER_LOG_PREFIX} ${trimmed}`;
}

export function createEnhancerLogWriter(
  logSink: AgentLogSink | undefined,
  context: EnhancerLogContext,
  clock: () => number = () => Date.now()
): EnhancerLogWriter {
  return {
    write(message: string) {
      const formatted = formatEnhancerLogLine(message);
      process.stdout.write(`${formatted}\n`);
      logSink?.write({
        timestamp: clock(),
        level: 'info',
        source: `harness:${context.harness}`,
        stream: 'stdout',
        message: formatted,
        metadata: {
          chatroomId: context.chatroomId,
          role: ENHANCER_AGENT_ROLE,
          harness: context.harness,
          ...(context.pid !== undefined ? { pid: context.pid } : {}),
        },
      });
    },
  };
}

/** @deprecated Prefer createEnhancerLogWriter for daemon log viewer support. */
export function writeEnhancerLog(message: string): void {
  process.stdout.write(`${formatEnhancerLogLine(message)}\n`);
}
