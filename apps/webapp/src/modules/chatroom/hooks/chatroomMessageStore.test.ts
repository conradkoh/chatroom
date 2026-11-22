import { describe, expect, it } from 'vitest';

import { toMessage } from './chatroomMessageStore';

describe('toMessage', () => {
  it('passes attached file metadata through unchanged', () => {
    const attachedFiles = [
      {
        _id: 'attachment-1',
        status: 'available' as const,
        filename: 'shot.png',
        mimeType: 'image/png',
        sizeBytes: 1536,
      },
      { _id: 'attachment-2', status: 'removed' as const },
    ];

    const message = toMessage({
      _id: 'msg-1',
      type: 'handoff',
      senderRole: 'builder',
      content: 'Done',
      _creationTime: 1000,
      attachedFiles,
    });

    expect(message.attachedFiles).toEqual(attachedFiles);
  });

  it('leaves attachedFiles undefined when the source has none', () => {
    const message = toMessage({
      _id: 'msg-1',
      type: 'handoff',
      senderRole: 'builder',
      content: 'Done',
      _creationTime: 1000,
    });

    expect(message.attachedFiles).toBeUndefined();
  });

  it('passes the handoff sender agent snapshot through unchanged', () => {
    const senderAgent = { harness: 'opencode', model: 'gpt-5.1-codex' };

    const message = toMessage({
      _id: 'msg-1',
      type: 'handoff',
      senderRole: 'builder',
      content: 'Done',
      _creationTime: 1000,
      senderAgent,
    });

    expect(message.senderAgent).toEqual(senderAgent);
  });

  it('leaves senderAgent undefined for legacy rows', () => {
    const message = toMessage({
      _id: 'msg-1',
      type: 'handoff',
      senderRole: 'builder',
      content: 'Done',
      _creationTime: 1000,
    });

    expect(message.senderAgent).toBeUndefined();
  });
});
