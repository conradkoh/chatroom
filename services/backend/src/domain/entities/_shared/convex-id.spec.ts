import { describe, expect, it } from 'vitest';

import { convexIdSchema } from './convex-id';
import type { Id, TableNames } from '../../../../convex/_generated/dataModel';

describe('convexIdSchema', () => {
  it('parses non-empty strings as branded Convex IDs', () => {
    const schema = convexIdSchema('chatroom_tasks');
    const parsed = schema.parse('task_abc');
    const _typed: Id<'chatroom_tasks'> = parsed;
    expect(parsed).toBe('task_abc');
  });

  it('rejects empty strings', () => {
    expect(convexIdSchema('chatroom_rooms').safeParse('').success).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(convexIdSchema('chatroom_rooms').safeParse(42).success).toBe(false);
  });

  it('preserves table name in schema factory (compile-time)', () => {
    const tables: TableNames[] = ['chatroom_tasks', 'chatroom_rooms'];
    for (const table of tables) {
      expect(convexIdSchema(table).parse('id_1')).toBe('id_1');
    }
  });
});
