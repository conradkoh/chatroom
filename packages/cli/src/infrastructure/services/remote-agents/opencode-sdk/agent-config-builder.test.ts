import { describe, expect, it } from 'vitest';

import { buildChatroomAgentDescriptor } from './agent-config-builder.js';

describe('buildChatroomAgentDescriptor', () => {
  it('happy path', () => {
    const result = buildChatroomAgentDescriptor({
      role: 'builder',
      systemPrompt: 'You are X',
    });
    expect(result).toEqual({
      name: 'chatroom-builder',
      config: {
        prompt: 'You are X',
        mode: 'primary',
        description: 'Chatroom-injected agent for role: builder',
      },
    });
  });

  it('role with mixed case + special chars', () => {
    const result = buildChatroomAgentDescriptor({
      role: 'Lead Reviewer/2',
      systemPrompt: 'Be thorough',
    });
    expect(result.name).toBe('chatroom-lead-reviewer-2');
    expect(result.config.mode).toBe('primary');
  });

  it('role with consecutive special chars', () => {
    const result = buildChatroomAgentDescriptor({
      role: 'foo!!bar',
      systemPrompt: 'Test',
    });
    expect(result.name).toBe('chatroom-foo--bar');
  });

  it('throws on empty role', () => {
    expect(() => buildChatroomAgentDescriptor({ role: '', systemPrompt: 'Test' })).toThrow(
      'role is required to build a chatroom agent'
    );
  });

  it('throws on whitespace-only role', () => {
    expect(() => buildChatroomAgentDescriptor({ role: '   ', systemPrompt: 'Test' })).toThrow(
      'role is required to build a chatroom agent'
    );
  });

  it('empty systemPrompt', () => {
    const result = buildChatroomAgentDescriptor({
      role: 'x',
      systemPrompt: '',
    });
    expect(result.config.prompt).toBe('');
    expect(result.config.description).toContain('no system prompt provided');
  });

  it('determinism', () => {
    const input = { role: 'builder', systemPrompt: 'You are X' };
    const first = buildChatroomAgentDescriptor(input);
    const second = buildChatroomAgentDescriptor(input);
    expect(first).toEqual(second);
  });
});
