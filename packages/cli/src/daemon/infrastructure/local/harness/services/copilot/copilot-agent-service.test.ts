import { EventEmitter, Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { CopilotAgentService, type CopilotAgentServiceDeps } from './copilot-agent-service.js';
import type { HarnessActivitySignal } from '../../../../agent-process-manager/harness-activity-emitter.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

function createMockDeps(overrides?: Partial<CopilotAgentServiceDeps>): CopilotAgentServiceDeps {
  return {
    execSync: vi.fn(),
    spawn: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  };
}

function makeChildWithStdout(pid = 42) {
  const mockStdout = new Readable({ read() {} });
  const mockStderr = new Readable({ read() {} });
  const child = Object.assign(new EventEmitter(), {
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: mockStdout,
    stderr: mockStderr,
    pid,
    killed: false,
    exitCode: null,
  });
  return { child, mockStdout, mockStderr };
}

describe('CopilotAgentService', () => {
  describe('typed activity', () => {
    it('returns activityEmitter with transport and progress for response lines', async () => {
      const { child, mockStdout } = makeChildWithStdout();
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CopilotAgentService(deps);

      const onOutput = vi.fn();
      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: { machineId: 'm1', chatroomId: 'c1', role: 'builder' },
        resolvedConvexUrl: 'http://test:3210',
      });

      expect(result.activityEmitter).toBeDefined();
      const signals: HarnessActivitySignal[] = [];
      result.activityEmitter!.onActivity((signal) => signals.push(signal));
      result.onOutput(onOutput);

      mockStdout.push('secret response line\n');

      await vi.waitFor(() =>
        expect(signals.some((s) => s.source === 'copilot-cli.assistant.text')).toBe(true)
      );

      expect(
        signals.some((s) => s.kind === 'transport' && s.source === 'copilot-cli.message')
      ).toBe(true);
      expect(onOutput).toHaveBeenCalled();
      for (const signal of signals) {
        expect(signal.source).not.toContain('secret');
      }
    });

    it('treats Done. as transport-only without progress or failure', async () => {
      const { child, mockStdout } = makeChildWithStdout(43);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CopilotAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: { machineId: 'm1', chatroomId: 'c1', role: 'builder' },
        resolvedConvexUrl: 'http://test:3210',
      });

      const signals: HarnessActivitySignal[] = [];
      result.activityEmitter!.onActivity((signal) => signals.push(signal));

      mockStdout.push('Done.\n');

      await vi.waitFor(() =>
        expect(signals.some((s) => s.source === 'copilot-cli.message')).toBe(true)
      );

      expect(signals.some((s) => s.source === 'copilot-cli.assistant.text')).toBe(false);
      expect(signals.some((s) => s.kind === 'failure')).toBe(false);
    });

    it('keeps metadata lines transport-only', async () => {
      const { child, mockStdout } = makeChildWithStdout(44);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CopilotAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: { machineId: 'm1', chatroomId: 'c1', role: 'builder' },
        resolvedConvexUrl: 'http://test:3210',
      });

      const signals: HarnessActivitySignal[] = [];
      result.activityEmitter!.onActivity((signal) => signals.push(signal));

      mockStdout.push('Total usage est: secret tokens\n');

      await vi.waitFor(() =>
        expect(signals.some((s) => s.source === 'copilot-cli.message')).toBe(true)
      );

      expect(signals.some((s) => s.source === 'copilot-cli.assistant.text')).toBe(false);
      for (const signal of signals) {
        expect(signal.source).not.toContain('secret');
      }
    });

    it('emits failure for non-zero process exit', async () => {
      const { child } = makeChildWithStdout(45);
      const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
      const service = new CopilotAgentService(deps);

      const result = await service.spawn({
        workingDir: '/tmp/work',
        prompt: createSpawnPrompt('do work'),
        systemPrompt: 'you are helpful',
        context: { machineId: 'm1', chatroomId: 'c1', role: 'builder' },
        resolvedConvexUrl: 'http://test:3210',
      });

      const signals: HarnessActivitySignal[] = [];
      result.activityEmitter!.onActivity((signal) => signals.push(signal));

      const onExit = vi.fn();
      result.onExit(onExit);
      child.emit('exit', 1, null);

      await vi.waitFor(() =>
        expect(
          signals.some((s) => s.kind === 'failure' && s.source === 'copilot-cli.process')
        ).toBe(true)
      );
      expect(onExit).toHaveBeenCalledTimes(1);
    });
  });
});
