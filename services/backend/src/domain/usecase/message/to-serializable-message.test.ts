import { describe, expect, it } from 'vitest';

import { toSerializableMessage } from './to-serializable-message';

const base = {
  _id: 'm',
  _creationTime: 1,
  senderRole: 'builder',
  type: 'message',
  content: 'hello',
};
describe('toSerializableMessage', () => {
  it('normalizes attachment ids and backlog status drift', () => {
    const result = toSerializableMessage({
      ...base,
      attachedBacklogItems: [{ id: 'b', content: 'work', status: 'open' }],
      attachedTasks: [{ _id: 't', content: 'task', backlogStatus: 'todo' }],
    });
    expect(result.attachments).toEqual({
      attachedBacklogItems: [{ _id: 'b', content: 'work', status: 'open' }],
      attachedTasks: [{ _id: 't', content: 'task', status: 'todo' }],
    });
  });

  it('preserves message and snippet attachments without task attachments', () => {
    const result = toSerializableMessage({
      ...base,
      attachedMessages: [{ _id: 'm2', content: 'related', senderRole: 'planner' }],
      attachedSnippets: [
        { reference: 'src/a.ts', fileSource: 'workspace', selectedContent: 'code' },
      ],
    });
    expect(result.attachments).toEqual({
      attachedMessages: [{ _id: 'm2', content: 'related', senderRole: 'planner' }],
      attachedSnippets: [
        { reference: 'src/a.ts', fileSource: 'workspace', selectedContent: 'code' },
      ],
    });
  });
});
