import { describe, expect, it } from 'vitest';

import {
  classifyProviderErrorFromLogs,
  classifyProviderErrorLogLine,
  classifyProviderErrorMessage,
  providerUnavailableRecoverable,
} from './classify-provider-error.js';

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
});
