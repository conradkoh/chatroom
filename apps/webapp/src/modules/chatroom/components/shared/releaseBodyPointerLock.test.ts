import { describe, expect, it, beforeEach } from 'vitest';

import { releaseBodyPointerLock } from './releaseBodyPointerLock';

describe('releaseBodyPointerLock', () => {
  beforeEach(() => {
    document.body.style.pointerEvents = 'none';
    document.body.style.overflow = 'hidden';
    document.body.setAttribute('data-scroll-locked', '');
  });

  it('clears pointer-events, overflow, and removes data-scroll-locked', () => {
    releaseBodyPointerLock();
    expect(document.body.style.pointerEvents).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.body.getAttribute('data-scroll-locked')).toBeNull();
  });

  it('is safe when called multiple times', () => {
    releaseBodyPointerLock();
    releaseBodyPointerLock();
    expect(document.body.style.pointerEvents).toBe('');
  });
});
