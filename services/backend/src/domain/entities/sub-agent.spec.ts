/**
 * Sub-agent entity — unit tests
 *
 * Validates the multi-shape pattern applied to sub-agent domain types:
 * source tuple, type, role builder/parser, and codemap path builder.
 */

import { describe, expect, it } from 'vitest';

import {
  buildCodemapPath,
  buildSubAgentRole,
  isSubAgentRole,
  parseSubAgentRole,
} from './sub-agent';

// ─── buildSubAgentRole ───────────────────────────────────────────────────────

describe('buildSubAgentRole', () => {
  it('builds correct role for codemapper', () => {
    expect(buildSubAgentRole('codemapper', 'abc123')).toBe('subagent:codemapper:abc123');
  });

  it('preserves instanceId exactly', () => {
    expect(buildSubAgentRole('codemapper', 'instance-with_123')).toBe(
      'subagent:codemapper:instance-with_123'
    );
  });
});

// ─── parseSubAgentRole ───────────────────────────────────────────────────────

describe('parseSubAgentRole', () => {
  it('parses valid codemapper role', () => {
    const result = parseSubAgentRole('subagent:codemapper:abc123');
    expect(result).toEqual({ type: 'codemapper', instanceId: 'abc123' });
  });

  it('is case-insensitive for type', () => {
    const result = parseSubAgentRole('subagent:CODEMAPPER:abc123');
    expect(result).toEqual({ type: 'codemapper', instanceId: 'abc123' });
  });

  it('returns null for non-sub-agent role', () => {
    expect(parseSubAgentRole('planner')).toBeNull();
  });

  it('returns null for malformed sub-agent role', () => {
    expect(parseSubAgentRole('subagent:codemapper')).toBeNull();
    expect(parseSubAgentRole('subagent:')).toBeNull();
    expect(parseSubAgentRole('invalid:format:too:many:cols')).toBeNull();
  });

  it('returns null for unknown sub-agent type', () => {
    expect(parseSubAgentRole('subagent:unknowntype:abc')).toBeNull();
  });
});

// ─── isSubAgentRole ──────────────────────────────────────────────────────────

describe('isSubAgentRole', () => {
  it('returns true for valid sub-agent roles', () => {
    expect(isSubAgentRole('subagent:codemapper:abc123')).toBe(true);
  });

  it('returns false for non-sub-agent roles', () => {
    expect(isSubAgentRole('planner')).toBe(false);
    expect(isSubAgentRole('user')).toBe(false);
  });
});

// ─── buildCodemapPath ────────────────────────────────────────────────────────

describe('buildCodemapPath', () => {
  it('builds correct path with date prefix', () => {
    const result = buildCodemapPath('2026-06-15', 'agent-panel');
    expect(result).toBe('.chatroom/codemaps/2026-06-15-agent-panel.md');
  });

  it('slugifies name correctly', () => {
    const result = buildCodemapPath('2026-06-15', 'Agent Panel v2.0!');
    expect(result).toBe('.chatroom/codemaps/2026-06-15-agent-panel-v2-0.md');
  });

  it('trims leading/trailing dashes from slug', () => {
    const result = buildCodemapPath('2026-06-15', '-leading-trail-');
    expect(result).toBe('.chatroom/codemaps/2026-06-15-leading-trail.md');
  });

  it('replaces multiple special chars with single dash', () => {
    const result = buildCodemapPath('2026-06-15', 'a---b!!c');
    expect(result).toBe('.chatroom/codemaps/2026-06-15-a-b-c.md');
  });
});
