/**
 * Tests for the pair-keyed handoff template listing (discovery command data).
 */

import { describe, expect, test } from 'vitest';

import { listHandoffTemplatesCommand } from './list-templates';
import { HandoffTemplatePairError } from './pair';
import { getPlannerToBuilderHandoffTemplate } from '../../teams/duo/handoff-templates/planner-to-builder';

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
      teamId: 'duo',
    });

    expect(output).toContain(
      'Handoff template `planner` → `builder` (team: `duo`, key: `duo:planner->builder`)'
    );
    expect(output).toContain(
      'Send with: chatroom handoff --chatroom-id="<chatroom-id>" --role="planner" --next-role="builder"'
    );
    expect(output).toContain(
      'Reply pair: `builder` → `planner` (view: chatroom handoff view-template --from="builder" --to="planner" --team-id="duo")'
    );
    expect(output).toContain(getPlannerToBuilderHandoffTemplate());
  });

  test('prints the reply pair for a role recipient', () => {
    const output = listHandoffTemplatesCommand({ from: 'builder', to: 'planner', teamId: 'duo' });

    expect(output).toContain('Reply pair: `planner` → `builder`');
  });

  test('prints no reply pair for the terminal user recipient', () => {
    const output = listHandoffTemplatesCommand({ from: 'planner', to: 'user', teamId: 'duo' });

    expect(output).toContain('Reply pair: none (`user` replies free-form)');
  });

  test('prefixes the commands with the CLI env prefix', () => {
    const output = listHandoffTemplatesCommand({
      from: 'planner',
      to: 'builder',
      teamId: 'duo',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=x ',
    });

    expect(output).toContain(
      'Send with: CHATROOM_CONVEX_URL=x chatroom handoff --chatroom-id="<chatroom-id>"'
    );
    expect(output).toContain(
      'view: CHATROOM_CONVEX_URL=x chatroom handoff view-template --from="builder" --to="planner"'
    );
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
      'verifier',
    ]) {
      expect(error.message).toContain(
        `chatroom handoff list-templates --from="planner" --to="${to}" --team-id="duo"`
      );
    }
    expect(error.message.match(/chatroom handoff list-templates --from="planner"/g)).toHaveLength(
      7
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
        'Example: chatroom handoff list-templates --from="planner" --to="builder" --team-id="duo"',
      ].join('\n')
    );
  });

  test('unknown team fails with the exact UNKNOWN_TEAM text', () => {
    const error = expectPairError(() =>
      listHandoffTemplatesCommand({ from: 'planner', to: 'builder', teamId: 'tri' })
    );

    expect(error.code).toBe('UNKNOWN_TEAM');
    expect(error.message).toBe('Unknown team "tri". Known teams: duo, solo.');
  });
});
