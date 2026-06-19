import { describe, expect, it } from 'vitest';

import {
  appendToolInputToPayload,
  buildAgentLogPrefix,
  extractBashCommandFromCursorToolCall,
  extractBashCommandFromToolInput,
  formatAgentLogLine,
  formatBashRunningPayload,
  formatTimestampedLogLine,
  resolveBashCommandForLog,
} from './agent-log-format.js';

describe('buildAgentLogPrefix', () => {
  it('builds prefix with role only', () => {
    expect(buildAgentLogPrefix('cursor', { role: 'builder' })).toBe('[cursor:builder');
  });

  it('includes chatroom suffix when chatroomId is set', () => {
    expect(buildAgentLogPrefix('pi', { role: 'solo', chatroomId: 'abcdefghijklmnop' })).toBe(
      '[pi:solo@klmnop'
    );
  });

  it('defaults role to unknown', () => {
    expect(buildAgentLogPrefix('claude', {})).toBe('[claude:unknown');
  });
});

describe('formatAgentLogLine', () => {
  const prefix = '[cursor:builder@test';

  it('formats kind-only lines', () => {
    expect(formatAgentLogLine(prefix, 'agent_end')).toBe('[cursor:builder@test agent_end]');
  });

  it('formats kind with payload', () => {
    expect(formatAgentLogLine(prefix, 'text', 'hello')).toBe('[cursor:builder@test text] hello');
  });

  it('formats bash running lines', () => {
    expect(formatAgentLogLine(prefix, 'tool: bash', formatBashRunningPayload('git status'))).toBe(
      '[cursor:builder@test tool: bash] running: git status'
    );
  });
});

describe('formatTimestampedLogLine', () => {
  it('uses provided timestamp', () => {
    expect(formatTimestampedLogLine('solo', 'text', 'hello', () => 'fake-ts')).toBe(
      '[fake-ts] role:solo text] hello'
    );
  });
});

describe('extractBashCommandFromToolInput bash detection', () => {
  it.each(['bash', 'Bash', 'shell', 'terminal', 'bashToolCall'])('matches %s', (name) => {
    expect(extractBashCommandFromToolInput(name, { command: 'x' })).toBe('x');
  });

  it('rejects non-bash tools', () => {
    expect(extractBashCommandFromToolInput('read_file', { path: 'x' })).toBeNull();
  });
});

describe('extractBashCommandFromToolInput', () => {
  it('extracts command from object input', () => {
    expect(extractBashCommandFromToolInput('bash', { command: 'ls -la' })).toBe('ls -la');
  });

  it('extracts command from string input', () => {
    expect(extractBashCommandFromToolInput('shell', 'npm test')).toBe('npm test');
  });

  it('returns null for non-bash tools', () => {
    expect(extractBashCommandFromToolInput('Read', { file: 'x' })).toBeNull();
  });

  it('returns null when bash input has no command', () => {
    expect(extractBashCommandFromToolInput('bash', null)).toBeNull();
  });
});

describe('resolveBashCommandForLog', () => {
  it('falls back to JSON for non-standard bash args', () => {
    expect(resolveBashCommandForLog('bash', { cwd: '/tmp' })).toBe('{"cwd":"/tmp"}');
  });

  it('returns null for non-bash tools', () => {
    expect(resolveBashCommandForLog('read', { path: 'x' })).toBeNull();
  });
});

describe('extractBashCommandFromCursorToolCall', () => {
  it('extracts from nested bashToolCall structure', () => {
    expect(
      extractBashCommandFromCursorToolCall({
        bashToolCall: { args: { command: 'git status' } },
      })
    ).toBe('git status');
  });

  it('returns null for non-bash tool calls', () => {
    expect(
      extractBashCommandFromCursorToolCall({
        readToolCall: { args: { path: 'README.md' } },
      })
    ).toBeNull();
  });
});

describe('appendToolInputToPayload', () => {
  it('appends bash command to payload', () => {
    expect(appendToolInputToPayload('running', { command: 'git status' }, 'bash')).toBe(
      'running: git status'
    );
  });

  it('returns base when input is empty', () => {
    expect(appendToolInputToPayload('pending', {}, 'bash')).toBe('pending');
  });
});
