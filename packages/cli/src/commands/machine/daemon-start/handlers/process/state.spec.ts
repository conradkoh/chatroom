import { describe, expect, it } from 'vitest';
import { deriveTerminalStatus } from './state.js';

describe('deriveTerminalStatus', () => {
  it('no intent + code=0 → completed', () => {
    expect(deriveTerminalStatus(0, null, null)).toBe('completed');
  });

  it('no intent + code=1 (non-zero) + no signal → failed', () => {
    expect(deriveTerminalStatus(1, null, null)).toBe('failed');
  });

  it('no intent + SIGTERM signal → stopped (external termination)', () => {
    expect(deriveTerminalStatus(null, 'SIGTERM', null)).toBe('stopped');
  });

  it('no intent + SIGKILL signal → stopped', () => {
    expect(deriveTerminalStatus(null, 'SIGKILL', null)).toBe('stopped');
  });

  it('intent=killed + SIGTERM → killed', () => {
    expect(deriveTerminalStatus(null, 'SIGTERM', 'killed')).toBe('killed');
  });

  it('intent=killed + SIGKILL → killed', () => {
    expect(deriveTerminalStatus(null, 'SIGKILL', 'killed')).toBe('killed');
  });

  it('intent=stopped + SIGTERM → stopped', () => {
    expect(deriveTerminalStatus(null, 'SIGTERM', 'stopped')).toBe('stopped');
  });

  it('intent=stopped + non-zero exit code → stopped', () => {
    expect(deriveTerminalStatus(1, null, 'stopped')).toBe('stopped');
  });

  it('intent=killed + code=0 → killed', () => {
    expect(deriveTerminalStatus(0, null, 'killed')).toBe('killed');
  });
});
