import { describe, expect, it } from 'vitest';

import { extractBashCommandFromToolInput } from '../agent-log-format.js';

describe('extractBashCommandFromToolInput (Claude)', () => {
  it('extracts command from Bash tool_use', () => {
    expect(extractBashCommandFromToolInput('Bash', { command: 'ls -la' })).toBe('ls -la');
  });

  it('extracts command from shell tool_use (case-insensitive)', () => {
    expect(extractBashCommandFromToolInput('shell', { command: 'git status' })).toBe('git status');
  });

  it('returns null for non-bash tools', () => {
    expect(extractBashCommandFromToolInput('Read', { file: 'x' })).toBeNull();
  });

  it('returns null when Bash input has no command', () => {
    expect(extractBashCommandFromToolInput('Bash', null)).toBeNull();
  });
});
