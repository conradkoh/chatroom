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
const notice: SerializableMessage = {
  _id: 'n1',
  _creationTime: 0,
  senderRole: 'builder',
  targetRole: 'user',
  type: 'notice',
  content: 'Heads up',
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
  it('renders a notice as from the agent, never from the user (context-xml)', () => {
    const xml = serializeMessage(notice, {
      profile: 'context-xml',
      chatroomId: 'c',
      role: 'builder',
    });
    expect(xml).toContain('from="builder"');
    expect(xml).toContain('to="user"');
    expect(xml).toContain('type="notice"');
    expect(xml).not.toContain('from="user"');
  });
  it('renders a notice with an agent → user linear header and no user prefix', () => {
    const output = serializeMessage(notice, {
      profile: 'linear',
      chatroomId: 'c',
      role: 'builder',
    });
    expect(output).toContain('builder → user');
    expect(output).toContain('Heads up');
    expect(output).not.toContain('user |');
  });
  it('renders a user message as from the user (context-xml)', () => {
    const userMessage: SerializableMessage = {
      _id: 'u1',
      _creationTime: 0,
      senderRole: 'user',
      targetRole: 'builder',
      type: 'message',
      content: 'Do it',
    };
    const xml = serializeMessage(userMessage, {
      profile: 'context-xml',
      chatroomId: 'c',
      role: 'builder',
    });
    expect(xml).toContain('from="user"');
  });
});
