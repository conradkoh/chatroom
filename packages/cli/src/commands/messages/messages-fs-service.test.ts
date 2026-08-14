import { describe, expect, test } from 'vitest';

import { messageFilename } from './messages-fs-service.js';

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
  taskStatus: 'completed',
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
