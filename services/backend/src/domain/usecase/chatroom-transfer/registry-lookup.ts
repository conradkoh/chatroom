/**
 * Chatroom transfer registry — lookups shared by the export reader and the
 * pure build.
 *
 * Both modules need the exported table behind a category and that table's field
 * rules. The reader calls the entry's `read`; the build only needs the rules and
 * the table name. Keeping the lookup here gives one implementation and keeps
 * `export-build.ts` free of Convex server code (it imports only the registry and
 * this module, both of which have type-only Convex imports).
 */

import { CHATROOM_SCOPED_TABLES, type ExportedEntry, type FieldRule } from './registry';
import type { ExportCategory } from '../../entities/chatroom-transfer-file';

export interface ExportedTable {
  table: string;
  entry: ExportedEntry;
}

/**
 * The single exported table for a paginated category. `room` merges three
 * tables, so callers resolve it explicitly and never ask for it here.
 */
export function exportedEntryFor(category: Exclude<ExportCategory, 'room'>): ExportedTable {
  for (const [table, entry] of Object.entries(CHATROOM_SCOPED_TABLES)) {
    if (entry.classification === 'exported' && entry.category === category) {
      return { table, entry };
    }
  }
  throw new Error(`Chatroom transfer registry: no exported table for category ${category}`);
}

/** Field rules of an exported table. */
export function rulesOf(table: string): Record<string, FieldRule> {
  const entry = CHATROOM_SCOPED_TABLES[table];
  if (!entry || entry.classification !== 'exported') {
    throw new Error(`Chatroom transfer registry: no exported table ${table}`);
  }
  return entry.fields;
}
