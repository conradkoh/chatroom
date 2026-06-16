import { describe, expect, it } from 'vitest';

import { extractBashCommandFromClaudeToolUse } from './claude-code-agent-service.js';

describe('extractBashCommandFromClaudeToolUse', () => {
  it('extracts command from Bash tool_use', () => {
    expect(extractBashCommandFromClaudeToolUse('Bash', { command: 'ls -la' })).toBe('ls -la');
  });

  it('extracts command from shell tool_use (case-insensitive)', () => {
    expect(extractBashCommandFromClaudeToolUse('shell', { command: 'git status' })).toBe(
      'git status'
    );
  });

  it('returns null for non-bash tools', () => {
    expect(extractBashCommandFromClaudeToolUse('Read', { file: 'x' })).toBeNull();
  });

  it('returns null when Bash input has no command', () => {
    expect(extractBashCommandFromClaudeToolUse('Bash', null)).toBeNull();
  });
});
