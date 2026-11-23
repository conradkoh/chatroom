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
describe('linear header sender snapshot', () => {
  it('appends harness and model to the first line', () => {
    const output = serializeMessage(
      { ...notice, senderAgent: { harness: 'claude-sdk', model: 'anthropic/claude-sonnet-4' } },
      { profile: 'linear' }
    );
    expect(output.split('\n')[0]).toBe(
      '1970-01-01T00:00:00.000Z | builder → user | harness=claude-sdk model=anthropic/claude-sonnet-4'
    );
  });
  it('appends harness only when the snapshot has no model', () => {
    const output = serializeMessage(
      { ...notice, senderAgent: { harness: 'codex-sdk' } },
      { profile: 'linear' }
    );
    expect(output.split('\n')[0]).toBe(
      '1970-01-01T00:00:00.000Z | builder → user | harness=codex-sdk'
    );
  });
  it('leaves the output byte-identical when there is no snapshot', () => {
    expect(serializeMessage(notice, { profile: 'linear' })).toBe(
      '1970-01-01T00:00:00.000Z | builder → user\n\nHeads up'
    );
  });
  it('never changes the context-xml or task-origin profiles', () => {
    const withSnapshot = { ...notice, senderAgent: { harness: 'claude-sdk', model: 'm' } };
    expect(
      serializeMessage(withSnapshot, { profile: 'context-xml', chatroomId: 'c', role: 'builder' })
    ).toBe(serializeMessage(notice, { profile: 'context-xml', chatroomId: 'c', role: 'builder' }));
    expect(serializeMessage(withSnapshot, { profile: 'task-origin' })).toBe(
      serializeMessage(notice, { profile: 'task-origin' })
    );
  });
});

describe('linear plan tagging', () => {
  const base: SerializableMessage = {
    _id: 'p1',
    _creationTime: 0,
    senderRole: 'specifier',
    type: 'plan',
    content: '# Plan\n\n## Phases\n- P1 — One',
  };

  it('tags plan messages with type=plan in the linear header', () => {
    expect(serializeMessage(base, { profile: 'linear' })).toBe(
      `1970-01-01T00:00:00.000Z | specifier | type=plan\n\n${base.content}`
    );
  });

  it('tags before the sender snapshot when both are present', () => {
    expect(
      serializeMessage(
        { ...base, senderAgent: { harness: 'claude-sdk', model: 'm' } },
        { profile: 'linear' }
      ).split('\n')[0]
    ).toBe('1970-01-01T00:00:00.000Z | specifier | type=plan | harness=claude-sdk model=m');
  });

  it('leaves every other message type byte-identical', () => {
    for (const type of ['message', 'handoff', 'join', 'progress', 'new-context', 'notice']) {
      const message: SerializableMessage = { ...base, type };
      expect(serializeMessage(message, { profile: 'linear' })).toBe(
        `1970-01-01T00:00:00.000Z | specifier\n\n${base.content}`
      );
    }
  });

  it('does not tag plan content in the context-xml profile', () => {
    const xml = serializeMessage(base, {
      profile: 'context-xml',
      chatroomId: 'c',
      role: 'specifier',
    });
    expect(xml).toContain('type="plan"');
    expect(xml).not.toContain('| type=plan');
  });
});
