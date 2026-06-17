import type { Writable } from 'node:stream';

export interface AgentLogContext {
  role?: string;
  chatroomId?: string;
}

/** Bracket-open prefix: `[agent:role@suffix` — the kind segment supplies the closing `]`. */
export function buildAgentLogPrefix(agent: string, context: AgentLogContext): string {
  const roleTag = context.role ?? 'unknown';
  const chatroomSuffix = context.chatroomId ? `@${context.chatroomId.slice(-6)}` : '';
  return `[${agent}:${roleTag}${chatroomSuffix}`;
}

/** Format: `[agent:role@suffix kind] payload` or `[agent:role@suffix kind]`. */
export function formatAgentLogLine(prefix: string, kind: string, payload?: string): string {
  return payload !== undefined && payload !== ''
    ? `${prefix} ${kind}] ${payload}`
    : `${prefix} ${kind}]`;
}

/** Timestamped format used by the OpenCode SDK forwarder. */
export function formatTimestampedLogLine(
  role: string,
  kind: string,
  payload?: string,
  now?: () => string
): string {
  const ts = now ? now() : new Date().toISOString();
  return `[${ts}] role:${role} ${kind}]${payload ? ` ${payload}` : ''}`;
}

export const BASH_TOOL_KIND = 'tool: bash';
const BASH_RUNNING_PREFIX = 'running:';

export function formatBashRunningPayload(command: string): string {
  return `${BASH_RUNNING_PREFIX} ${command}`;
}

function isBashLikeToolName(name: string): boolean {
  return /bash|shell|terminal|command/i.test(name);
}

/** Extract a shell command from tool name + args/input, else null. */
// fallow-ignore-next-line complexity
export function extractBashCommandFromToolInput(name: string, input: unknown): string | null {
  if (!isBashLikeToolName(name)) return null;
  if (input && typeof input === 'object' && 'command' in input) {
    return String((input as { command: unknown }).command);
  }
  if (typeof input === 'string') return input;
  return null;
}

/**
 * Resolve the command string to log for a bash-like tool.
 * Falls back to JSON for non-standard args shapes (Pi RPC).
 */
export function resolveBashCommandForLog(name: string, input: unknown): string | null {
  if (!isBashLikeToolName(name)) return null;
  const extracted = extractBashCommandFromToolInput(name, input);
  if (extracted !== null) return extracted;
  if (input != null) return JSON.stringify(input);
  return '';
}

/** Extract a shell command from the Cursor CLI nested tool_call object, else null. */
// fallow-ignore-next-line complexity
export function extractBashCommandFromCursorToolCall(toolCall: unknown): string | null {
  if (!toolCall || typeof toolCall !== 'object') return null;
  for (const [key, value] of Object.entries(toolCall as Record<string, unknown>)) {
    if (!isBashLikeToolName(key) || !value || typeof value !== 'object') continue;
    const args = (value as { args?: unknown }).args;
    if (args && typeof args === 'object' && 'command' in (args as object)) {
      return String((args as { command: unknown }).command);
    }
  }
  return null;
}

/** Append tool input to a tool-state payload (OpenCode SDK forwarder). */
// fallow-ignore-next-line complexity
export function appendToolInputToPayload(base: string, input: unknown, toolName: string): string {
  if (!input || (typeof input === 'object' && Object.keys(input as object).length === 0)) {
    return base;
  }
  const inp = input as Record<string, unknown>;
  if (toolName === 'bash' && typeof inp.command === 'string') {
    return `${base}: ${inp.command}`;
  }
  const inputStr = typeof inp === 'string' ? inp : JSON.stringify(inp);
  return `${base}: ${inputStr}`;
}

export interface AgentLogWriter {
  write(kind: string, payload?: string): void;
  writeLine(formatted: string): void;
  flushBufferedLines(buffer: string, kind: string): string;
}

export function createAgentLogWriter(
  prefix: string,
  options?: { emitLogLine?: (line: string) => void; target?: Writable }
): AgentLogWriter {
  const target = options?.target ?? process.stdout;
  const emitLogLine = options?.emitLogLine;

  const writeLine = (formatted: string) => {
    target.write(`${formatted}\n`);
    emitLogLine?.(formatted);
  };

  return {
    write(kind: string, payload?: string) {
      writeLine(formatAgentLogLine(prefix, kind, payload));
    },
    writeLine,
    flushBufferedLines(buffer: string, kind: string): string {
      if (!buffer) return buffer;
      for (const line of buffer.split('\n')) {
        if (line) writeLine(formatAgentLogLine(prefix, kind, line));
      }
      return '';
    },
  };
}
