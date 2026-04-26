import { describe, it, expect } from 'vitest';
import { selectBuiltInAgent } from './select-builtin-agent';

describe('selectBuiltInAgent', () => {
  it('maps planner to plan', () => {
    expect(selectBuiltInAgent('planner')).toBe('plan');
  });

  it('maps PLANNER to plan (case-insensitive)', () => {
    expect(selectBuiltInAgent('PLANNER')).toBe('plan');
  });

  it('maps trimmed planner to plan', () => {
    expect(selectBuiltInAgent('  planner  ')).toBe('plan');
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
