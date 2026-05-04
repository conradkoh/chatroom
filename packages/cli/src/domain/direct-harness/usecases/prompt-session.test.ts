import { describe, it, expect, vi } from 'vitest';

import { promptSession } from './prompt-session.js';
import type { PromptSessionDeps, PromptSessionInput } from './prompt-session.js';
import type { DirectHarnessSession } from '../entities/direct-harness-session.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { PromptRepository, PromptOverride } from '../ports/prompt-repository.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockSession(): DirectHarnessSession {
  return {
    harnessSessionId: 'sess-1',
    sessionTitle: 'test',
    prompt: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
    _emit: vi.fn(),
  } as unknown as DirectHarnessSession;
}

type Func = ReturnType<typeof vi.fn>;

/** Creates a SessionRepository that passes the harness session ID check by default. */
function passingSessionRepository(overrides?: Partial<SessionRepository>): SessionRepository {
  return {
    createSession: vi.fn(),
    associateHarnessSessionId: vi.fn(),
    getHarnessSessionId: vi.fn().mockResolvedValue('sess-1'),
    markClosed: vi.fn(),
    ...overrides,
  } satisfies SessionRepository;
}

function mockDeps(overrides?: Partial<PromptSessionDeps>): PromptSessionDeps {
  return {
    sessionRepository: passingSessionRepository(),
    promptRepository: {
      getOverride: vi.fn(),
      complete: vi.fn(),
    } satisfies PromptRepository,
    session: mockSession(),
    ...overrides,
  };
}

const defaultInput: PromptSessionInput = {
  harnessSessionRowId: 'row-1',
  promptId: 'prompt-1',
  parts: [{ type: 'text', text: 'Hello' }],
};

function makeOverride(overrides?: Partial<PromptOverride>): PromptOverride {
  return {
    agent: 'builder',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('promptSession', () => {
  it('reads the override, prompts the session, and completes as done', async () => {
    const promptRepository = {
      getOverride: vi.fn().mockResolvedValue(makeOverride()),
      complete: vi.fn(),
    } satisfies PromptRepository;
    const session = mockSession();
    const deps = mockDeps({ promptRepository, session });

    await promptSession(deps, defaultInput);

    expect(promptRepository.getOverride).toHaveBeenCalledWith('prompt-1');
    expect(session.prompt).toHaveBeenCalledOnce();
    expect(session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'builder', parts: defaultInput.parts })
    );
    expect(promptRepository.complete).toHaveBeenCalledWith('prompt-1', 'done');
  });

  it('passes model, system, and tools from the override to session.prompt', async () => {
    const promptRepository = {
      getOverride: vi.fn().mockResolvedValue(
        makeOverride({
          model: { providerID: 'openai', modelID: 'gpt-4' },
          system: 'Be concise.',
          tools: { read_file: true, write_file: false },
        })
      ),
      complete: vi.fn(),
    } satisfies PromptRepository;
    const session = mockSession();
    const deps = mockDeps({ promptRepository, session });

    await promptSession(deps, defaultInput);

    expect(session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'builder',
        model: { providerID: 'openai', modelID: 'gpt-4' },
        system: 'Be concise.',
        tools: { read_file: true, write_file: false },
      })
    );
  });

  it('completes as error when harnessSessionId is not found', async () => {
    const sessionRepository = passingSessionRepository({
      getHarnessSessionId: vi.fn().mockResolvedValue(undefined),
    });
    const promptRepository = {
      getOverride: vi.fn(),
      complete: vi.fn(),
    } satisfies PromptRepository;
    const deps = mockDeps({ sessionRepository, promptRepository });

    await promptSession(deps, defaultInput);

    expect(promptRepository.complete).toHaveBeenCalledWith(
      'prompt-1',
      'error',
      expect.stringContaining('no associated harness session ID')
    );
    expect(deps.session.prompt).not.toHaveBeenCalled();
  });

  it('completes as error when no override is found', async () => {
    const promptRepository = {
      getOverride: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn(),
    } satisfies PromptRepository;
    const deps = mockDeps({ promptRepository });

    await promptSession(deps, defaultInput);

    expect(promptRepository.complete).toHaveBeenCalledWith(
      'prompt-1',
      'error',
      expect.stringContaining('No override found')
    );
    expect(deps.session.prompt).not.toHaveBeenCalled();
  });

  it('completes as error when override.agent is empty', async () => {
    const promptRepository = {
      getOverride: vi.fn().mockResolvedValue(makeOverride({ agent: '' })),
      complete: vi.fn(),
    } satisfies PromptRepository;
    const deps = mockDeps({ promptRepository });

    await promptSession(deps, defaultInput);

    expect(promptRepository.complete).toHaveBeenCalledWith(
      'prompt-1',
      'error',
      expect.stringContaining('override.agent is required')
    );
    expect(deps.session.prompt).not.toHaveBeenCalled();
  });

  it('completes as error when override.agent is whitespace', async () => {
    const promptRepository = {
      getOverride: vi.fn().mockResolvedValue(makeOverride({ agent: '  ' })),
      complete: vi.fn(),
    } satisfies PromptRepository;
    const deps = mockDeps({ promptRepository });

    await promptSession(deps, defaultInput);

    expect(promptRepository.complete).toHaveBeenCalledWith(
      'prompt-1',
      'error',
      expect.stringContaining('override.agent is required')
    );
  });

  it('completes as error and throws when session.prompt fails', async () => {
    const promptRepository = {
      getOverride: vi.fn().mockResolvedValue(makeOverride()),
      complete: vi.fn(),
    } satisfies PromptRepository;
    const session = mockSession();
    (session.prompt as Func).mockRejectedValue(new Error('harness failure'));
    const deps = mockDeps({ promptRepository, session });

    await expect(promptSession(deps, defaultInput)).rejects.toThrow('harness failure');

    expect(promptRepository.complete).toHaveBeenCalledWith('prompt-1', 'error', 'harness failure');
  });

  it('does not mask the original error when complete() also fails', async () => {
    const promptRepository = {
      getOverride: vi.fn().mockResolvedValue(makeOverride()),
      complete: vi.fn().mockRejectedValue(new Error('complete also fails')),
    } satisfies PromptRepository;
    const session = mockSession();
    (session.prompt as Func).mockRejectedValue(new Error('harness failure'));
    const deps = mockDeps({ promptRepository, session });

    await expect(promptSession(deps, defaultInput)).rejects.toThrow('harness failure');
  });

  it('queries the session repository for harness session ID', async () => {
    const sessionRepository = passingSessionRepository();
    const spy = vi.spyOn(sessionRepository, 'getHarnessSessionId');
    const promptRepository = {
      getOverride: vi.fn().mockResolvedValue(makeOverride()),
      complete: vi.fn(),
    } satisfies PromptRepository;
    const deps = mockDeps({ sessionRepository, promptRepository });

    await promptSession(deps, defaultInput);

    expect(spy).toHaveBeenCalledWith('row-1');
  });
});
