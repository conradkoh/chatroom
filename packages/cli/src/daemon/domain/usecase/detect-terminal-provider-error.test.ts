import { describe, expect, test } from 'vitest';
import { isTerminalProviderFailureInLogs } from './detect-terminal-provider-error.js';

describe('isTerminalProviderFailureInLogs', () => {
  test('ignores codex tool-output payloads', () => {
    expect(isTerminalProviderFailureInLogs([
      '[codex-sdk:builder@7z81x2 tool-output] vitest stderr with spawn-error] and rate limit',
    ])).toBe(false);
  });
  test('ignores pi tool_result payloads with embedded markers', () => {
    expect(isTerminalProviderFailureInLogs([
      '[pi:builder tool_result] bash result: rate limited: returns failure\n[codex-sdk:builder spawn-error] Error',
    ])).toBe(false);
  });
  test('ignores bare tool invocation payloads', () => {
    expect(isTerminalProviderFailureInLogs(['[pi:builder tool] bash args with spawn-error] echo'])).toBe(false);
  });
});
