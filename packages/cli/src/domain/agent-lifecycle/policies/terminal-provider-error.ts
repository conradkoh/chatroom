/**
 * Detects fatal provider usage / rate-limit errors from OpenCode harness output.
 *
 * OpenCode does NOT emit session.idle after such errors — the agent would otherwise
 * hang in STARTING while the SDK retries internally. These errors must not be
 * retried via resumeTurn or crash_recovery.
 */

const FATAL_HARNESS_PHRASES = [
  'failed to load model',
  'model loading was stopped',
  'insufficient system resources',
  'sandboxing is not supported',
  'disable local.sandboxoptions.enabled',
] as const;

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

/**
 * Structured harness abort marker — must be a real harness log line, not prose or
 * heredoc examples embedded in tool/bash payloads (e.g. handoff docs quoting logs).
 */
const PROVIDER_RATE_LIMIT_AGENT_END_MARKER =
  /(?:\[[^\]]+\s+agent_end\]|\]\s+role:\S+\s+agent_end\])\s*reason:\s*provider_rate_limit\b/;

function isProviderRateLimitHarnessMarker(line: string): boolean {
  return PROVIDER_RATE_LIMIT_AGENT_END_MARKER.test(line);
}

function matchesQuotaPhrase(blob: string): boolean {
  const text = blob.toLowerCase();
  return QUOTA_PHRASES.some((phrase) => text.includes(phrase));
}

function matchesStructuredProviderErrorText(blob: string): boolean {
  const text = blob.toLowerCase();
  const hasProviderName = PROVIDER_ERROR_NAMES.some((name) => text.includes(name));
  return hasProviderName && matchesQuotaPhrase(blob);
}

function matchesFatalHarnessErrorText(blob: string): boolean {
  const text = blob.toLowerCase();
  return FATAL_HARNESS_PHRASES.some((phrase) => text.includes(phrase));
}

/** Immediate match for stderr lines and unstructured error strings. */
function matchesTerminalProviderErrorText(blob: string): boolean {
  return matchesQuotaPhrase(blob) || matchesStructuredProviderErrorText(blob);
}

/** Quota, provider, or fatal harness startup errors — observability helper for structured errors. */
// fallow-ignore-next-line unused-export
export function isNonRetryableHarnessFailureText(blob: string): boolean {
  return matchesTerminalProviderErrorText(blob) || matchesFatalHarnessErrorText(blob);
}

// fallow-ignore-next-line complexity
export function isTerminalProviderError(error: unknown): boolean {
  if (typeof error === 'string') {
    return isNonRetryableHarnessFailureText(error);
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const e = error as Record<string, unknown>;
  if (typeof e.error === 'string' && isNonRetryableHarnessFailureText(e.error)) {
    return true;
  }
  const name = extractName(e);
  const message = extractMessage(e);
  return (
    matchesQuotaPhrase(message) ||
    matchesQuotaPhrase(`${name} ${message}`) ||
    matchesFatalHarnessErrorText(message) ||
    matchesFatalHarnessErrorText(`${name} ${message}`)
  );
}

/** Observability helper for classifying recent harness log lines. */
// fallow-ignore-next-line unused-export
export function isTerminalProviderFailureInLogs(logLines: readonly string[]): boolean {
  return logLines.some(
    (line) =>
      isClassifiableHarnessLogLine(line) &&
      (isProviderRateLimitHarnessMarker(line) || isNonRetryableHarnessFailureText(line))
  );
}

// fallow-ignore-next-line complexity
function isClassifiableHarnessLogLine(line: string): boolean {
  if (/\b(?:text|thinking)\]/.test(line)) return false;
  if (/\btool:/.test(line)) return false;
  if (line.includes('agent_end]')) return true;
  if (line.includes('spawn-error]')) return true;
  if (line.includes(' error]')) return true;
  if (line.includes(' run-error]')) return true;
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

// fallow-ignore-next-line unused-export
export function formatTerminalProviderFailureMessage(logLines: readonly string[]): string {
  const blob = logLines.join('\n').trim();
  return blob
    ? `Fatal harness error (non-retryable): ${blob.slice(-500)}`
    : 'Fatal harness error (non-retryable)';
}
