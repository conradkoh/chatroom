/**
 * Detects fatal provider usage / rate-limit errors from OpenCode harness output.
 *
 * OpenCode does NOT emit session.idle after such errors — the agent would otherwise
 * hang in STARTING while the SDK retries internally. These errors must not be
 * retried via resumeTurn or crash_recovery.
 */

const QUOTA_PHRASES = [
  'usagelimit',
  'usage limit',
  'enable usage from your available balance',
  'rate limit',
  'ratelimit',
  'too many requests',
  'x-ratelimit-exceeded',
  'weekly rate limit',
  'exceeded your weekly',
] as const;

const PROVIDER_ERROR_NAMES = ['ai_apicallerror', 'ai_retryerror'] as const;

const HARNESS_LOG_PREFIX = /^\[[^\]]+\] role:/;

function matchesQuotaPhrase(blob: string): boolean {
  const text = blob.toLowerCase();
  return QUOTA_PHRASES.some((phrase) => text.includes(phrase));
}

function matchesStructuredProviderErrorText(blob: string): boolean {
  const text = blob.toLowerCase();
  const hasProviderName = PROVIDER_ERROR_NAMES.some((name) => text.includes(name));
  return hasProviderName && matchesQuotaPhrase(blob);
}

/** Immediate match for stderr lines and unstructured error strings. */
export function matchesTerminalProviderErrorText(blob: string): boolean {
  return matchesQuotaPhrase(blob) || matchesStructuredProviderErrorText(blob);
}

// fallow-ignore-next-line complexity
export function isTerminalProviderError(error: unknown): boolean {
  if (typeof error === 'string') {
    return matchesTerminalProviderErrorText(error);
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const e = error as Record<string, unknown>;
  if (typeof e.error === 'string' && matchesTerminalProviderErrorText(e.error)) {
    return true;
  }
  const name = extractName(e);
  const message = extractMessage(e);
  return matchesQuotaPhrase(message) || matchesQuotaPhrase(`${name} ${message}`);
}

/** True when recent harness log lines indicate a non-retryable provider failure. */
// fallow-ignore-next-line complexity
export function isTerminalProviderFailureInLogs(logLines: readonly string[]): boolean {
  for (const line of logLines) {
    if (!isClassifiableHarnessLogLine(line)) continue;
    if (line.includes('provider_rate_limit')) return true;
    if (matchesTerminalProviderErrorText(line)) return true;
  }
  return false;
}

// fallow-ignore-next-line complexity
function isClassifiableHarnessLogLine(line: string): boolean {
  if (/\b(?:text|thinking)\]/.test(line)) return false;
  if (line.includes('provider_rate_limit')) return true;
  if (line.includes('agent_end]')) return true;
  if (line.includes(' error]')) return true;
  if (!HARNESS_LOG_PREFIX.test(line)) return true;
  return false;
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
