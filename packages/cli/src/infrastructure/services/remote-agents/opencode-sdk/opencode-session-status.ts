const OPENCODE_SESSION_STATUSES = ['idle', 'busy', 'retry'] as const;
export type OpenCodeSessionStatus = (typeof OPENCODE_SESSION_STATUSES)[number];

function isOpenCodeSessionStatus(value: unknown): value is OpenCodeSessionStatus {
  return (
    typeof value === 'string' && (OPENCODE_SESSION_STATUSES as readonly string[]).includes(value)
  );
}

export function parseOpenCodeSessionStatus(raw: unknown): OpenCodeSessionStatus | null {
  return isOpenCodeSessionStatus(raw) ? raw : null;
}

/** Exhaustiveness helper — call from switch default. */
export function assertNeverOpenCodeSessionStatus(value: never, context: string): never {
  throw new Error(`Unhandled OpenCode session status in ${context}: ${String(value)}`);
}
