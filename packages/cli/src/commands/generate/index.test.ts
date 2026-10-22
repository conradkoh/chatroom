/**
 * `chatroom generate-image` wiring tests.
 *
 * Failure paths are exercised against real commander wiring; successful parses
 * run against a mocked `generateImage` so nothing hits the network. The pure
 * generation behavior lives in image.test.ts.
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ImageModule from './image.js';
import { registerGenerateImageCommand } from './index.js';

const { generateImageMock } = vi.hoisted(() => ({ generateImageMock: vi.fn() }));

vi.mock('./image.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ImageModule>();
  return { ...actual, generateImage: generateImageMock };
});

vi.mock('./deps.js', () => ({
  createDefaultGenerateImageDeps: () => ({}),
}));

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerGenerateImageCommand(program);
  return program;
}

async function parse(program: Command, args: string[]): Promise<unknown> {
  return program.parseAsync(['node', 'chatroom', 'generate-image', ...args]);
}

describe('chatroom generate-image wiring', () => {
  beforeEach(() => {
    generateImageMock.mockReset();
    generateImageMock.mockResolvedValue({
      outPath: '/tmp/x.png',
      manifestPath: '/tmp/x.png.json',
      sha256: 'deadbeef',
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('requires --prompt and --out', async () => {
    const program = createProgram();

    await expect(parse(program, ['--out', '/tmp/x.png'])).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
    await expect(parse(program, ['--prompt', 'x'])).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
  });

  it('rejects an unknown --output-format before running', async () => {
    const program = createProgram();

    await expect(
      parse(program, ['--prompt', 'x', '--out', '/tmp/x.png', '--output-format', 'gif'])
    ).rejects.toMatchObject({ code: 'commander.invalidArgument' });
  });

  it('rejects a non-integer --seed before running', async () => {
    const program = createProgram();

    await expect(
      parse(program, ['--prompt', 'x', '--out', '/tmp/x.png', '--seed', '1.5'])
    ).rejects.toMatchObject({ code: 'commander.invalidArgument' });
  });

  it('accepts --platform=fal and forwards it', async () => {
    const program = createProgram();

    await parse(program, ['--prompt', 'x', '--out', '/tmp/x.png', '--platform=fal']);

    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({ platform: 'fal' });
  });

  it('defaults --platform to fal', async () => {
    const program = createProgram();

    await parse(program, ['--prompt', 'x', '--out', '/tmp/x.png']);

    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({ platform: 'fal' });
  });

  it('rejects an unsupported --platform before running', async () => {
    const program = createProgram();

    await expect(
      parse(program, ['--prompt', 'x', '--out', '/tmp/x.png', '--platform', 'replicate'])
    ).rejects.toMatchObject({
      code: 'commander.invalidArgument',
      message: expect.stringContaining('must be one of fal'),
    });
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it('does not forward aspect-ratio or output-format when omitted', async () => {
    const program = createProgram();

    await parse(program, ['--prompt', 'x', '--out', '/tmp/x.png']);

    const forwarded = generateImageMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(forwarded.aspectRatio).toBeUndefined();
    expect(forwarded.outputFormat).toBeUndefined();
  });

  it('forwards aspect-ratio and output-format when provided', async () => {
    const program = createProgram();

    await parse(program, [
      '--prompt',
      'x',
      '--out',
      '/tmp/x.png',
      '--aspect-ratio',
      '1:1',
      '--output-format',
      'webp',
    ]);

    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({
      aspectRatio: '1:1',
      outputFormat: 'webp',
    });
  });

  it('forwards --force when provided', async () => {
    const program = createProgram();

    await parse(program, ['--prompt', 'x', '--out', '/tmp/x.png', '--force']);

    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({ force: true });
  });

  it('does not forward --force when omitted', async () => {
    const program = createProgram();

    await parse(program, ['--prompt', 'x', '--out', '/tmp/x.png']);

    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({ force: undefined });
  });

  it('documents the flags in help output', () => {
    const program = createProgram();
    const command = program.commands[0];

    expect(command?.name()).toBe('generate-image');
    const flags = command?.options.map((option) => option.long) ?? [];
    expect(flags).toEqual([
      '--prompt',
      '--out',
      '--platform',
      '--model',
      '--aspect-ratio',
      '--output-format',
      '--seed',
      '--force',
    ]);
  });

  it('does not expose the old `generate image` group form', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync([
        'node',
        'chatroom',
        'generate',
        'image',
        '--prompt',
        'x',
        '--out',
        '/tmp/x.png',
      ])
    ).rejects.toMatchObject({ code: 'commander.unknownCommand' });
  });
});
