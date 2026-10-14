import { describe, expect, it } from 'vitest';

import { serializeMessage } from './serialize-message';
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

  it('renders the nested task as a context-xml <task> block', () => {
    const result = toSerializableMessage({
      ...base,
      task: { _id: 't1', status: 'in_progress', content: 'Do it' },
    });
    const xml = serializeMessage(result, { profile: 'context-xml' });
    expect(xml).toContain('<task id="t1" status="in_progress">');
    expect(xml).toContain('Do it');
  });

  it('omits the <task> block when there is no nested task', () => {
    const withTaskId = toSerializableMessage({ ...base, taskId: 't1' });
    expect(serializeMessage(withTaskId, { profile: 'context-xml' })).not.toContain('<task');
    const withoutTask = toSerializableMessage({ ...base });
    expect(serializeMessage(withoutTask, { profile: 'context-xml' })).not.toContain('<task');
  });
});
