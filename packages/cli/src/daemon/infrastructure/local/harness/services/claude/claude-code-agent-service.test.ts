import { EventEmitter, Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  ClaudeCodeAgentService,
  type ClaudeCodeAgentServiceDeps,
} from './claude-code-agent-service.js';
import type { HarnessActivitySignal } from '../../../../agent-process-manager/harness-activity-emitter.js';
import { extractBashCommandFromToolInput } from '../agent-log-format.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

function createMockDeps(
  overrides?: Partial<ClaudeCodeAgentServiceDeps>
): ClaudeCodeAgentServiceDeps {
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
    stdin: null,
    stdout: mockStdout,
    stderr: mockStderr,
    pid,
    killed: false,
    exitCode: null,
  });
  return { child, mockStdout, mockStderr };
}

describe('extractBashCommandFromToolInput (Claude)', () => {
  it('extracts command from Bash tool_use', () => {
    expect(extractBashCommandFromToolInput('Bash', { command: 'ls -la' })).toBe('ls -la');
  });

  it('extracts command from shell tool_use (case-insensitive)', () => {
    expect(extractBashCommandFromToolInput('shell', { command: 'git status' })).toBe('git status');
  });

  it('returns null for non-bash tools', () => {
    expect(extractBashCommandFromToolInput('Read', { file: 'x' })).toBeNull();
  });

  it('returns null when Bash input has no command', () => {
    expect(extractBashCommandFromToolInput('Bash', null)).toBeNull();
  });
});

describe('ClaudeCodeAgentService typed activity', () => {
  it('returns activityEmitter and emits transport plus progress for assistant events', async () => {
    const { child, mockStdout } = makeChildWithStdout();
    const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
    const service = new ClaudeCodeAgentService(deps);

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

    mockStdout.push(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'secret hello' }] },
      }) + '\n'
    );
    mockStdout.push(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'thinking', thinking: 'secret plan' }] },
      }) + '\n'
    );
    mockStdout.push(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'secret-cmd' } }],
        },
      }) + '\n'
    );

    await vi.waitFor(() =>
      expect(signals.some((s) => s.source === 'claude-cli.assistant.text')).toBe(true)
    );

    expect(signals.some((s) => s.kind === 'transport' && s.source === 'claude-cli.message')).toBe(
      true
    );
    expect(signals.some((s) => s.source === 'claude-cli.assistant.thinking')).toBe(true);
    expect(signals.some((s) => s.source === 'claude-cli.tool-use' && s.kind === 'progress')).toBe(
      true
    );
    expect(signals.some((s) => s.source === 'claude-cli.tool-use' && s.kind === 'waiting')).toBe(
      true
    );
    expect(onOutput).toHaveBeenCalled();
    for (const signal of signals) {
      expect(signal.source).not.toContain('secret');
      expect(signal.source).not.toContain('Bash');
    }
  });

  it('emits failure for result events with is_error', async () => {
    const { child, mockStdout } = makeChildWithStdout(43);
    const deps = createMockDeps({ spawn: vi.fn().mockReturnValue(child) });
    const service = new ClaudeCodeAgentService(deps);

    const result = await service.spawn({
      workingDir: '/tmp/work',
      prompt: createSpawnPrompt('do work'),
      systemPrompt: 'you are helpful',
      context: { machineId: 'm1', chatroomId: 'c1', role: 'builder' },
      resolvedConvexUrl: 'http://test:3210',
    });

    const signals: HarnessActivitySignal[] = [];
    result.activityEmitter!.onActivity((signal) => signals.push(signal));

    mockStdout.push(
      JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'secret fail' }) +
        '\n'
    );

    await vi.waitFor(() =>
      expect(signals.some((s) => s.kind === 'failure' && s.source === 'claude-cli.message')).toBe(
        true
      )
    );
    for (const signal of signals) {
      expect(signal.source).not.toContain('secret');
    }
  });
});
