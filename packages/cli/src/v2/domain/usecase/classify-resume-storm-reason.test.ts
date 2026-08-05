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

  test('detects Cursor SDK Authentication error status as auth_error', () => {
    expect(
      classifyResumeStormReason([
        '[cursor-sdk:planner@882x8x status] ERROR: Authentication error If you are logged in, try logging out and back in.',
        '[cursor-sdk:planner@882x8x run-error] run run-0dd4d14b-8955-4999-bb4b-f6f8067a6077 failed: no error detail from SDK',
      ])
    ).toBe('auth_error');
  });

  test('isPermanentHarnessFailure is false for Cursor SDK Authentication error (retryable)', () => {
    expect(
      isPermanentHarnessFailure([
        '[cursor-sdk:planner@882x8x agent_end]',
        '[cursor-sdk:planner@882x8x status] RUNNING',
        '[cursor-sdk:planner@882x8x status] ERROR: Authentication error If you are logged in, try logging out and back in.',
        '[cursor-sdk:planner@882x8x run-error] run run-0dd4d14b-8955-4999-bb4b-f6f8067a6077 failed: no error detail from SDK (run run-0dd4d14b-8955-4999-bb4b-f6f8067a6077)',
      ])
    ).toBe(false);
  });

  test('auth errors classify as auth_error but are not permanent', () => {
    expect(classifyResumeStormReason(['Invalid API key for anthropic'])).toBe('auth_error');
    expect(isPermanentHarnessFailure(['Invalid API key for anthropic'])).toBe(false);
    expect(isPermanentHarnessFailure(['HTTP 401 Unauthorized from provider'])).toBe(false);
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

  test('isPermanentHarnessFailure treats only config errors as permanent', () => {
    expect(isPermanentHarnessFailure(['Invalid API key for anthropic'])).toBe(false);
    expect(isPermanentHarnessFailure(['model_not_supported'])).toBe(true);
    expect(
      isPermanentHarnessFailure(['[ts] role:builder error] Error 429: rate limit exceeded'])
    ).toBe(false);
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
