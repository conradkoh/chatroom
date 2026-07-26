import { describe, expect, test } from 'vitest';
import {
  buildMessageMarkdown,
  buildTranscriptMarkdown,
  messageFilename,
} from './messages-fs-service.js';

const sampleMsg = {
  _id: 'msg-123',
  _creationTime: 1_700_000_000_000,
  senderRole: 'planner',
  type: 'message',
  content: 'Hello world',
};

const fullMsg = {
  ...sampleMsg,
  targetRole: 'builder',
  classification: 'new_feature',
  taskStatus: 'completed',
  featureTitle: 'Add login',
};

describe('messageFilename', () => {
  test('creates a filename from creation time and id', () => {
    const name = messageFilename(sampleMsg);
    expect(name).toMatch(/\.md$/);
    expect(name).toContain('msg-123');
  });
});

describe('buildMessageMarkdown', () => {
  test('includes frontmatter with id, createdAt, senderRole', () => {
    const md = buildMessageMarkdown(sampleMsg);
    expect(md).toContain('id: msg-123');
    expect(md).toContain('senderRole: planner');
    expect(md).toContain('Hello world');
  });

  test('includes optional fields when present', () => {
    const md = buildMessageMarkdown(fullMsg);
    expect(md).toContain('targetRole: builder');
    expect(md).toContain('classification: new_feature');
    expect(md).toContain('taskStatus: completed');
    expect(md).toContain('featureTitle: Add login');
  });
});

describe('buildTranscriptMarkdown', () => {
  test('joins messages with separators', () => {
    const result = buildTranscriptMarkdown([
      sampleMsg,
      { ...sampleMsg, _id: 'msg-456', content: 'Second message' },
    ]);
    expect(result).toContain('## ');
    expect(result).toContain('Hello world');
    expect(result).toContain('Second message');
    expect(result).toContain('---');
  });
});
