import { describe, expect, it } from 'vitest';

import { parseSeverityBullet } from './handoffSeverity';

describe('parseSeverityBullet', () => {
  it('parses high severity prefix', () => {
    const result = parseSeverityBullet('- [high] Critical auth gap');
    expect(result.severity).toBe('high');
    expect(result.text).toBe('Critical auth gap');
  });

  it('parses medium severity prefix', () => {
    const result = parseSeverityBullet('- [medium] Pick caching strategy');
    expect(result.severity).toBe('medium');
    expect(result.text).toBe('Pick caching strategy');
  });

  it('parses low severity prefix', () => {
    const result = parseSeverityBullet('- [low] Typo in comment');
    expect(result.severity).toBe('low');
    expect(result.text).toBe('Typo in comment');
  });

  it('is case-insensitive', () => {
    const result = parseSeverityBullet('- [HIGH] Critical issue');
    expect(result.severity).toBe('high');
    expect(result.text).toBe('Critical issue');
  });

  it('returns null severity for unprefixed bullet', () => {
    const result = parseSeverityBullet('- Normal bullet without prefix');
    expect(result.severity).toBeNull();
    expect(result.text).toBe('- Normal bullet without prefix');
  });

  it('trims whitespace around prefix', () => {
    const result = parseSeverityBullet('  - [low]   Some cleanup  ');
    expect(result.severity).toBe('low');
    expect(result.text).toBe('Some cleanup');
  });
});
