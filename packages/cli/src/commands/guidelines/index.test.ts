/**
 * guidelines Unit Tests
 *
 * Tests the guidelines commands using injected dependencies.
 * Covers: auth test (exits 1), success test, error test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuidelinesDeps } from './deps.js';
import { viewGuidelines, listGuidelineTypes } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SESSION_ID = 'test-session-id';

function createMockDeps(overrides?: Partial<GuidelinesDeps>): GuidelinesDeps {
  return {
    backend: {
      mutation: vi.fn(),
      query: vi.fn().mockResolvedValue({
        title: 'Coding Guidelines',
        content: 'Guideline content here',
      }),
    },
    session: {
      getSessionId: vi.fn().mockReturnValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockReturnValue([]),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let exitSpy: any;
let logSpy: any;
let errorSpy: any;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getAllLogOutput(): string {
  return logSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

function getAllErrorOutput(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('viewGuidelines', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await viewGuidelines({ type: 'coding' }, deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Not authenticated');
    });
  });

  describe('success', () => {
    it('fetches and displays guidelines', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        title: 'Coding Guidelines',
        content: 'Guideline content here',
      });

      await viewGuidelines({ type: 'coding' }, deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(getAllLogOutput()).toContain('Coding Guidelines');
      expect(getAllLogOutput()).toContain('Guideline content here');
      expect(deps.backend.query).toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('exits with code 1 when invalid type', async () => {
      const deps = createMockDeps();

      await viewGuidelines({ type: 'invalid' }, deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Invalid guideline type');
    });

    it('exits with code 1 when query fails', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      await viewGuidelines({ type: 'coding' }, deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Error fetching guidelines');
      expect(getAllErrorOutput()).toContain('Network error');
    });
  });
});

describe('listGuidelineTypes', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await listGuidelineTypes(deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Not authenticated');
    });
  });

  describe('success', () => {
    it('fetches and displays guideline types', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        { type: 'coding', description: 'Code review guidelines' },
        { type: 'security', description: 'Security review guidelines' },
      ]);

      await listGuidelineTypes(deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(getAllLogOutput()).toContain('Available Guideline Types');
      expect(getAllLogOutput()).toContain('coding');
      expect(getAllLogOutput()).toContain('security');
      expect(deps.backend.query).toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('exits with code 1 when query fails', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Backend error')
      );

      await listGuidelineTypes(deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Error fetching guideline types');
      expect(getAllErrorOutput()).toContain('Backend error');
    });
  });
});
