import { describe, expect, test } from 'vitest';

import { planPublishCommand, planReadCommand } from './command';
import { HANDOFF_MESSAGE_MARKER, PLAN_STDIN_DELIMITER } from '../stdin-heredoc';

describe('planPublishCommand', () => {
  test('uses placeholders and a namespaced heredoc', () => {
    const command = planPublishCommand({ cliEnvPrefix: '' });

    expect(command).toContain('chatroom plan publish');
    expect(command).toContain('--chatroom-id="<chatroom-id>"');
    expect(command).toContain('--role="<role>"');
    expect(command).toContain(`<< '${PLAN_STDIN_DELIMITER}'`);
    expect(command.endsWith(`\n${PLAN_STDIN_DELIMITER}`)).toBe(true);
    expect(command).toContain(`\n${HANDOFF_MESSAGE_MARKER}\n`);
    expect(command).toContain('[Your plan markdown here');
    expect(command).not.toContain("<< 'EOF'");
  });

  test('applies cliEnvPrefix', () => {
    const command = planPublishCommand({ cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://x ' });

    expect(command).toContain('CHATROOM_CONVEX_URL=http://x chatroom plan publish');
  });
});

describe('planReadCommand', () => {
  test('renders the whole-plan read without a heredoc', () => {
    const command = planReadCommand({ cliEnvPrefix: '' });

    expect(command).toBe(
      'chatroom plan read --chatroom-id="<chatroom-id>" --role="<role>" --plan-id="<plan-id>"'
    );
    expect(command).not.toContain('<<');
    expect(command).not.toContain('---MESSAGE---');
  });

  test('appends --phase when a phase is requested', () => {
    const command = planReadCommand({
      cliEnvPrefix: '',
      chatroomId: 'abc',
      role: 'builder',
      planId: 'plan1',
      phase: 'P2',
    });

    expect(command).toBe(
      'chatroom plan read --chatroom-id="abc" --role="builder" --plan-id="plan1" --phase="P2"'
    );
  });
});
