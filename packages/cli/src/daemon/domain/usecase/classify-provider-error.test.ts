import { describe, expect, it } from 'vitest';

import {
  classifyProviderErrorFromLogs,
  classifyProviderErrorLogLine,
  classifyProviderErrorMessage,
  providerUnavailableRecoverable,
  hasHarnessOutputStalled,
  PROVIDER_ERROR_CLASSIFICATION_STALL_MS,
} from './classify-provider-error.js';

describe('hasHarnessOutputStalled', () => {
  const now = 100_000;
  it('returns false when last output is unknown or recent', () => {
    expect(hasHarnessOutputStalled(undefined, now)).toBe(false);
    expect(hasHarnessOutputStalled(now - 5_000, now)).toBe(false);
  });
  it('returns true at and beyond the threshold', () => {
    expect(hasHarnessOutputStalled(now - PROVIDER_ERROR_CLASSIFICATION_STALL_MS, now)).toBe(true);
    expect(hasHarnessOutputStalled(now - PROVIDER_ERROR_CLASSIFICATION_STALL_MS - 1, now)).toBe(
      true
    );
  });
});

describe('classifyProviderErrorMessage', () => {
  it('classifies model capacity', () => {
    expect(classifyProviderErrorMessage('Selected model is at capacity')).toMatchObject({
      reason: 'model_capacity',
      recoverable: true,
    });
  });

  it('classifies rate limits', () => {
    expect(classifyProviderErrorMessage('Too many requests; rate limit exceeded')).toMatchObject({
      reason: 'rate_limit',
      recoverable: true,
    });
  });
});

describe('classifyProviderErrorLogLine', () => {
  it('classifies Codex run-error lines', () => {
    expect(
      classifyProviderErrorLogLine('[codex-sdk:solo run-error] Selected model is at capacity')
    ).toMatchObject({ reason: 'model_capacity' });
  });

  it('classifies structured agent-end markers', () => {
    expect(
      classifyProviderErrorLogLine('[codex-sdk:solo agent_end] reason: provider_model_capacity')
    ).toMatchObject({ reason: 'model_capacity' });
  });

  it('ignores bash heredoc prose', () => {
    expect(
      classifyProviderErrorLogLine(
        '[codex-sdk:solo tool: bash] running: chatroom handoff << EOF\nSelected model is at capacity\nEOF'
      )
    ).toBeNull();
  });

  it('ignores assistant text', () => {
    expect(
      classifyProviderErrorLogLine(
        '[codex-sdk:solo text] The provider says the selected model is at capacity'
      )
    ).toBeNull();
  });

  // Backlog ps75vz5ayhwpva808dkdvw2z818cbd4m: pre-push vitest output can echo
  // harness-looking strings inside a Codex tool-output payload.
  it('ignores vitest tool-output containing embedded provider-error prose', () => {
    const line =
      '[codex-sdk:builder@7z81x2 tool-output] chatroom-cli:test: rate limited: returns failure\n' +
      '[codex-sdk:builder@c1 spawn-error] Error: spawn keeper failed\n' +
      '⚠️ [RateLimiter] Agent spawn rate-limited for chatroom room-1';
    expect(classifyProviderErrorLogLine(line)).toBeNull();
  });

  it('ignores tool-output containing an embedded agent_end marker', () => {
    expect(
      classifyProviderErrorLogLine(
        '[codex-sdk:builder@7z81x2 tool-output] handoff example\n[codex-sdk:builder agent_end] reason: provider_rate_limit'
      )
    ).toBeNull();
  });

  it('still classifies real run-error lines', () => {
    expect(
      classifyProviderErrorLogLine('[codex-sdk:builder run-error] rate limit exceeded')
    ).toMatchObject({ reason: 'rate_limit', recoverable: true });
  });

  it('ignores pi tool_result containing embedded spawn-error from test output', () => {
    expect(
      classifyProviderErrorLogLine(
        '[pi:builder tool_result] bash result: rate limited: returns failure\n[codex-sdk:builder spawn-error] Error'
      )
    ).toBeNull();
  });

  it('ignores bare tool invocation lines with embedded harness markers', () => {
    expect(
      classifyProviderErrorLogLine('[pi:builder tool] bash with spawn-error] echo')
    ).toBeNull();
  });

  it('ignores claude tool_result rate-limit payloads', () => {
    expect(
      classifyProviderErrorLogLine(
        '[claude-sdk:builder tool_result] tool result: rate limit exceeded'
      )
    ).toBeNull();
  });
});

describe('classifyProviderErrorFromLogs', () => {
  it('uses the most recent matching line', () => {
    expect(
      classifyProviderErrorFromLogs([
        '[codex-sdk:solo run-error] rate limit exceeded',
        '[codex-sdk:solo run-error] Selected model is at capacity',
      ])
    ).toMatchObject({ reason: 'model_capacity' });
  });

  it('marks quota as non-recoverable', () => {
    expect(providerUnavailableRecoverable('quota')).toBe(false);
  });

  it('ignores tool-output false positives when scanning recent logs', () => {
    expect(
      classifyProviderErrorFromLogs([
        '[codex-sdk:builder@7z81x2 tool-output] vitest stderr with rate limited: returns failure and spawn-error] echo',
        '[codex-sdk:builder agent_end]',
      ])
    ).toBeNull();
  });
});
