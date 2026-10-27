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
import { FLUX_2_FLASH_EDIT_MODEL, FLUX_2_FLASH_MODEL } from './model-capabilities.js';

const { generateImageMock, planGenerateImageMock, formatGenerateImagePlanMock } = vi.hoisted(
  () => ({
    generateImageMock: vi.fn(),
    planGenerateImageMock: vi.fn(),
    formatGenerateImagePlanMock: vi.fn(),
  })
);

vi.mock('./image.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ImageModule>();
  return {
    ...actual,
    generateImage: generateImageMock,
    planGenerateImage: planGenerateImageMock,
    formatGenerateImagePlan: formatGenerateImagePlanMock,
  };
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
      costLines: [],
    });
    planGenerateImageMock.mockReset();
    planGenerateImageMock.mockResolvedValue({ plan: true });
    formatGenerateImagePlanMock.mockReset();
    formatGenerateImagePlanMock.mockReturnValue('dry run plan');
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
    await parse(program, ['--model', FLUX_2_FLASH_MODEL, '--prompt', 'x', '--out', '/tmp/x.png']);

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

    await expect(
      parse(program, ['--model', FLUX_2_FLASH_MODEL, '--out', '/tmp/x.png'])
    ).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
    await expect(
      parse(program, ['--model', FLUX_2_FLASH_MODEL, '--prompt', 'x'])
    ).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
  });

  it('requires --model', async () => {
    const program = createProgram();

    await expect(parse(program, ['--prompt', 'x', '--out', '/tmp/x.png'])).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it.each(['gif', 'jpeg'])('rejects --output-format %s before running', async (format) => {
    const program = createProgram();

    await expect(
      parse(program, [
        '--model',
        FLUX_2_FLASH_MODEL,
        '--prompt',
        'x',
        '--out',
        '/tmp/x.png',
        '--output-format',
        format,
      ])
    ).rejects.toMatchObject({ code: 'commander.invalidArgument' });
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it('rejects a non-integer --seed before running', async () => {
    const program = createProgram();

    await expect(
      parse(program, [
        '--model',
        FLUX_2_FLASH_MODEL,
        '--prompt',
        'x',
        '--out',
        '/tmp/x.png',
        '--seed',
        '1.5',
      ])
    ).rejects.toMatchObject({ code: 'commander.invalidArgument' });
  });

  it('accepts --platform=fal and forwards it', async () => {
    const program = createProgram();

    await parse(program, [
      '--model',
      FLUX_2_FLASH_MODEL,
      '--prompt',
      'x',
      '--out',
      '/tmp/x.png',
      '--platform=fal',
    ]);

    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({ platform: 'fal' });
  });

  it('defaults --platform to fal', async () => {
    const program = createProgram();

    await parse(program, ['--model', FLUX_2_FLASH_MODEL, '--prompt', 'x', '--out', '/tmp/x.png']);

    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({ platform: 'fal' });
  });

  it('rejects an unsupported --platform before running', async () => {
    const program = createProgram();

    await expect(
      parse(program, [
        '--model',
        FLUX_2_FLASH_MODEL,
        '--prompt',
        'x',
        '--out',
        '/tmp/x.png',
        '--platform',
        'replicate',
      ])
    ).rejects.toMatchObject({
      code: 'commander.invalidArgument',
      message: expect.stringContaining('must be one of fal'),
    });
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it('does not forward aspect-ratio or output-format when omitted', async () => {
    const program = createProgram();

    await parse(program, ['--model', FLUX_2_FLASH_MODEL, '--prompt', 'x', '--out', '/tmp/x.png']);

    const forwarded = generateImageMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(forwarded.aspectRatio).toBeUndefined();
    expect(forwarded.outputFormat).toBeUndefined();
  });

  it('forwards aspect-ratio and output-format when provided', async () => {
    const program = createProgram();

    await parse(program, [
      '--model',
      FLUX_2_FLASH_MODEL,
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
      '--model',
      FLUX_2_FLASH_MODEL,
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

      await parse(program, [
        '--model',
        FLUX_2_FLASH_MODEL,
        '--prompt',
        'x',
        '--out',
        '/tmp/x.png',
        '--input',
        `@${path}`,
      ]);

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

      await parse(program, [
        '--model',
        FLUX_2_FLASH_MODEL,
        '--prompt',
        'x',
        '--out',
        '/tmp/x.png',
        '--input',
        `@${dir}`,
      ]);

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

      await parse(program, [
        '--model',
        FLUX_2_FLASH_MODEL,
        '--prompt',
        'x',
        '--out',
        '/tmp/x.png',
        '--input',
        `@${path}`,
      ]);

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

    await parse(program, [
      '--model',
      FLUX_2_FLASH_MODEL,
      '--prompt',
      'x',
      '--out',
      '/tmp/x.png',
      '--input',
      value,
    ]);

    expect(process.exitCode).toBe(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('--input');
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it('forwards --force when provided', async () => {
    const program = createProgram();

    await parse(program, [
      '--model',
      FLUX_2_FLASH_MODEL,
      '--prompt',
      'x',
      '--out',
      '/tmp/x.png',
      '--force',
    ]);

    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({ force: true });
  });

  it('does not forward --force when omitted', async () => {
    const program = createProgram();

    await parse(program, ['--model', FLUX_2_FLASH_MODEL, '--prompt', 'x', '--out', '/tmp/x.png']);

    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({ force: undefined });
  });

  it('forwards --input-image when provided', async () => {
    const program = createProgram();

    await parse(program, [
      '--model',
      FLUX_2_FLASH_MODEL,
      '--prompt',
      'x',
      '--out',
      '/tmp/x.png',
      '--input-image',
      './hero.png',
    ]);

    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({ inputImage: './hero.png' });
  });

  it('does not forward --input-image when omitted', async () => {
    const program = createProgram();

    await parse(program, ['--model', FLUX_2_FLASH_MODEL, '--prompt', 'x', '--out', '/tmp/x.png']);

    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({ inputImage: undefined });
  });

  it('forwards an explicit --model', async () => {
    const program = createProgram();

    await parse(program, ['--prompt', 'x', '--out', '/tmp/x.png', '--model', 'fal-ai/flux/dev']);

    expect(generateImageMock.mock.calls[0]?.[0]).toMatchObject({ model: 'fal-ai/flux/dev' });
  });

  it('runs --dry-run through the plan formatter without calling generateImage', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = createProgram();

    await parse(program, [
      '--model',
      FLUX_2_FLASH_MODEL,
      '--prompt',
      'x',
      '--out',
      '/tmp/x.png',
      '--dry-run',
    ]);

    expect(planGenerateImageMock).toHaveBeenCalledTimes(1);
    expect(formatGenerateImagePlanMock).toHaveBeenCalledWith({ plan: true });
    expect(logSpy).toHaveBeenCalledWith('dry run plan');
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(process.env.FAL_API_KEY).toBeUndefined();
  });

  it('prints the result cost estimate after the output paths', async () => {
    generateImageMock.mockResolvedValue({
      outPath: '/tmp/x.png',
      manifestPath: '/tmp/x.png.json',
      sha256: 'deadbeef',
      costLines: [
        'Estimated cost: $0.005000 per megapixel (live rate for this account) × 0.79 MP ≈ $0.003932',
        'fal returns no billed cost; check the fal dashboard for the actual bill.',
      ],
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = createProgram();

    await parse(program, ['--model', FLUX_2_FLASH_MODEL, '--prompt', 'x', '--out', '/tmp/x.png']);

    expect(logSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      'Generated /tmp/x.png',
      'Manifest /tmp/x.png.json',
      'Estimated cost: $0.005000 per megapixel (live rate for this account) × 0.79 MP ≈ $0.003932',
      'fal returns no billed cost; check the fal dashboard for the actual bill.',
    ]);
  });

  it('lists the flags and description in help output', () => {
    const program = createProgram();
    const command = program.commands[0];

    expect(command?.name()).toBe('generate-image');
    const help = command?.helpInformation() ?? '';
    expect(help).toContain('Generate one image with a fal model');
    const modelOption = command?.options.find((option) => option.long === '--model');
    expect(modelOption?.description).toContain('required');
    expect(modelOption?.description).toContain(FLUX_2_FLASH_MODEL);
    for (const flag of [
      '--prompt',
      '--out',
      '--platform',
      '--model',
      '--aspect-ratio',
      '--output-format',
      '--seed',
      '--input',
      '--input-image',
      '--force',
      '--dry-run',
    ]) {
      expect(help).toContain(flag);
    }
    const aspectOption = command?.options.find((option) => option.long === '--aspect-ratio');
    expect(aspectOption?.description).toContain('Rejected for models the CLI knows');
    const dryRunOption = command?.options.find((option) => option.long === '--dry-run');
    expect(dryRunOption?.description).toContain('estimated fal cost');
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
    expect(afterHelp).toContain('fal-ai/flux-2/flash');
    expect(afterHelp).toContain('pixel-art potion');
    expect(afterHelp).toContain('--input-image ./hero.png');
    expect(afterHelp).toContain(`--model ${FLUX_2_FLASH_EDIT_MODEL}`);
    expect(afterHelp).toContain('Cost lines are estimates');
    expect(afterHelp).toContain('fal returns no billed cost');
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
