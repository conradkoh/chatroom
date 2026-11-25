import { describe, expect, test } from 'vitest';

import { groundingPublishCommand, groundingReadCommand } from './command';
import {
  GROUNDING_STDIN_DELIMITER,
  HANDOFF_MESSAGE_MARKER,
  validateStdinHeredocBody,
} from '../stdin-heredoc';

describe('groundingPublishCommand', () => {
  test('uses placeholders and a namespaced heredoc', () => {
    const command = groundingPublishCommand({ cliEnvPrefix: '' });

    expect(command).toContain(
      'chatroom grounding publish --chatroom-id="<chatroom-id>" --role="<role>"'
    );
    expect(command).toContain(`<< '${GROUNDING_STDIN_DELIMITER}'`);
    expect(command.endsWith(`\n${GROUNDING_STDIN_DELIMITER}`)).toBe(true);
    expect(command).toContain(`\n${HANDOFF_MESSAGE_MARKER}\n`);
    expect(command).toContain('[Your grounding markdown here');
    expect(command).not.toContain("<< 'EOF'");
  });

  test('applies cliEnvPrefix', () => {
    const command = groundingPublishCommand({ cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://x ' });

    expect(command).toContain('CHATROOM_CONVEX_URL=http://x chatroom grounding publish');
  });
});

describe('groundingReadCommand', () => {
  test('renders the read command without a heredoc', () => {
    const command = groundingReadCommand({ cliEnvPrefix: '' });

    expect(command).toBe(
      'chatroom grounding read --chatroom-id="<chatroom-id>" --role="<role>" --grounding-id="<grounding-id>"'
    );
    expect(command).not.toContain('<<');
    expect(command).not.toContain('---MESSAGE---');
  });
});

describe('grounding stdin body', () => {
  test('rejects a body containing the grounding terminator on its own line', () => {
    const body = ['# Grounding: x', '', GROUNDING_STDIN_DELIMITER].join('\n');

    expect(() => validateStdinHeredocBody(body, GROUNDING_STDIN_DELIMITER)).toThrow(
      GROUNDING_STDIN_DELIMITER
    );
  });
});
