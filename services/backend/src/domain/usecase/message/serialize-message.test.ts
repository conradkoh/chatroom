import { describe, expect, it } from 'vitest';

import { serializeMessage } from './serialize-message';
import type { SerializableMessage } from '../../entities/serializable-message';

const message: SerializableMessage = {
  _id: 'm1',
  _creationTime: 0,
  senderRole: 'builder',
  targetRole: 'planner',
  type: 'message',
  content: 'A < B',
  attachments: {
    attachedSnippets: [{ reference: 's', fileSource: 'a.ts', selectedContent: 'const x = 1;' }],
    attachedMessages: [{ _id: 'm2', content: 'prior', senderRole: 'user' }],
    attachedBacklogItems: [{ _id: 'b', content: 'work', status: 'open' }],
    attachedTasks: [{ _id: 't', content: 'task', status: 'todo' }],
  },
  task: { _id: 't0', status: 'open', content: 'linked' },
};
describe('serializeMessage', () => {
  it('renders all attachments in linear and context profiles', () => {
    expect(
      serializeMessage(message, { profile: 'linear', chatroomId: 'c', role: 'builder' })
    ).toContain('<attachments>');
    const context = serializeMessage(message, {
      profile: 'context-xml',
      chatroomId: 'c',
      role: 'builder',
    });
    expect(context).toContain('type="snippet"');
    expect(context).toContain('type="message"');
    expect(context).toContain('<task');
  });
  it('escapes task-origin content and omits attachments', () => {
    const output = serializeMessage(message, { profile: 'task-origin' });
    expect(output).toContain('A &lt; B');
    expect(output).not.toContain('<attachments>');
  });
  it('omits empty attachment blocks', () => {
    expect(
      serializeMessage({ ...message, attachments: undefined }, { profile: 'linear' })
    ).not.toContain('<attachments>');
  });
});
