/**
 * Stored-schema acceptance of retired literals.
 *
 * The narrowing commit removed `code:enhanced`, `enhanced-team`, and
 * `enhancement` from the stored validators before the retirement migration ran.
 * These tests pin the table validators directly (not only
 * `taskEnvelopeV1Validator`) so historical rows continue to validate.
 */

import { describe, expect, test } from 'vitest';

import schema from './schema';

/** A Convex union validator whose members are literals. */
interface LiteralUnion {
  members: readonly { value: string }[];
}

function literalValues(validator: LiteralUnion): string[] {
  return validator.members.map((member) => member.value);
}

function tableField(table: string, field: string): any {
  const definition = (schema as unknown as { tables: Record<string, any> }).tables[table];
  return definition.validator.fields[field];
}

describe('retired conversation modes still validate stored rows', () => {
  test.each(['chatroom_tasks', 'chatroom_messageQueue'])(
    '%s.conversationMode accepts the deprecated code:enhanced mode',
    (table) => {
      const members = literalValues(tableField(table, 'conversationMode'));

      expect(members).toContain('code:enhanced');
      expect(members).toEqual(['chat', 'code', 'code:enhanced']);
      expect(members).not.toContain('team');
    }
  );

  test('chatroom_conversationModePreferences.mode accepts the deprecated code:enhanced mode', () => {
    const members = literalValues(tableField('chatroom_conversationModePreferences', 'mode'));

    expect(members).toContain('code:enhanced');
    expect(members).toEqual(['chat', 'code', 'code:enhanced']);
    expect(members).not.toContain('team');
  });
});

describe('retired handoff workflow values still validate stored envelopes', () => {
  const workflowFields = (table: string) =>
    tableField(table, 'taskEnvelope').fields.handoffWorkflow.fields;

  test.each(['chatroom_tasks', 'chatroom_messageQueue'])(
    '%s.taskEnvelope.preset accepts the deprecated enhanced-team value',
    (table) => {
      const members = literalValues(workflowFields(table).preset);

      expect(members).toContain('enhanced-team');
      expect(members).toEqual(['direct', 'team', 'enhanced-team']);
      expect(members).not.toContain('enhanced');
    }
  );

  test.each(['chatroom_tasks', 'chatroom_messageQueue'])(
    '%s.taskEnvelope.phase accepts the deprecated enhancement value',
    (table) => {
      const members = literalValues(workflowFields(table).phase);

      expect(members).toContain('enhancement');
      expect(members).toEqual(['entry', 'enhancement', 'implementation', 'delivery']);
      expect(members).not.toContain('enhanced');
    }
  );
});
