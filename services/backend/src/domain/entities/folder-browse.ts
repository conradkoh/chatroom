import { FOLDER_BROWSE_ERROR_CODES } from '@workspace/shared/domain/folder-browse';
import { v } from 'convex/values';

export const folderBrowseErrorCodeValidator = v.union(
  ...FOLDER_BROWSE_ERROR_CODES.map((code) => v.literal(code))
);

export const folderBrowseEntryValidator = v.object({
  name: v.string(),
  symlink: v.optional(v.literal(true)),
});

export const folderBrowseStateValidator = v.union(
  v.literal('pending'),
  v.literal('ready'),
  v.literal('error')
);

export const folderBrowseReportResultValidator = v.union(
  v.object({
    kind: v.literal('listing'),
    path: v.string(),
    parentPath: v.union(v.string(), v.null()),
    entries: v.array(folderBrowseEntryValidator),
    dirCount: v.number(),
    fileCount: v.number(),
    hiddenCount: v.number(),
    complete: v.boolean(),
  }),
  v.object({
    kind: v.literal('error'),
    code: folderBrowseErrorCodeValidator,
    message: v.string(),
    path: v.string(),
  })
);
