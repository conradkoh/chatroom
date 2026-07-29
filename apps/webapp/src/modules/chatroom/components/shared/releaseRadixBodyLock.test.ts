import { describe, expect, it, beforeEach } from 'vitest';
import { releaseRadixBodyLock } from './releaseRadixBodyLock';

describe('releaseRadixBodyLock', () => {
  beforeEach(() => {
    document.body.style.pointerEvents = 'none';
    document.body.style.overflow = 'hidden';
    document.body.setAttribute('data-scroll-locked', '');
  });

  it('clears pointer-events, overflow, and removes data-scroll-locked', () => {
    releaseRadixBodyLock();
    expect(document.body.style.pointerEvents).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.body.getAttribute('data-scroll-locked')).toBeNull();
  });

  it('is safe when called multiple times', () => {
    releaseRadixBodyLock();
    releaseRadixBodyLock();
    expect(document.body.style.pointerEvents).toBe('');
  });
});
