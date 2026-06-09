import { describe, expect, test } from 'vitest';

import { classifyResumeStormReason } from './classify-resume-storm-reason.js';

describe('classifyResumeStormReason', () => {
  test('returns unknown for empty logs', () => {
    expect(classifyResumeStormReason([])).toBe('unknown');
  });

  test('detects auth errors', () => {
    expect(classifyResumeStormReason(['HTTP 401 Unauthorized from provider'])).toBe('auth_error');
    expect(classifyResumeStormReason(['Invalid API key for anthropic'])).toBe('auth_error');
  });

  test('detects rate limits', () => {
    expect(classifyResumeStormReason(['Error 429: rate limit exceeded'])).toBe('rate_limit');
    expect(classifyResumeStormReason(['usage limit reached for model'])).toBe('rate_limit');
  });

  test('detects config errors', () => {
    expect(classifyResumeStormReason(['model not found: foo/bar'])).toBe('config_error');
    expect(classifyResumeStormReason(['configuration error: missing model'])).toBe('config_error');
  });

  test('returns unknown for unrelated logs', () => {
    expect(classifyResumeStormReason(['agent_end', 'tool: bash'])).toBe('unknown');
  });
});
