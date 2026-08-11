import { isClassifiableHarnessLogLine } from './detect-terminal-provider-error.js';

export type ProviderUnavailableReason = 'model_capacity' | 'rate_limit' | 'quota';

export interface ProviderUnavailableClassification {
  reason: ProviderUnavailableReason;
  message: string;
  recoverable: boolean;
}

// fallow-ignore-next-line unused-export
export const PROVIDER_MODEL_CAPACITY_AGENT_END = 'provider_model_capacity';

export function providerUnavailableAgentEndReason(reason: ProviderUnavailableReason): string {
  if (reason === 'model_capacity') return PROVIDER_MODEL_CAPACITY_AGENT_END;
  if (reason === 'rate_limit') return 'provider_rate_limit';
  return 'provider_quota';
}

const MODEL_CAPACITY_PHRASES = ['selected model is at capacity', 'model is at capacity'] as const;
const RATE_LIMIT_PHRASES = [
  'rate limit',
  'ratelimit',
  'too many requests',
  'x-ratelimit-exceeded',
  'weekly rate limit',
] as const;
const QUOTA_PHRASES = [
  'usagelimit',
  'usage limit',
  'enable usage from your available balance',
  'exceeded your weekly',
] as const;

function includesPhrase(message: string, phrases: readonly string[]): boolean {
  const normalized = message.toLowerCase();
  return phrases.some((phrase) => normalized.includes(phrase));
}

function classification(
  reason: ProviderUnavailableReason,
  message: string
): ProviderUnavailableClassification {
  return { reason, message: message.trim(), recoverable: providerUnavailableRecoverable(reason) };
}

/** Classify a structured provider error message. */
export function classifyProviderErrorMessage(
  message: string
): ProviderUnavailableClassification | null {
  if (includesPhrase(message, MODEL_CAPACITY_PHRASES)) {
    return classification('model_capacity', message);
  }
  if (includesPhrase(message, RATE_LIMIT_PHRASES)) {
    return classification('rate_limit', message);
  }
  if (includesPhrase(message, QUOTA_PHRASES)) {
    return classification('quota', message);
  }
  return null;
}

/** Classify a single harness log line after excluding agent prose and tool payloads. */
// fallow-ignore-next-line unused-export
export function classifyProviderErrorLogLine(
  line: string
): ProviderUnavailableClassification | null {
  if (!isClassifiableHarnessLogLine(line)) return null;

  const marker = isProviderUnavailableAgentEndReason(line);
  if (marker) return classification(marker, line);
  return classifyProviderErrorMessage(line);
}

/** Scan recent lines with the most recent matching line taking precedence. */
export function classifyProviderErrorFromLogs(
  logLines: readonly string[]
): ProviderUnavailableClassification | null {
  for (let index = logLines.length - 1; index >= 0; index -= 1) {
    const result = classifyProviderErrorLogLine(logLines[index]);
    if (result) return result;
  }
  return null;
}

// fallow-ignore-next-line unused-export
export function isProviderUnavailableAgentEndReason(
  reason: string
): ProviderUnavailableReason | null {
  const normalized = reason.toLowerCase();
  if (normalized.includes(PROVIDER_MODEL_CAPACITY_AGENT_END)) return 'model_capacity';
  if (normalized.includes('provider_rate_limit')) return 'rate_limit';
  if (normalized.includes('provider_quota')) return 'quota';
  return null;
}

export function providerUnavailableRecoverable(reason: ProviderUnavailableReason): boolean {
  return reason !== 'quota';
}
