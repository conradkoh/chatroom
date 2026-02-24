/**
 * artifact Unit Tests
 *
 * Tests the artifact command using injected dependencies.
 * Covers: auth validation, successful artifact create, error handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArtifactDeps } from './deps.js';
import { createArtifact, viewArtifact, viewManyArtifacts } from './index.js';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock('../../utils/file-content.js', () => ({
  readFileContent: vi.fn().mockReturnValue('# Test content\n\nSome markdown.'),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';
const TEST_ARTIFACT_ID = 'artifact_abc123_test_artifact_1';

function createMockDeps(overrides?: Partial<ArtifactDeps>): ArtifactDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(TEST_ARTIFACT_ID),
      query: vi.fn().mockResolvedValue({
        _id: TEST_ARTIFACT_ID,
        filename: 'test.md',
        version: 1,
        createdBy: 'user_123',
        createdAt: Date.now(),
        content: '# Test content',
        description: null,
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

describe('createArtifact', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await createArtifact(
        TEST_CHATROOM_ID,
        { role: 'builder', fromFile: 'test.md', filename: 'test.md' },
        deps
      );

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Not authenticated');
    });
  });

  describe('successful create', () => {
    it('calls artifacts.create mutation and logs success', async () => {
      const deps = createMockDeps();

      const result = await createArtifact(
        TEST_CHATROOM_ID,
        { role: 'builder', fromFile: 'test.md', filename: 'test.md' },
        deps
      );

      expect(exitSpy).not.toHaveBeenCalled();
      expect(deps.backend.mutation).toHaveBeenCalledTimes(1);
      expect(result).toBe(TEST_ARTIFACT_ID);

      const output = getAllLogOutput();
      expect(output).toContain('Artifact created successfully');
      expect(output).toContain(`Artifact ID: ${TEST_ARTIFACT_ID}`);
    });
  });

  describe('mutation failure', () => {
    it('exits with code 1 when create mutation throws', async () => {
      const deps = createMockDeps();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network timeout')
      );

      await createArtifact(
        TEST_CHATROOM_ID,
        { role: 'builder', fromFile: 'test.md', filename: 'test.md' },
        deps
      );

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Failed to create artifact');
      expect(getAllErrorOutput()).toContain('Network timeout');
    });
  });
});

describe('viewArtifact', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await viewArtifact(TEST_CHATROOM_ID, { role: 'builder', artifactId: TEST_ARTIFACT_ID }, deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Not authenticated');
    });
  });

  describe('successful view', () => {
    it('calls artifacts.get query and displays artifact', async () => {
      const deps = createMockDeps();

      await viewArtifact(TEST_CHATROOM_ID, { role: 'builder', artifactId: TEST_ARTIFACT_ID }, deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(deps.backend.query).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('Artifact: test.md');
      expect(output).toContain(`ID: ${TEST_ARTIFACT_ID}`);
    });
  });

  describe('query failure', () => {
    it('exits with code 1 when get query throws', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Backend unavailable')
      );

      await viewArtifact(TEST_CHATROOM_ID, { role: 'builder', artifactId: TEST_ARTIFACT_ID }, deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Failed to view artifact');
      expect(getAllErrorOutput()).toContain('Backend unavailable');
    });
  });
});

describe('viewManyArtifacts', () => {
  describe('authentication', () => {
    it('exits with code 1 when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          getSessionId: vi.fn().mockReturnValue(null),
          getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
          getOtherSessionUrls: vi.fn().mockReturnValue([]),
        },
      });

      await viewManyArtifacts(
        TEST_CHATROOM_ID,
        { role: 'builder', artifactIds: [TEST_ARTIFACT_ID] },
        deps
      );

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Not authenticated');
    });
  });

  describe('successful view many', () => {
    it('calls artifacts.getMany query and displays artifacts', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          _id: TEST_ARTIFACT_ID,
          filename: 'test.md',
          version: 1,
          createdBy: 'user_123',
          createdAt: Date.now(),
          content: '# Test',
          description: null,
        },
      ]);

      await viewManyArtifacts(
        TEST_CHATROOM_ID,
        { role: 'builder', artifactIds: [TEST_ARTIFACT_ID] },
        deps
      );

      expect(exitSpy).not.toHaveBeenCalled();
      expect(deps.backend.query).toHaveBeenCalledTimes(1);

      const output = getAllLogOutput();
      expect(output).toContain('Artifact 1: test.md');
    });
  });

  describe('query failure', () => {
    it('exits with code 1 when getMany query throws', async () => {
      const deps = createMockDeps();
      (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Database error')
      );

      await viewManyArtifacts(
        TEST_CHATROOM_ID,
        { role: 'builder', artifactIds: [TEST_ARTIFACT_ID] },
        deps
      );

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Failed to view artifacts');
      expect(getAllErrorOutput()).toContain('Database error');
    });
  });
});
