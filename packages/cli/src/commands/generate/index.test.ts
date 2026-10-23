/**
 * `chatroom generate-image` wiring tests.
 *
 * Failure paths are exercised against real commander wiring; successful parses
 * run against a mocked `generateImage` so nothing hits the network. The pure
 * generation behavior lives in image.test.ts.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    process.env.FAL_API_KEY = 'fal-key-sentinel-do-not-print';
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

  it.each(['gif', 'jpeg'])('rejects --output-format %s before running', async (format) => {
    const program = createProgram();

    await expect(
      parse(program, ['--prompt', 'x', '--out', '/tmp/x.png', '--output-format', format])
    ).rejects.toMatchObject({ code: 'commander.invalidArgument' });
    expect(generateImageMock).not.toHaveBeenCalled();
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

  it('forwards inline --input as an object', async () => {
    const program = createProgram();

    await parse(program, [
      '--prompt',
      'x',
      '--out',
      '/tmp/x.png',
      '--input',
      '{"image_size":{"width":1024,"height":768},"enable_prompt_expansion":false}',
    ]);

    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({
      input: {
        image_size: { width: 1024, height: 768 },
        enable_prompt_expansion: false,
      },
    });
  });

  it('reads --input @file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chatroom-input-'));
    try {
      const path = join(dir, 'input.json');
      await writeFile(path, '{"image_size":{"width":512,"height":512}}', 'utf8');
      const program = createProgram();

      await parse(program, ['--prompt', 'x', '--out', '/tmp/x.png', '--input', `@${path}`]);

      expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({
        input: { image_size: { width: 512, height: 512 } },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a directory for --input @file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chatroom-input-dir-'));
    try {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const program = createProgram();

      await parse(program, ['--prompt', 'x', '--out', '/tmp/x.png', '--input', `@${dir}`]);

      expect(process.exitCode).toBe(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('not a regular file');
      expect(generateImageMock).not.toHaveBeenCalled();
    } finally {
      await mkdir(dir, { recursive: true }).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses an oversize --input file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chatroom-input-big-'));
    try {
      const path = join(dir, 'input.json');
      await writeFile(path, 'x'.repeat(1024 * 1024 + 1), 'utf8');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const program = createProgram();

      await parse(program, ['--prompt', 'x', '--out', '/tmp/x.png', '--input', `@${path}`]);

      expect(process.exitCode).toBe(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('maximum is 1048576 bytes');
      expect(generateImageMock).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['invalid JSON', 'not-json'],
    ['an array', '[]'],
    ['a scalar', '"text"'],
  ])('refuses %s in --input before calling fal', async (_label, value) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const program = createProgram();

    await parse(program, ['--prompt', 'x', '--out', '/tmp/x.png', '--input', value]);

    expect(process.exitCode).toBe(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('--input');
    expect(generateImageMock).not.toHaveBeenCalled();
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
      '--input',
      '--force',
    ]) {
      expect(help).toContain(flag);
    }
    // Model defaults differ, so these must not be forced by the CLI.
    expect(help).not.toContain('(default: "auto")');
    expect(help).not.toContain('(default: "png")');
    expect(help).toContain('--input <json|@file>');

    let afterHelp = '';
    command?.configureOutput({
      writeOut: (text) => {
        afterHelp += text;
      },
    });
    command?.outputHelp();
    expect(afterHelp).toContain('fal-ai/moss-image');
    expect(afterHelp).toContain('enable_prompt_expansion');
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
