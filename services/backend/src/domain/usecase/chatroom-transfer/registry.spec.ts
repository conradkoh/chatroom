/**
 * Chatroom transfer registry — structural specs.
 *
 * These specs walk the real `convex/schema.ts` so a new chatroom- or
 * workspace-keyed table, or a new field on an exported table, fails until it has
 * a transfer decision. They also run every read and rollback descriptor against
 * an empty `convex-test` database, which proves each `(table, index)` pair
 * exists at runtime.
 */

import { describe, expect, test } from 'vitest';

import {
  CHATROOM_SCOPED_FAMILIES,
  CHATROOM_SCOPED_TABLES,
  exportedEntries,
  omittedManifest,
  ROLLBACK_ORDER,
  type FieldRule,
} from './registry';
import schema from '../../../../convex/schema';
import { t } from '../../../../test.setup';

interface SchemaValidator {
  kind: string;
  tableName?: string;
  fields?: Record<string, SchemaValidator>;
  members?: SchemaValidator[];
  element?: SchemaValidator;
  value?: SchemaValidator;
}

type TableMap = Record<string, { validator: unknown }>;

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

interface IdField {
  /** Dotted path, e.g. `senderAgent.id`; top-level ids use the bare field name. */
  path: string;
  table: string;
}

/** Every `v.id()` field at any depth, including inside unions, arrays and records. */
function idFields(validator: SchemaValidator, prefix = ''): IdField[] {
  if (validator.kind === 'id') return [{ path: prefix, table: validator.tableName ?? '' }];

  const ids: IdField[] = [];
  for (const [name, field] of Object.entries(validator.fields ?? {})) {
    ids.push(...idFields(field, prefix ? `${prefix}.${name}` : name));
  }
  for (const member of validator.members ?? []) ids.push(...idFields(member, prefix));
  if (validator.element) ids.push(...idFields(validator.element, prefix));
  if (validator.value) ids.push(...idFields(validator.value, prefix));
  return ids;
}

function validatorOf(tables: TableMap, name: string): SchemaValidator {
  return tables[name].validator as SchemaValidator;
}

/** The schema predicate: a table is chatroom-keyed when it carries a room, workspace or machine key. */
function isChatroomKeyed(validator: SchemaValidator): boolean {
  const fields = topLevelFields(validator);
  return (
    fields.has('chatroomId') ||
    fields.has('workspaceId') ||
    (fields.has('machineId') && fields.has('workingDir'))
  );
}

/** Names selected by the predicate that no registry key or family member covers. */
function unclassifiedTables(tables: TableMap, covered: Set<string>): string[] {
  return Object.entries(tables)
    .filter(([, table]) => isChatroomKeyed(table.validator as SchemaValidator))
    .map(([name]) => name)
    .filter((name) => !covered.has(name));
}

function coveredTableNames(): Set<string> {
  const covered = new Set<string>(Object.keys(CHATROOM_SCOPED_TABLES));
  for (const family of Object.values(CHATROOM_SCOPED_FAMILIES)) {
    for (const member of family.members) covered.add(member);
  }
  return covered;
}

interface ProbeQuery {
  take: (limit: number) => Promise<unknown[]>;
  paginate: (opts: { numItems: number; cursor: string | null }) => Promise<unknown>;
}

/** A read descriptor is a paginatable query unless it reads a single row by id. */
function asProbeQuery(value: unknown): ProbeQuery | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('take' in value) || typeof (value as { take: unknown }).take !== 'function')
    return undefined;
  return value as ProbeQuery;
}

const schemaTables = schema.tables as unknown as TableMap;

describe('CHATROOM_SCOPED_TABLES coverage', () => {
  test('classifies every chatroom- or workspace-keyed table', () => {
    const missing = unclassifiedTables(schemaTables, coveredTableNames());
    expect(missing, `unclassified chatroom-keyed table: ${missing.join(', ')}`).toEqual([]);
  });

  test('every registry key and family member names a real table', () => {
    const tableNames = new Set(Object.keys(schema.tables));
    const unknownKeys = Object.keys(CHATROOM_SCOPED_TABLES).filter((name) => !tableNames.has(name));
    expect(unknownKeys).toEqual([]);

    const unknownMembers = Object.values(CHATROOM_SCOPED_FAMILIES).flatMap((family) =>
      family.members.filter((member) => !tableNames.has(member))
    );
    expect(unknownMembers).toEqual([]);
  });

  test('the coverage predicate is guarded against a fake table map', () => {
    const fakeTables: TableMap = {
      chatroom_fake: {
        validator: {
          kind: 'object',
          fields: { chatroomId: { kind: 'id', tableName: 'chatroom_rooms' } },
        },
      },
    };
    expect(unclassifiedTables(fakeTables, new Set())).toEqual(['chatroom_fake']);
  });
});

describe('exported field rules', () => {
  test('every top-level field has a rule and every rule names a field', () => {
    for (const [name, entry] of Object.entries(CHATROOM_SCOPED_TABLES)) {
      if (entry.classification !== 'exported') continue;
      const fields = [...topLevelFields(validatorOf(schemaTables, name))];
      const ruled = Object.keys(entry.fields);

      for (const field of fields) {
        expect(entry.fields[field], `missing field rule for ${name}.${field}`).toBeDefined();
      }
      for (const field of ruled) {
        expect(fields, `rule names unknown field ${name}.${field}`).toContain(field);
      }
    }
  });

  test('every id field is ref, system, drop, derive or rebind', () => {
    const allowed: FieldRule['rule'][] = ['ref', 'system', 'drop', 'derive', 'rebind'];
    for (const [name, entry] of Object.entries(CHATROOM_SCOPED_TABLES)) {
      if (entry.classification !== 'exported') continue;
      for (const id of idFields(validatorOf(schemaTables, name))) {
        const rule = entry.fields[id.path.split('.')[0]];
        expect(rule, `missing rule for id field ${name}.${id.path}`).toBeDefined();
        expect(allowed, `${name}.${id.path} is an id but its rule is ${rule.rule}`).toContain(
          rule.rule
        );
        if (id.table === 'users') {
          expect(['system', 'drop'], `${name}.${id.path} is a user id`).toContain(rule.rule);
        }
      }
    }
  });

  test('every ref points at an exported table', () => {
    const exportedTables = new Set(
      Object.entries(CHATROOM_SCOPED_TABLES)
        .filter(([, entry]) => entry.classification === 'exported')
        .map(([name]) => name)
    );
    for (const [name, entry] of Object.entries(CHATROOM_SCOPED_TABLES)) {
      if (entry.classification !== 'exported') continue;
      for (const [field, rule] of Object.entries(entry.fields)) {
        if (rule.rule !== 'ref') continue;
        expect(exportedTables, `${name}.${field} refs ${rule.table}`).toContain(rule.table);
      }
    }
  });
});

describe('entry metadata', () => {
  test('rebuilt entries name their rebuilder; excluded and rebuilt entries explain why', () => {
    for (const [name, entry] of Object.entries(CHATROOM_SCOPED_TABLES)) {
      if (entry.classification === 'rebuilt') {
        expect(entry.rebuiltBy.trim(), `${name} needs rebuiltBy`).not.toBe('');
      }
      if (entry.classification !== 'exported') {
        expect(entry.reason.trim(), `${name} needs a reason`).not.toBe('');
      }
    }
    for (const [name, family] of Object.entries(CHATROOM_SCOPED_FAMILIES)) {
      expect(family.reason.trim(), `${name} needs a reason`).not.toBe('');
      if (family.classification === 'rebuilt') {
        expect(family.rebuiltBy.trim(), `${name} needs rebuiltBy`).not.toBe('');
      }
    }
  });

  test('omittedManifest has one key per non-exported entry or family with a reason', () => {
    const manifest = omittedManifest();
    const nonExported = Object.entries(CHATROOM_SCOPED_TABLES)
      .filter(([, entry]) => entry.classification !== 'exported')
      .map(([name]) => name);
    const families = Object.keys(CHATROOM_SCOPED_FAMILIES);
    const exported = new Set(
      Object.entries(CHATROOM_SCOPED_TABLES)
        .filter(([, entry]) => entry.classification === 'exported')
        .map(([name]) => name)
    );

    for (const name of [...nonExported, ...families]) {
      expect(manifest[name], `omittedManifest is missing ${name}`).toBeDefined();
      expect(manifest[name].reason.trim(), `omittedManifest reason for ${name}`).not.toBe('');
      expect(manifest[name].count, `omittedManifest count for ${name}`).toBeNull();
    }
    for (const name of Object.keys(manifest)) {
      expect(exported.has(name), `omittedManifest names exported table ${name}`).toBe(false);
    }
    for (const name of [
      'workspaceRemovals',
      'backlogDeleted',
      'launchRequestsOtherTeam',
      'attachedWorkflows',
    ]) {
      expect(manifest[name], `omittedManifest is missing counted category ${name}`).toBeDefined();
    }
  });

  test('ROLLBACK_ORDER contains exactly the entries with a rollback descriptor', () => {
    const withRollback = Object.entries(CHATROOM_SCOPED_TABLES)
      .filter(([, entry]) => entry.rollback)
      .map(([name]) => name)
      .sort();
    expect([...ROLLBACK_ORDER].sort()).toEqual(withRollback);
    expect(ROLLBACK_ORDER.at(-1)).toBe('chatroom_rooms');
  });
});

describe('descriptor probes', () => {
  test('every exported table has a rollback descriptor', () => {
    for (const [name, entry] of Object.entries(CHATROOM_SCOPED_TABLES)) {
      if (entry.classification !== 'exported') continue;
      expect(entry.rollback, `missing rollback for exported table ${name}`).toBeDefined();
    }
  });

  test('every read and rollback descriptor runs against an empty database', async () => {
    await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert('users', { type: 'anonymous', name: 'transfer-spec' });
      const chatroomId = await ctx.db.insert('chatroom_rooms', {
        ownerId,
        status: 'active',
      });
      const key = { chatroomId, ownerId };

      for (const [name, entry] of Object.entries(CHATROOM_SCOPED_TABLES)) {
        if (entry.classification === 'exported') {
          const read = asProbeQuery(entry.read(ctx, chatroomId));
          if (read) {
            // Convex allows one `.paginate()` per function execution, so probe the
            // index with `.take(1)` and assert the paginatable shape separately.
            expect(typeof read.paginate, `paginate for ${name}`).toBe('function');
            expect(await read.take(1), `read for ${name}`).toEqual([]);
          }
        }
        if (entry.rollback) {
          const rows = await entry.rollback.take(ctx, key, 1);
          // The room's rollback reads the root row by id; every other descriptor
          // reads a chatroom-keyed index, which is empty in this probe database.
          const expected = name === 'chatroom_rooms' ? [{ _id: chatroomId }] : [];
          expect(rows, `rollback for ${name}`).toEqual(expected);
        }
      }

      for (const entry of exportedEntries()) {
        expect(entry.rollback, `missing rollback for ${entry.category}`).toBeDefined();
      }
    });
  });
});
