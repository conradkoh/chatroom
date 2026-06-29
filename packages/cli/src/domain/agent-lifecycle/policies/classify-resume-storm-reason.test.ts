import { describe, expect, test } from 'vitest';

import {
  classifyResumeStormReason,
  formatPermanentHarnessFailureMessage,
  isPermanentHarnessFailure,
} from './classify-resume-storm-reason.js';

describe('classifyResumeStormReason', () => {
  test('returns unknown for empty logs', () => {
    expect(classifyResumeStormReason([])).toBe('unknown');
  });

  test('detects auth errors', () => {
    expect(classifyResumeStormReason(['HTTP 401 Unauthorized from provider'])).toBe('auth_error');
    expect(classifyResumeStormReason(['Invalid API key for anthropic'])).toBe('auth_error');
    expect(
      classifyResumeStormReason(['[cursor-sdk:builder@c1 spawn-error] [unauthenticated] Error'])
    ).toBe('auth_error');
  });

  test('detects rate limits', () => {
    expect(classifyResumeStormReason(['Error 429: rate limit exceeded'])).toBe('rate_limit');
    expect(classifyResumeStormReason(['usage limit reached for model'])).toBe('rate_limit');
  });

  test('detects config errors', () => {
    expect(classifyResumeStormReason(['model not found: foo/bar'])).toBe('config_error');
    expect(classifyResumeStormReason(['configuration error: missing model'])).toBe('config_error');
    expect(
      classifyResumeStormReason([
        'Error: 400 {"error":{"message":"The requested model is not supported.","code":"model_not_supported","param":"model","type":"invalid_request_error"}}',
      ])
    ).toBe('config_error');
  });

  test('isPermanentHarnessFailure treats auth, config, and rate limits as permanent', () => {
    expect(isPermanentHarnessFailure(['Invalid API key for anthropic'])).toBe(true);
    expect(isPermanentHarnessFailure(['model_not_supported'])).toBe(true);
    expect(
      isPermanentHarnessFailure(['[ts] role:builder error] Error 429: rate limit exceeded'])
    ).toBe(true);
    expect(isPermanentHarnessFailure(['agent_end'])).toBe(false);
  });

  test('formatPermanentHarnessFailureMessage includes reason and log excerpt', () => {
    const message = formatPermanentHarnessFailureMessage(['model not found: foo/bar']);
    expect(message).toContain('config_error');
    expect(message).toContain('model not found');
  });

  test('returns unknown for unrelated logs', () => {
    expect(classifyResumeStormReason(['agent_end', 'tool: bash'])).toBe('unknown');
  });
});
