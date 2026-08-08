import { describe, expect, it } from 'vitest';

import {
  buildChatAttachmentUploadPath,
  CHAT_ATTACHMENT_UPLOAD_DIR,
  getInvalidChatAttachmentUploadPathReason,
  sanitizeChatAttachmentFileName,
} from './chat-attachment-upload-path';

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('sanitizeChatAttachmentFileName', () => {
  it('strips unsafe characters from basename', () => {
    expect(sanitizeChatAttachmentFileName('my"file<>.txt')).toBe('myfile.txt');
  });

  it('falls back to attachment for dot-only names', () => {
    expect(sanitizeChatAttachmentFileName('.')).toBe('attachment');
  });
});

describe('buildChatAttachmentUploadPath', () => {
  it('builds a valid attachment path', () => {
    const path = buildChatAttachmentUploadPath('notes.md', VALID_UUID);
    expect(path).toBe(`${CHAT_ATTACHMENT_UPLOAD_DIR}/${VALID_UUID}_notes.md`);
    expect(getInvalidChatAttachmentUploadPathReason(path)).toBeNull();
  });

  it('rejects invalid uuid', () => {
    expect(() => buildChatAttachmentUploadPath('notes.md', 'not-a-uuid')).toThrow(
      /Invalid attachment id/i
    );
  });
});

describe('getInvalidChatAttachmentUploadPathReason', () => {
  it('accepts a well-formed attachment path', () => {
    const path = buildChatAttachmentUploadPath('report.pdf', VALID_UUID);
    expect(getInvalidChatAttachmentUploadPathReason(path)).toBeNull();
  });

  it('rejects wrong prefix', () => {
    expect(getInvalidChatAttachmentUploadPathReason('uploads/file.txt')).toMatch(
      /Invalid attachment path/i
    );
  });

  it('rejects extra path segments', () => {
    expect(
      getInvalidChatAttachmentUploadPathReason(
        `${CHAT_ATTACHMENT_UPLOAD_DIR}/${VALID_UUID}_nested/extra.txt`
      )
    ).toMatch(/Invalid attachment path/i);
  });

  it('rejects backslashes', () => {
    expect(
      getInvalidChatAttachmentUploadPathReason(
        `${CHAT_ATTACHMENT_UPLOAD_DIR}\\${VALID_UUID}_file.txt`
      )
    ).toMatch(/Invalid attachment path/i);
  });

  it('rejects quotes in basename segment', () => {
    expect(
      getInvalidChatAttachmentUploadPathReason(
        `${CHAT_ATTACHMENT_UPLOAD_DIR}/${VALID_UUID}_bad"name.txt`
      )
    ).toMatch(/Invalid attachment path/i);
  });

  it('rejects oversize filename component', () => {
    const longBasename = 'a'.repeat(300);
    const path = `${CHAT_ATTACHMENT_UPLOAD_DIR}/${VALID_UUID}_${longBasename}`;
    expect(getInvalidChatAttachmentUploadPathReason(path)).toMatch(/Invalid attachment path/i);
  });
});
