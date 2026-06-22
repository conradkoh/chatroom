import type { ResumeStormReason } from '@workspace/backend/src/domain/entities/resume-storm.js';

import { isTerminalProviderFailureInLogs } from './terminal-provider-error.js';

const CLASSIFICATION_RULES: readonly {
  reason: ResumeStormReason;
  patterns: readonly RegExp[];
}[] = [
  {
    reason: 'rate_limit',
    patterns: [
      /\b429\b/,
      /rate.?limit/i,
      /too many requests/i,
      /quota exceeded/i,
      /usage.?limit/i,
      /tokens per minute/i,
    ],
  },
  {
    reason: 'auth_error',
    patterns: [
      /\b401\b/,
      /\b403\b/,
      /unauthorized/i,
      /unauthenticated/i,
      /authentication failed/i,
      /invalid.{0,24}api.{0,12}key/i,
      /api key.{0,20}(invalid|missing|expired)/i,
    ],
  },
  {
    reason: 'config_error',
    patterns: [
      /model not found/i,
      /model_not_supported/i,
      /model is not supported/i,
      /requested model is not supported/i,
      /unsupported model/i,
      /invalid model/i,
      /missing model/i,
      /config(uration)? error/i,
      /ENOENT.{0,40}(config|\.env)/i,
      /no such file.{0,40}(config|credentials)/i,
    ],
  },
];

const PERMANENT_FAILURE_REASONS: ReadonlySet<ResumeStormReason> = new Set([
  'auth_error',
  'config_error',
]);

/**
 * Infer why rapid resume failed from recent harness log lines.
 * Falls back to `unknown` when no pattern matches.
 */
export function classifyResumeStormReason(logLines: readonly string[]): ResumeStormReason {
  const blob = logLines.join('\n');
  if (!blob.trim()) {
    return 'unknown';
  }

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(blob))) {
      return rule.reason;
    }
  }

  return 'unknown';
}

/**
 * Whether recent harness logs indicate a failure that will not resolve on retry
 * (e.g. invalid API key, unsupported model, provider rate limit).
 */
export function isPermanentHarnessFailure(logLines: readonly string[]): boolean {
  if (isTerminalProviderFailureInLogs(logLines)) {
    return true;
  }
  return PERMANENT_FAILURE_REASONS.has(classifyResumeStormReason(logLines));
}

export function formatPermanentHarnessFailureMessage(logLines: readonly string[]): string {
  const reason = classifyResumeStormReason(logLines);
  const blob = logLines.join('\n').trim();
  return blob
    ? `Permanent harness error (${reason}): ${blob.slice(-500)}`
    : `Permanent harness error (${reason})`;
}
