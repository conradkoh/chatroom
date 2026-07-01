/**
 * Zod helpers for Convex document IDs on the wire (JSON-serialized as strings).
 */

import { z } from 'zod';

import type { Id, TableNames } from '../../../../convex/_generated/dataModel';

/** Runtime-validated Convex table ID — output type is `Id<TableName>`. */
export function convexIdSchema<TableName extends TableNames>(
  _tableName: TableName
): z.ZodType<Id<TableName>> {
  return z.custom<Id<TableName>>((value) => typeof value === 'string' && value.length > 0);
}
