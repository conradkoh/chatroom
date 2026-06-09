import type { ResumeStormReason } from '@workspace/backend/src/domain/entities/resume-storm.js';

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
      /invalid model/i,
      /missing model/i,
      /config(uration)? error/i,
      /ENOENT.{0,40}(config|\.env)/i,
      /no such file.{0,40}(config|credentials)/i,
    ],
  },
];

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
