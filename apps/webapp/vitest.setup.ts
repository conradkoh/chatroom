import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom does not provide ResizeObserver (used by scroll coordinators / Radix).
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup();
});
