/**
 * Detects fatal provider usage / rate-limit errors from OpenCode harness output.
 *
 * OpenCode does NOT emit session.idle after such errors — the agent would otherwise
 * hang in STARTING while the SDK retries internally. These errors must not be
 * retried via resumeTurn or crash_recovery.
 */

const TERMINAL_PROVIDER_ERROR_PHRASES = [
  'usagelimit',
  'usage limit',
  'enable usage from your available balance',
  'rate limit',
  'ratelimit',
  'too many requests',
  'x-ratelimit-exceeded',
  'weekly rate limit',
  'exceeded your weekly',
  'ai_apicallerror',
  'ai_retryerror',
] as const;

export function matchesTerminalProviderErrorText(blob: string): boolean {
  const text = blob.toLowerCase();
  return TERMINAL_PROVIDER_ERROR_PHRASES.some((phrase) => text.includes(phrase));
}

export function isTerminalProviderError(error: unknown): boolean {
  if (typeof error === 'string') {
    return matchesTerminalProviderErrorText(error);
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  return matchesTerminalProviderErrorText(normalizeError(error));
}

/** True when recent harness log lines indicate a non-retryable provider failure. */
export function isTerminalProviderFailureInLogs(logLines: readonly string[]): boolean {
  const blob = logLines.join('\n');
  if (!blob.trim()) return false;
  if (blob.includes('provider_rate_limit')) return true;
  return matchesTerminalProviderErrorText(blob);
}

function normalizeError(error: unknown): string {
  const e = error as Record<string, unknown>;
  const name = extractName(e);
  const message = extractMessage(e);
  return `${name}\n${message}`;
}

function extractName(e: Record<string, unknown>): string {
  const name = e.name;
  if (typeof name === 'string') return name.toLowerCase();
  const type = e.type;
  if (typeof type === 'string') return type.toLowerCase();
  return '';
}

// fallow-ignore-next-line complexity
function extractMessage(e: Record<string, unknown>): string {
  const fromData = messageFromData(e.data);
  if (fromData) return fromData;
  if (typeof e.message === 'string') return e.message.toLowerCase();
  if (typeof e.responseBody === 'string') return e.responseBody.toLowerCase();
  if (typeof e.error === 'string') return e.error.toLowerCase();
  if (e.error && typeof e.error === 'object') {
    return extractMessage(e.error as Record<string, unknown>);
  }
  return '';
}

function messageFromData(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const msg = (data as Record<string, unknown>).message;
  return typeof msg === 'string' ? msg.toLowerCase() : undefined;
}

export function formatTerminalProviderFailureMessage(logLines: readonly string[]): string {
  const blob = logLines.join('\n').trim();
  return blob
    ? `Provider rate limit or quota error (non-retryable): ${blob.slice(-500)}`
    : 'Provider rate limit or quota error (non-retryable)';
}
