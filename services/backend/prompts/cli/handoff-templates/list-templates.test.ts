/**
 * Tests for the pair-keyed handoff template listing (discovery command data).
 */

import { describe, expect, test } from 'vitest';

import { listHandoffTemplatesCommand } from './list-templates';
import { HandoffTemplatePairError } from './pair';
import { getPlannerBuilderCodeTemplate } from '../../teams/duo/handoff-templates/planner-builder-code';

const plannerBuilderBody = getPlannerBuilderCodeTemplate({
  fromRole: 'planner',
  toRole: 'builder',
});

function expectPairError(fn: () => unknown): HandoffTemplatePairError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HandoffTemplatePairError);
    return error as HandoffTemplatePairError;
  }
  throw new Error('expected HandoffTemplatePairError');
}

describe('listHandoffTemplatesCommand', () => {
  test('prints the pair descriptor, send command, reply pair, and template body', () => {
    const output = listHandoffTemplatesCommand({
      from: 'planner',
      to: 'builder',
      mode: 'code',
      teamId: 'duo',
    });

    expect(output).toContain(
      'Handoff template `planner` → `builder` (team: `duo`, mode: `code`, key: `duo:planner->builder@code`)'
    );
    expect(output).toContain(
      'Send with: chatroom handoff --chatroom-id="<chatroom-id>" --role="planner" --next-role="builder"'
    );
    expect(output).toContain(
      'Reply pair: `builder` → `planner` (view: chatroom handoff view-template --from="builder" --to="planner" --mode="code" --team-id="duo")'
    );
    expect(output).toContain(plannerBuilderBody);
  });

  test('prints the reply pair for a role recipient', () => {
    const output = listHandoffTemplatesCommand({
      from: 'builder',
      to: 'planner',
      mode: 'code',
      teamId: 'duo',
    });

    expect(output).toContain('Reply pair: `planner` → `builder`');
  });

  test('prints no reply pair for the terminal user recipient', () => {
    const output = listHandoffTemplatesCommand({
      from: 'planner',
      to: 'user',
      mode: 'chat',
      teamId: 'duo',
    });

    expect(output).toContain('Reply pair: none (`user` replies free-form)');
  });

  test('prefixes the commands with the CLI env prefix', () => {
    const output = listHandoffTemplatesCommand({
      from: 'planner',
      to: 'builder',
      mode: 'code',
      teamId: 'duo',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=x ',
    });

    expect(output).toContain(
      'Send with: CHATROOM_CONVEX_URL=x chatroom handoff --chatroom-id="<chatroom-id>"'
    );
    expect(output).toContain(
      'view: CHATROOM_CONVEX_URL=x chatroom handoff view-template --from="builder" --to="planner" --mode="code"'
    );
  });

  test('mode selects the body and the key for planner → user', () => {
    const chat = listHandoffTemplatesCommand({
      from: 'planner',
      to: 'user',
      mode: 'chat',
      teamId: 'duo',
    });
    const code = listHandoffTemplatesCommand({
      from: 'planner',
      to: 'user',
      mode: 'code',
      teamId: 'duo',
    });

    expect(chat).toContain('key: `duo:planner->user@chat`');
    expect(chat).not.toContain('Proof of Completion');
    expect(code).toContain('key: `duo:planner->user@code`');
    expect(code).toContain('Proof of Completion');
    expect(chat).not.toBe(code);
  });

  test('code:enhanced shares the code bucket key and body', () => {
    const code = listHandoffTemplatesCommand({
      from: 'planner',
      to: 'user',
      mode: 'code',
      teamId: 'duo',
    });
    const enhanced = listHandoffTemplatesCommand({
      from: 'planner',
      to: 'user',
      mode: 'code:enhanced',
      teamId: 'duo',
    });

    expect(enhanced).toContain('key: `duo:planner->user@code`');
    // Same body: only the informational mode label differs.
    expect(enhanced.replace('mode: `code:enhanced`', 'mode: `code`')).toBe(code);
  });

  test('a mode-agnostic pair renders the same body for chat and code', () => {
    const chat = listHandoffTemplatesCommand({
      from: 'planner',
      to: 'builder',
      mode: 'chat',
      teamId: 'duo',
    });
    const code = listHandoffTemplatesCommand({
      from: 'planner',
      to: 'builder',
      mode: 'code',
      teamId: 'duo',
    });

    expect(chat).toContain(plannerBuilderBody);
    expect(code).toContain(plannerBuilderBody);
    // The header block (mode label, key, reply command) differs; the body is identical.
    const bodyAfterHeader = (output: string): string => output.slice(output.indexOf('\n\n') + 2);
    expect(bodyAfterHeader(chat)).toBe(bodyAfterHeader(code));
  });

  test('legacy role-only input lists every pair from that role', () => {
    const error = expectPairError(() =>
      listHandoffTemplatesCommand({ legacyRole: 'planner', teamId: 'duo' })
    );

    expect(error.code).toBe('LEGACY_ROLE_FLAGS');
    expect(error.message).toContain('handoff list-templates no longer accepts --role/--next-role.');
    for (const to of [
      'user',
      'builder',
      'architect',
      'uiux-engineer',
      'triage',
      'researcher',
      'reviewer',
      'verifier',
    ]) {
      expect(error.message).toContain(
        `chatroom handoff list-templates --from="planner" --to="${to}" --mode="<chat|code|code:enhanced>" --team-id="duo"`
      );
    }
    expect(error.message.match(/chatroom handoff list-templates --from="planner"/g)).toHaveLength(
      8
    );
  });

  test('missing --to fails with the exact MISSING_PAIR text', () => {
    const error = expectPairError(() =>
      listHandoffTemplatesCommand({ from: 'planner', teamId: 'duo' })
    );

    expect(error.code).toBe('MISSING_PAIR');
    expect(error.message).toBe(
      [
        'handoff list-templates requires both --from and --to (missing: --to). Handoff templates are keyed by the (sender, recipient) pair.',
        'Example: chatroom handoff list-templates --from="planner" --to="builder" --mode="code" --team-id="duo"',
      ].join('\n')
    );
  });

  test('missing --mode fails with the exact MISSING_MODE text', () => {
    const error = expectPairError(() =>
      listHandoffTemplatesCommand({ from: 'planner', to: 'user', teamId: 'duo' })
    );

    expect(error.code).toBe('MISSING_MODE');
    expect(error.message).toBe(
      [
        'handoff list-templates requires --mode (missing: --mode). Handoff templates are keyed by the (sender, recipient) pair and the conversation mode.',
        'Example: chatroom handoff list-templates --from="planner" --to="user" --mode="chat" --team-id="duo"',
      ].join('\n')
    );
  });

  test('an unknown --mode fails with the exact UNKNOWN_MODE text', () => {
    const error = expectPairError(() =>
      listHandoffTemplatesCommand({ from: 'planner', to: 'user', mode: 'bogus', teamId: 'duo' })
    );

    expect(error.code).toBe('UNKNOWN_MODE');
    expect(error.message).toBe('Unknown mode "bogus". Valid modes: chat, code, code:enhanced.');
  });

  test('unknown team fails with the exact UNKNOWN_TEAM text', () => {
    const error = expectPairError(() =>
      listHandoffTemplatesCommand({ from: 'planner', to: 'builder', teamId: 'tri' })
    );

    expect(error.code).toBe('UNKNOWN_TEAM');
    expect(error.message).toBe('Unknown team "tri". Known teams: duo, solo.');
  });
});
