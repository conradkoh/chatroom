import { describe, expect, test } from 'vitest';

import { notifyUserCommand } from './command';
import { HANDOFF_MESSAGE_MARKER, NOTIFY_USER_STDIN_DELIMITER } from '../stdin-heredoc';

describe('notifyUserCommand', () => {
  test('uses placeholders when values are omitted', () => {
    const command = notifyUserCommand({ cliEnvPrefix: '' });

    expect(command).toContain('chatroom notify-user');
    expect(command).toContain('--chatroom-id="<chatroom-id>"');
    expect(command).toContain('--role="<role>"');
    expect(command).toContain('[Your update for the user]');
  });

  test('uses real values when provided', () => {
    const command = notifyUserCommand({
      cliEnvPrefix: '',
      chatroomId: 'abc123',
      role: 'builder',
    });

    expect(command).toContain('--chatroom-id="abc123"');
    expect(command).toContain('--role="builder"');
    expect(command).not.toContain('<chatroom-id>');
    expect(command).not.toContain('<role>');
  });

  test('applies cliEnvPrefix', () => {
    const command = notifyUserCommand({ cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://x ' });

    expect(command).toContain('CHATROOM_CONVEX_URL=http://x chatroom notify-user');
  });

  test('closes with the namespaced delimiter, not EOF', () => {
    const command = notifyUserCommand({ cliEnvPrefix: '' });

    expect(command).toContain(`<< '${NOTIFY_USER_STDIN_DELIMITER}'`);
    expect(command.endsWith(`\n${NOTIFY_USER_STDIN_DELIMITER}`)).toBe(true);
    expect(command).not.toContain("<< 'EOF'");
    expect(command).not.toContain('\nEOF');
  });

  test('includes the message marker before the body', () => {
    const command = notifyUserCommand({ cliEnvPrefix: '' });

    expect(command).toContain(`\n${HANDOFF_MESSAGE_MARKER}\n`);
  });

  test('accepts a custom message placeholder', () => {
    const command = notifyUserCommand({
      cliEnvPrefix: '',
      messagePlaceholder: 'Working on it',
    });

    expect(command).toContain('Working on it');
    expect(command).not.toContain('[Your update for the user]');
  });
});
