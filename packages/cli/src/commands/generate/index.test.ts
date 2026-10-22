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
    delete process.env.FAL_API_KEY;
    vi.restoreAllMocks();
  });

  it('reports action failures on stderr with exitCode 1 and never prints FAL_API_KEY', async () => {
    const key = 'fal-key-sentinel-do-not-print';
    process.env.FAL_API_KEY = key;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    generateImageMock.mockRejectedValue(new Error('generation exploded'));

    const program = createProgram();
    await parse(program, ['--prompt', 'x', '--out', '/tmp/x.png']);

    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('generation exploded');
    expect(process.exitCode).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();

    const printed = [...errorSpy.mock.calls, ...logSpy.mock.calls]
      .flat()
      .map((value) => String(value));
    expect(printed.some((line) => line.includes(key))).toBe(false);
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

  it('lists the flags and description in help output', () => {
    const program = createProgram();
    const command = program.commands[0];

    expect(command?.name()).toBe('generate-image');
    const help = command?.helpInformation() ?? '';
    expect(help).toContain('Generate one image with a fal model');
    const modelOption = command?.options.find((option) => option.long === '--model');
    expect(modelOption?.description).toContain('Recommended');
    for (const flag of [
      '--prompt',
      '--out',
      '--platform',
      '--model',
      '--aspect-ratio',
      '--output-format',
      '--seed',
      '--force',
    ]) {
      expect(help).toContain(flag);
    }
    // Model defaults differ, so these must not be forced by the CLI.
    expect(help).not.toContain('(default: "auto")');
    expect(help).not.toContain('(default: "png")');
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
