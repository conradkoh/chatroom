/**
 * File Attachment entity — unit tests
 *
 * Guards the Convex status validator against drift from its Zod enum and pins
 * the lifecycle/quota constants to their documented values.
 */

import { describe, expect, test } from 'vitest';

import {
  DEFAULT_CHATROOM_FILE_QUOTA_BYTES,
  DEFAULT_USER_FILE_QUOTA_BYTES,
  PENDING_UPLOAD_TTL_MS,
  PLATFORM_MAX_FILE_QUOTA_BYTES,
  UPLOADED_UNATTACHED_TTL_MS,
  fileAttachmentStatusSchema,
  fileAttachmentStatusValidator,
} from './file-attachment';

describe('fileAttachmentStatusValidator', () => {
  test('members stay in sync with the status enum options', () => {
    const members = fileAttachmentStatusValidator.members as readonly { value: string }[];
    expect(members).toHaveLength(fileAttachmentStatusSchema.options.length);
    fileAttachmentStatusSchema.options.forEach((option, index) => {
      expect(members[index]?.value).toBe(option);
    });
  });

  test('status literals are ordered as documented', () => {
    expect(fileAttachmentStatusSchema.options).toEqual(['pending_upload', 'uploaded', 'attached']);
  });
});

describe('file attachment constants', () => {
  test('lifecycle windows match documented durations', () => {
    expect(PENDING_UPLOAD_TTL_MS).toBe(900000);
    expect(UPLOADED_UNATTACHED_TTL_MS).toBe(3600000);
  });

  test('quota defaults match documented sizes', () => {
    expect(DEFAULT_USER_FILE_QUOTA_BYTES).toBe(1073741824);
    expect(DEFAULT_CHATROOM_FILE_QUOTA_BYTES).toBe(268435456);
    expect(PLATFORM_MAX_FILE_QUOTA_BYTES).toBe(5368709120);
  });
});
