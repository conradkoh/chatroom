import { describe, expect, test } from 'vitest';

import {
  formatTerminalProviderFailureMessage,
  isTerminalProviderError,
  isTerminalProviderFailureInLogs,
  matchesTerminalProviderErrorText,
} from './terminal-provider-error.js';

describe('matchesTerminalProviderErrorText', () => {
  test('matches quota phrases and structured provider errors', () => {
    expect(matchesTerminalProviderErrorText('Rate limit exceeded. Please try again later.')).toBe(
      true
    );
    expect(matchesTerminalProviderErrorText('weekly rate limit')).toBe(true);
    expect(matchesTerminalProviderErrorText('AI_APICallError: Rate limit exceeded')).toBe(true);
  });

  test('does not match unrelated or retry-only errors', () => {
    expect(matchesTerminalProviderErrorText('ENOENT: file not found')).toBe(false);
    expect(matchesTerminalProviderErrorText('AI_RetryError: Failed after 3 attempts')).toBe(false);
  });
});

describe('isTerminalProviderError', () => {
  test('matches structured SDK errors', () => {
    expect(
      isTerminalProviderError({
        name: 'AI_APICallError',
        message: 'Rate limit exceeded. Please try again later.',
      })
    ).toBe(true);
  });

  test('rejects AI_RetryError without quota message', () => {
    expect(
      isTerminalProviderError({
        name: 'AI_RetryError',
        message: 'Failed after 3 attempts',
      })
    ).toBe(false);
  });

  test('matches nested error.error shape from opencode serve logs', () => {
    expect(
      isTerminalProviderError({
        error: 'AI_APICallError: Rate limit exceeded. Please try again later.',
      })
    ).toBe(true);
  });
});

describe('isTerminalProviderFailureInLogs', () => {
  test('matches provider_rate_limit agent_end marker', () => {
    expect(
      isTerminalProviderFailureInLogs(['[ts] role:solo agent_end] reason: provider_rate_limit'])
    ).toBe(true);
  });

  test('matches stream error log lines', () => {
    expect(
      isTerminalProviderFailureInLogs([
        'message="stream error" error.error="AI_APICallError: Rate limit exceeded. Please try again later."',
      ])
    ).toBe(true);
  });

  test('matches harness error log lines', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[ts] role:builder error] AI_APICallError: Rate limit exceeded. Please try again later.',
      ])
    ).toBe(true);
  });

  test('ignores agent text mentioning rate limits', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[ts] role:builder text] Please respect the rate limit when calling the API',
      ])
    ).toBe(false);
  });

  test('ignores thinking lines mentioning rate limits', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[ts] role:builder thinking] The provider rate limit is 100 rpm',
      ])
    ).toBe(false);
  });
});

describe('formatTerminalProviderFailureMessage', () => {
  test('includes recent log context', () => {
    const msg = formatTerminalProviderFailureMessage(['Rate limit exceeded']);
    expect(msg).toContain('non-retryable');
    expect(msg).toContain('Rate limit exceeded');
  });
});
