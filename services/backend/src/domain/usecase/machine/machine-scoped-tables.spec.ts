/**
 * Machine-scoped purge registry — structural specs.
 *
 * 1. Coverage: every table with a top-level `machineId` field is either purged by
 *    `MACHINE_SCOPED_TABLES` or explicitly exempted with a reason. This fails when a
 *    new machine-keyed table is added without a purge decision.
 * 2. Index validity: every descriptor's `(table, index)` pair exists at runtime. Each
 *    `take` runs against an empty database, so a typo in an index name throws instead
 *    of silently deleting nothing.
 */

import { describe, expect, test } from 'vitest';

import { MACHINE_SCOPED_EXEMPTIONS, MACHINE_SCOPED_TABLES } from './machine-scoped-tables';
import schema from '../../../../convex/schema';
import { t } from '../../../../test.setup';

interface SchemaValidator {
  kind: string;
  fields?: Record<string, unknown>;
  members?: SchemaValidator[];
}

/** Top-level fields of a table validator, including every union member. */
function topLevelFields(validator: SchemaValidator): Set<string> {
  const fields = new Set<string>();
  if (validator.kind === 'object' && validator.fields) {
    for (const name of Object.keys(validator.fields)) fields.add(name);
  }
  for (const member of validator.members ?? []) {
    for (const name of topLevelFields(member)) fields.add(name);
  }
  return fields;
}

describe('MACHINE_SCOPED_TABLES', () => {
  test('covers every table with a top-level machineId field', () => {
    const registered = new Set<string>(MACHINE_SCOPED_TABLES.map((entry) => entry.table));
    const exempt = new Set(Object.keys(MACHINE_SCOPED_EXEMPTIONS));
    const machineKeyed: string[] = [];

    for (const [name, table] of Object.entries(schema.tables)) {
      const validator = table.validator as unknown as SchemaValidator;
      if (topLevelFields(validator).has('machineId')) machineKeyed.push(name);
    }

    expect(machineKeyed.length).toBeGreaterThan(0);
    expect(machineKeyed.filter((name) => !registered.has(name) && !exempt.has(name))).toEqual([]);
  });

  test('every registry and exemption entry names a real table', () => {
    const tableNames = new Set(Object.keys(schema.tables));
    expect(MACHINE_SCOPED_TABLES.filter((entry) => !tableNames.has(entry.table))).toEqual([]);
    expect(Object.keys(MACHINE_SCOPED_EXEMPTIONS).filter((name) => !tableNames.has(name))).toEqual(
      []
    );
  });

  test('every descriptor (table, index) pair is valid at runtime', async () => {
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { type: 'anonymous', name: 'purge-spec' });
      for (const entry of MACHINE_SCOPED_TABLES) {
        const rows = await entry.take(ctx, { machineId: 'no-such-machine', userId }, 1);
        expect(rows, entry.table).toEqual([]);
      }
    });
  });

  test('deleting a machine backup request deletes its stored blob first', async () => {
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { type: 'anonymous', name: 'backup-purge' });
      const storageId = await ctx.storage.store(new Blob(['abc']));
      const now = Date.now();
      const requestId = await ctx.db.insert('chatroom_machineBackupRequests', {
        userId,
        machineId: 'machine-with-backup',
        kind: 'download',
        status: 'ready',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 3_600_000,
        filename: 'backup-20260101-123456.zip',
        sizeBytes: 3,
        storageId,
      });

      const entry = MACHINE_SCOPED_TABLES.find(
        (candidate) => candidate.table === 'chatroom_machineBackupRequests'
      );
      expect(entry?.deleteRow).toBeDefined();

      const result = await entry!.deleteRow!(ctx, { _id: requestId });

      expect(result).toEqual({ writes: 2, removed: true });
      expect(await ctx.db.get('chatroom_machineBackupRequests', requestId)).toBeNull();
      expect(await ctx.db.system.get('_storage', storageId)).toBeNull();
    });
  });
});
