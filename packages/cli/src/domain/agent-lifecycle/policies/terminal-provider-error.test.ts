import { describe, expect, test } from 'vitest';

import {
  formatTerminalProviderFailureMessage,
  isNonRetryableHarnessFailureText,
  isTerminalProviderError,
  isTerminalProviderFailureInLogs,
} from './terminal-provider-error.js';

describe('quota and provider error text detection', () => {
  test('matches quota phrases and structured provider errors', () => {
    expect(isNonRetryableHarnessFailureText('Rate limit exceeded. Please try again later.')).toBe(
      true
    );
    expect(isNonRetryableHarnessFailureText('weekly rate limit')).toBe(true);
    expect(isNonRetryableHarnessFailureText('AI_APICallError: Rate limit exceeded')).toBe(true);
  });

  test('does not match unrelated or retry-only errors', () => {
    expect(isNonRetryableHarnessFailureText('ENOENT: file not found')).toBe(false);
    expect(isNonRetryableHarnessFailureText('AI_RetryError: Failed after 3 attempts')).toBe(false);
  });
});

describe('fatal harness error detection', () => {
  test('matches model load and resource errors', () => {
    expect(
      isNonRetryableHarnessFailureText(
        'Failed to load model "qwen/qwen3.6-35b-a3b". Error: Model loading was stopped due to insufficient system resources.'
      )
    ).toBe(true);
    expect(isNonRetryableHarnessFailureText('insufficient system resources')).toBe(true);
  });

  test('does not match unrelated errors', () => {
    expect(isNonRetryableHarnessFailureText('ENOENT: file not found')).toBe(false);
  });
});

describe('isNonRetryableHarnessFailureText', () => {
  test('matches quota and fatal harness errors', () => {
    expect(isNonRetryableHarnessFailureText('Rate limit exceeded')).toBe(true);
    expect(isNonRetryableHarnessFailureText('Failed to load model "foo"')).toBe(true);
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

  test('matches model load structured errors', () => {
    expect(
      isTerminalProviderError({
        name: 'ModelLoadError',
        message:
          'Failed to load model "qwen/qwen3.6-35b-a3b". Model loading was stopped due to insufficient system resources.',
      })
    ).toBe(true);
  });
});

describe('isTerminalProviderFailureInLogs', () => {
  test.each([
    {
      label: 'provider rate limit',
      lines: [
        '[ts] role:builder error] AI_APICallError: Rate limit exceeded. Please try again later.',
      ],
      expected: true,
    },
    {
      label: 'model load failure',
      lines: [
        '[ts] role:builder error] Failed to load model "qwen/qwen3.6-35b-a3b". Model loading was stopped due to insufficient system resources.',
      ],
      expected: true,
    },
    {
      label: 'unrelated file error',
      lines: ['[ts] role:builder error] ENOENT: file not found'],
      expected: false,
    },
  ])('classifies $label consistently', ({ lines, expected }) => {
    expect(isTerminalProviderFailureInLogs(lines)).toBe(expected);
  });

  test('matches provider_rate_limit agent_end marker', () => {
    expect(
      isTerminalProviderFailureInLogs(['[ts] role:solo agent_end] reason: provider_rate_limit'])
    ).toBe(true);
  });

  test('matches stream error log lines on explicit error channel', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[ts] role:builder error] message="stream error" error.error="AI_APICallError: Rate limit exceeded. Please try again later."',
      ])
    ).toBe(true);
  });

  test('does not match unstructured stream blobs without error channel', () => {
    expect(
      isTerminalProviderFailureInLogs([
        'message="stream error" error.error="AI_APICallError: Rate limit exceeded. Please try again later."',
      ])
    ).toBe(false);
  });

  test('matches harness error log lines', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[ts] role:builder error] AI_APICallError: Rate limit exceeded. Please try again later.',
      ])
    ).toBe(true);
  });

  test('matches harness error log lines for model load failures', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[ts] role:builder error] Failed to load model "qwen/qwen3.6-35b-a3b". Model loading was stopped due to insufficient system resources.',
      ])
    ).toBe(true);
  });

  test('matches cursor-sdk sandbox spawn-error as non-retryable', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[cursor-sdk:solo@882qrv spawn-error] ConfigurationError: Local SDK sandboxing was requested, but sandboxing is not supported in this environment.',
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

  test('ignores status/finished lines mentioning rate limits', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[cursor-sdk:planner@x status: FINISHED] Please respect the rate limit when calling the API',
      ])
    ).toBe(false);
  });

  test('ignores handoff-like harness lines mentioning rate limits', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[cursor-sdk:builder@c1] role:builder handoff mentions weekly rate limit policy',
      ])
    ).toBe(false);
  });

  test('ignores bash handoff heredoc mentioning provider_rate_limit in prose', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[cursor-sdk:planner@7z81x2 tool: bash] running: chatroom handoff --chatroom-id="c1" --role="planner" --next-role="user" << \'CHATROOM_HANDOFF_END\'\n## Tech Debt\n- abortTerminalProviderError still emits reason provider_rate_limit for model load failures\nCHATROOM_HANDOFF_END',
      ])
    ).toBe(false);
  });

  test('ignores bash handoff heredoc mentioning rate limit in prose', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[cursor-sdk:planner@7z81x2 tool: bash] running: chatroom handoff << EOF\nMirror existing rate-limit test patterns for model load failures\nEOF',
      ])
    ).toBe(false);
  });

  test('does not false-positive when bash handoff precedes agent_end in log buffer', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[cursor-sdk:planner@7z81x2 tool: bash] running: chatroom handoff << EOF\nprovider_rate_limit cosmetic issue\nEOF',
        '[cursor-sdk:planner@7z81x2 agent_end]',
      ])
    ).toBe(false);
  });

  test('matches cursor-sdk agent_end reason provider_rate_limit marker', () => {
    expect(
      isTerminalProviderFailureInLogs([
        '[cursor-sdk:planner@7z81x2 agent_end] reason: provider_rate_limit',
      ])
    ).toBe(true);
  });
});

describe('formatTerminalProviderFailureMessage', () => {
  test('includes recent log context', () => {
    const msg = formatTerminalProviderFailureMessage(['Rate limit exceeded']);
    expect(msg).toContain('Fatal harness error');
    expect(msg).toContain('non-retryable');
    expect(msg).toContain('Rate limit exceeded');
  });
});
