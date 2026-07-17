import { describe, expect, test } from 'vitest';

import { getCommandFrecencyKey, resolveFrecencyKeyFromLabel } from './commandFrecencyKey';
import type { CommandItem } from '../components/CommandPalette/types';

function makeCommand(id: string, label: string): CommandItem {
  return { id, label, category: 'Test', action: () => undefined };
}

describe('getCommandFrecencyKey', () => {
  test('saved-cmd prefix returns id', () => {
    const cmd = makeCommand('saved-cmd-abc123', 'Command: My Cmd (Chatroom)');
    expect(getCommandFrecencyKey(cmd)).toBe('saved-cmd-abc123');
  });

  test('fav prefix returns id', () => {
    const cmd = makeCommand('fav-dev', 'dev');
    expect(getCommandFrecencyKey(cmd)).toBe('fav-dev');
  });

  test('built-in returns id', () => {
    const cmd = makeCommand('nav-switch-chatroom', 'Chatroom: Switch');
    expect(getCommandFrecencyKey(cmd)).toBe('nav-switch-chatroom');
  });
});

describe('resolveFrecencyKeyFromLabel', () => {
  test('returns mapped key when label exists', () => {
    const map = new Map([['Chatroom: Switch', 'nav-switch-chatroom']]);
    expect(resolveFrecencyKeyFromLabel('Chatroom: Switch', map)).toBe('nav-switch-chatroom');
  });

  test('falls back to label when label not in map', () => {
    expect(resolveFrecencyKeyFromLabel('unknown', new Map())).toBe('unknown');
  });
});
