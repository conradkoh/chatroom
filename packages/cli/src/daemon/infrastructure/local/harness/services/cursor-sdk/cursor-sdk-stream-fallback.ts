import type { InteractionUpdate, SDKMessage } from '@cursor/sdk';

import { formatAgentLogLine } from '../agent-log-format.js';

const MAX_LOG_CHARS = 500;

function truncateJson(value: unknown): string {
  const raw = JSON.stringify(value);
  return raw.length <= MAX_LOG_CHARS ? raw : `${raw.slice(0, MAX_LOG_CHARS)}…`;
}

/** Log an SDKMessage type we don't explicitly handle — keeps daemon alive, aids patching. */
export function logUnhandledSdkMessage(
  logPrefix: string,
  message: SDKMessage,
  writeLine: (formatted: string) => void
): void {
  writeLine(
    formatAgentLogLine(logPrefix, 'stream:unhandled', `${message.type}: ${truncateJson(message)}`)
  );
}

/** Log an InteractionUpdate delta we don't explicitly handle. */
export function logUnhandledInteractionDelta(
  logPrefix: string,
  update: InteractionUpdate,
  writeLine: (formatted: string) => void
): void {
  writeLine(
    formatAgentLogLine(logPrefix, 'delta:unhandled', `${update.type}: ${truncateJson(update)}`)
  );
}
