import { describe, expect, test } from 'vitest';

import {
  buildLinearMessageContent,
  buildMessageMarkdown,
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
  test('sorts descending by date (newer = lexicographically smaller prefix)', () => {
    const older = messageFilename({ ...sampleMsg, _creationTime: 1_700_000_000_000 });
    const newer = messageFilename({
      ...sampleMsg,
      _id: 'msg-new',
      _creationTime: 1_800_000_000_000,
    });
    expect(newer < older).toBe(true);
  });

  test('includes sender and receiver roles', () => {
    const name = messageFilename({ ...fullMsg });
    expect(name).toContain('planner-to-builder');
  });

  test('uses "all" when no targetRole', () => {
    const name = messageFilename(sampleMsg);
    expect(name).toContain('planner-to-all');
  });
});

describe('buildLinearMessageContent', () => {
  test('includes timestamp, sender, receiver, and content', () => {
    const content = buildLinearMessageContent(fullMsg);
    expect(content).toContain('planner');
    expect(content).toContain('→ builder');
    expect(content).toContain('Hello world');
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
