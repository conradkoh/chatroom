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

// jsdom does not provide matchMedia (used by useIsDesktop and other media-query hooks).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = Object.assign(
    (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
    { prototype: {} }
  );
}

// Cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup();
});
