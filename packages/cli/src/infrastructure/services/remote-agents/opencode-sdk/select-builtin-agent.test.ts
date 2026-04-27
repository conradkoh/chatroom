import { describe, it, expect } from 'vitest';
import { selectBuiltInAgent } from './select-builtin-agent';

describe('selectBuiltInAgent', () => {
  it('maps planner to planner', () => {
    expect(selectBuiltInAgent('planner')).toBe('planner');
  });

  it('maps PLANNER to planner (case-insensitive)', () => {
    expect(selectBuiltInAgent('PLANNER')).toBe('planner');
  });

  it('maps trimmed planner to planner', () => {
    expect(selectBuiltInAgent('  planner  ')).toBe('planner');
  });

  it('maps builder to build', () => {
    expect(selectBuiltInAgent('builder')).toBe('build');
  });

  it('maps reviewer to build', () => {
    expect(selectBuiltInAgent('reviewer')).toBe('build');
  });

  it('maps empty string to build', () => {
    expect(selectBuiltInAgent('')).toBe('build');
  });

  it('maps unknown-role to build', () => {
    expect(selectBuiltInAgent('unknown-role')).toBe('build');
  });
});
