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

  it('carries supersedesPlanId from a raw plan row', () => {
    const message = toMessage({
      _id: 'plan-new-1',
      type: 'plan',
      senderRole: 'specifier',
      content: '# Plan',
      _creationTime: 1000,
      supersedesPlanId: 'plan-old-1234',
    });

    expect(message.supersedesPlanId).toBe('plan-old-1234');
  });

  it('leaves supersedesPlanId undefined when the row has none', () => {
    const message = toMessage({
      _id: 'plan-new-2',
      type: 'plan',
      senderRole: 'specifier',
      content: '# Plan',
      _creationTime: 1000,
    });

    expect(message.supersedesPlanId).toBeUndefined();
  });
});
