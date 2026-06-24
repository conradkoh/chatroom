import { describe, expect, test } from 'vitest';

import {
  formatStdinHeredocCommand,
  HANDOFF_MESSAGE_MARKER,
  HANDOFF_STDIN_DELIMITER,
  validateStdinHeredocBody,
} from './stdin-heredoc';

describe('formatStdinHeredocCommand', () => {
  test('uses namespaced delimiter instead of EOF', () => {
    const command = formatStdinHeredocCommand(
      'chatroom handoff --chatroom-id="x" --role="builder" --next-role="planner"',
      HANDOFF_STDIN_DELIMITER,
      '[Your message here]',
      { messageMarker: HANDOFF_MESSAGE_MARKER }
    );

    expect(command).toContain(`<< '${HANDOFF_STDIN_DELIMITER}'`);
    expect(command).toContain(`\n${HANDOFF_STDIN_DELIMITER}`);
    expect(command).not.toContain("<< 'EOF'");
    expect(command).not.toContain('\nEOF');
  });
});

describe('validateStdinHeredocBody', () => {
  test('allows markdown and code blocks', () => {
    expect(() =>
      validateStdinHeredocBody(
        '## Summary\n```bash\necho hello\n```\n---MESSAGE---\ninline mention',
        HANDOFF_STDIN_DELIMITER
      )
    ).not.toThrow();
  });

  test('rejects heredoc terminator on its own line', () => {
    expect(() =>
      validateStdinHeredocBody(
        `## Summary\n${HANDOFF_STDIN_DELIMITER}\nmore content`,
        HANDOFF_STDIN_DELIMITER
      )
    ).toThrow(HANDOFF_STDIN_DELIMITER);
  });

  test('rejects heredoc terminator on its own line (trimmed)', () => {
    expect(() =>
      validateStdinHeredocBody(
        `## Summary\n  ${HANDOFF_STDIN_DELIMITER}  \nmore content`,
        HANDOFF_STDIN_DELIMITER
      )
    ).toThrow(HANDOFF_STDIN_DELIMITER);
  });
});
