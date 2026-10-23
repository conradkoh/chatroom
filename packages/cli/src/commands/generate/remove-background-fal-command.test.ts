/**
 * `chatroom remove-image-background-fal` wiring tests.
 *
 * Failure paths use real commander wiring; successful parses use a mocked
 * orchestrator so nothing touches the filesystem or the fal SDK.
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerRemoveImageBackgroundFalCommand } from './remove-background-fal-command.js';
import type * as RemoveModule from './remove-background-fal.js';

vi.mock('@fal-ai/client', () => {
  throw new Error('must not load fal');
});

const { removeMock } = vi.hoisted(() => ({ removeMock: vi.fn() }));

vi.mock('./remove-background-fal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RemoveModule>();
  return { ...actual, removeBackgroundFal: removeMock };
});

vi.mock('./remove-background-fal-deps.js', () => ({
  createDefaultRemoveBackgroundFalDeps: () => ({}),
}));

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerRemoveImageBackgroundFalCommand(program);
  return program;
}

async function parse(program: Command, args: string[]): Promise<unknown> {
  return program.parseAsync(['node', 'chatroom', 'remove-image-background-fal', ...args]);
}

describe('chatroom remove-image-background-fal wiring', () => {
  beforeEach(() => {
    removeMock.mockReset();
    removeMock.mockResolvedValue({
      outPath: '/assets/potion.png',
      manifestPath: '/assets/potion.png.json',
      requestId: 'req-1',
      bytes: 512,
      sha256: 'deadbeef',
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    delete process.env.FAL_API_KEY;
    vi.restoreAllMocks();
  });

  it.each([
    [[], 'no options'],
    [['--in', '/tiles/a.png'], 'only --in'],
    [['--out', '/assets/a.png'], 'only --out'],
  ])('requires --in and --out (%s)', async (args) => {
    const program = createProgram();

    await expect(parse(program, args)).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('maps --in, --out, and --force to the orchestrator', async () => {
    const program = createProgram();

    await parse(program, ['--in', '/tiles/a.png', '--out', '/assets/a.png', '--force']);

    expect(removeMock.mock.calls[0]?.[0]).toEqual({
      in: '/tiles/a.png',
      out: '/assets/a.png',
      force: true,
    });
  });

  it('prints the output, manifest, and request id', async () => {
    const program = createProgram();

    await parse(program, ['--in', '/tiles/a.png', '--out', '/assets/a.png']);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(output).toContain('Removed background /assets/potion.png (512 bytes)');
    expect(output).toContain('Manifest /assets/potion.png.json');
    expect(output).toContain('Request req-1');
  });

  it('reports failures on stderr, sets exitCode 1, and prints nothing to stdout', async () => {
    const key = 'fal-key-sentinel-do-not-print';
    process.env.FAL_API_KEY = key;
    removeMock.mockRejectedValue(new Error('FAL_API_KEY is not set'));
    const program = createProgram();

    await parse(program, ['--in', '/tiles/a.png', '--out', '/assets/a.png']);

    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toBe('❌ FAL_API_KEY is not set');
    expect(process.exitCode).toBe(1);
    expect(console.log).not.toHaveBeenCalled();

    const printed = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      .flat()
      .map((value) => String(value));
    expect(printed.some((line) => line.includes(key))).toBe(false);
  });

  it('documents the model, refusals, limits, and examples in help', () => {
    const program = createProgram();
    const command = program.commands[0];
    let help = '';
    command?.configureOutput({
      writeOut: (text) => {
        help += text;
      },
    });
    command?.outputHelp();

    expect(help).toContain('chatroom remove-image-background-fal --in <png> --out <png> [--force]');
    expect(help).toContain('fal-ai/birefnet/v2');
    expect(help).toContain('Matting');
    expect(help).toContain('chatroom remove-image-background');
    expect(help).toContain('8 MiB');
    expect(help).toContain('32 MiB');
    expect(help).toContain('billed to your fal account');
    expect(help).toContain(
      'remove-image-background-fal --in tiles/potion.png --out assets/potion.png'
    );
  });
});
