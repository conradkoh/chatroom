import { z } from 'zod';

const pathEntry = z.strictObject({ path: z.string(), type: z.enum(['file', 'directory']) });

export const workspaceFileTreeDeltaSchema = z.strictObject({
  baseRevision: z.number(),
  delta: z.strictObject({
    operationId: z.string(),
    added: z.array(pathEntry),
    removed: z.array(z.string()),
    typeChanged: z.array(pathEntry),
    createdAt: z.number(),
  }),
});

export const workspaceFileTreeCheckpointSchema = z.strictObject({
  revision: z.number(),
  tree: z.strictObject({
    entries: z.array(
      pathEntry.extend({
        size: z.number().optional(),
        modifiedAt: z.number().optional(),
      })
    ),
    scannedAt: z.number(),
    rootDir: z.string(),
  }),
});
