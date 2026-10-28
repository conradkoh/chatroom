/**
 * `chatroom generate-3d` wiring tests.
 *
 * Failure paths run against real commander wiring; successful parses run
 * against a mocked `generate3d` so nothing hits the network. The inherited
 * command is asserted not to exist: `generate-3d` is a leaf command.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Generate3dModule from './generate-3d.js';
import { registerGenerate3dCommand } from './index.js';
import { GENERATE_3D_MODELS } from './model-registry.js';

const { generate3dMock, planGenerate3dMock, formatGenerate3dPlanMock, depsMock, falSubscribeMock } =
  vi.hoisted(() => {
    const falSubscribe = vi.fn();
    return {
      generate3dMock: vi.fn(),
      planGenerate3dMock: vi.fn(),
      formatGenerate3dPlanMock: vi.fn(),
      falSubscribeMock: falSubscribe,
      depsMock: {
        env: {},
        falSubscribe,
        fetchGlb: vi.fn(),
        uploadFile: vi.fn(),
        writeFile: vi.fn(),
        removeFile: vi.fn(),
        writeJson: vi.fn(),
        pathStatus: vi.fn(),
        ensureParentDir: vi.fn(),
        createWebVariant: vi.fn(),
        zipPackage: vi.fn(),
        now: () => new Date('2026-10-27T00:00:00.000Z'),
        sdkVersion: '1.10.1',
      },
    };
  });

vi.mock('./generate-3d.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Generate3dModule>();
  return {
    ...actual,
    generate3d: generate3dMock,
    planGenerate3d: planGenerate3dMock,
    formatGenerate3dPlan: formatGenerate3dPlanMock,
  };
});

vi.mock('./deps.js', () => ({
  createDefaultGenerate3dDeps: () => depsMock,
}));

/** Temp dirs created by the `--input @file` tests. */
const inputDirs: string[] = [];

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerGenerate3dCommand(program);
  return program;
}

async function parse(program: Command, args: string[]): Promise<unknown> {
  return program.parseAsync(['node', 'chatroom', 'generate-3d', ...args]);
}

describe('chatroom generate-3d wiring', () => {
  beforeEach(() => {
    generate3dMock.mockReset();
    generate3dMock.mockResolvedValue({
      outPath: '/tmp/x.glb',
      manifestPath: '/tmp/x.glb.json',
      zipPath: '/tmp/x-20261027-000000.zip',
      htmlPath: '/tmp/x-20261027-000000.html',
      sha256: 'deadbeef',
      costLines: ['Estimated total: $1.20'],
    });
    planGenerate3dMock.mockReset();
    planGenerate3dMock.mockResolvedValue({ plan: true });
    formatGenerate3dPlanMock.mockReset();
    formatGenerate3dPlanMock.mockReturnValue('dry run plan');
    falSubscribeMock.mockReset();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.exitCode = undefined;
    delete process.env.FAL_API_KEY;
    vi.restoreAllMocks();
    await Promise.all(inputDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('registers the generate-3d command', () => {
    const program = createProgram();

    expect(program.commands[0]?.name()).toBe('generate-3d');
  });

  it('lists every flag, the known models and their capabilities, and examples', () => {
    const program = createProgram();
    const command = program.commands[0];

    const help = command?.helpInformation() ?? '';
    expect(help).toContain('Generate one 3D mesh (GLB) with a fal model');
    for (const flag of [
      '--model',
      '--out',
      '--platform',
      '--prompt',
      '--input-image',
      '--force',
      '--rig',
      '--animation-action-id',
      '--package-dir',
      '--input',
      '--confirm-cost',
      '--dry-run',
    ]) {
      expect(help).toContain(flag);
    }
    expect(help).toContain('fal endpoint id (default fal-ai/trellis-2)');

    let afterHelp = '';
    command?.configureOutput({
      writeOut: (text) => {
        afterHelp += text;
      },
    });
    command?.outputHelp();
    expect(afterHelp).toContain('--prompt "a wooden chest" --out chest.glb');
    expect(afterHelp).toContain('--input-image ./concept.png --out chest.glb');
    expect(afterHelp).toContain('--rig --animation-action-id 0 --confirm-cost');
    expect(afterHelp).toContain('humanoid mesh');
    expect(afterHelp).toContain('FLUX 2 Flash first');
    expect(afterHelp).toContain('Models:');
    expect(afterHelp).toContain('meshy/v7.1/text-to-3d');
    expect(afterHelp).toContain('--prompt, --rig');
    expect(afterHelp).toContain('2026-10-27');
    expect(afterHelp).toContain('fal returns');
    for (const model of GENERATE_3D_MODELS) {
      expect(afterHelp).toContain(model.id);
    }
    expect(afterHelp).toContain('Known ids have a price and a capability check.');
    expect(afterHelp).toContain('--input-image, --rig');
    expect(afterHelp).toContain('Generation cost unknown');
    expect(afterHelp).toContain('Unknown ids have neither');
    expect(afterHelp).toContain('web/<stem>.web.glb');
    expect(afterHelp).toContain('manifest.json');
    expect(afterHelp).toContain('<base>.html');
    expect(afterHelp).toContain('<base>.html is a standalone preview');
    expect(afterHelp).toContain('<base> is <out-stem>-<timestamp>');
    expect(command?.options.map((option) => option.long)).not.toContain('--name');
  });

  it('requires --out but defaults --model', async () => {
    const program = createProgram();

    await expect(
      parse(program, ['--model', 'meshy/v7.1/text-to-3d', '--prompt', 'x'])
    ).rejects.toMatchObject({ code: 'commander.missingMandatoryOptionValue' });

    await parse(program, ['--input-image', './x.png', '--out', '/tmp/x.glb']);

    expect(generate3dMock.mock.calls[0]?.[0]).toMatchObject({ model: undefined });
  });

  it('forwards --confirm-cost', async () => {
    const program = createProgram();

    await parse(program, [
      '--model',
      'meshy/v7.1/text-to-3d',
      '--prompt',
      'x',
      '--out',
      '/tmp/x.glb',
      '--rig',
      '--confirm-cost',
    ]);

    expect(generate3dMock.mock.calls[0]?.[0]).toMatchObject({ confirmCost: true });
  });

  it('rejects --name as an unknown option', async () => {
    const program = createProgram();

    await expect(
      parse(program, [
        '--model',
        'meshy/v7.1/text-to-3d',
        '--prompt',
        'x',
        '--out',
        '/tmp/x.glb',
        '--name',
        'chest',
      ])
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });
    expect(generate3dMock).not.toHaveBeenCalled();
  });

  it('rejects an unsupported --platform before running', async () => {
    const program = createProgram();

    await expect(
      parse(program, [
        '--model',
        'meshy/v7.1/text-to-3d',
        '--prompt',
        'x',
        '--out',
        '/tmp/x.glb',
        '--platform',
        'replicate',
      ])
    ).rejects.toMatchObject({
      code: 'commander.invalidArgument',
      message: expect.stringContaining('must be one of fal'),
    });
    expect(generate3dMock).not.toHaveBeenCalled();
  });

  it('runs --dry-run through the plan formatter without fal or download calls', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = createProgram();

    await parse(program, [
      '--platform=fal',
      '--model',
      'meshy/v7.1/text-to-3d',
      '--prompt',
      'a knight',
      '--out',
      '/tmp/x.glb',
      '--dry-run',
    ]);

    expect(planGenerate3dMock).toHaveBeenCalledTimes(1);
    expect(formatGenerate3dPlanMock).toHaveBeenCalledWith({ plan: true });
    expect(logSpy).toHaveBeenCalledWith('dry run plan');
    expect(generate3dMock).not.toHaveBeenCalled();
    expect(falSubscribeMock).not.toHaveBeenCalled();
    expect(vi.mocked(depsMock.fetchGlb)).not.toHaveBeenCalled();
    expect(process.env.FAL_API_KEY).toBeUndefined();
  });

  it('forwards the text options', async () => {
    const program = createProgram();

    await parse(program, [
      '--platform=fal',
      '--model',
      'meshy/v7.1/text-to-3d',
      '--prompt',
      'a knight',
      '--out',
      '/tmp/x.glb',
      '--force',
    ]);

    expect(generate3dMock).toHaveBeenCalledTimes(1);
    expect(generate3dMock.mock.calls[0]?.[0]).toEqual({
      prompt: 'a knight',
      inputImage: undefined,
      model: 'meshy/v7.1/text-to-3d',
      out: '/tmp/x.glb',
      force: true,
    });
  });

  it('forwards the image options', async () => {
    const program = createProgram();

    await parse(program, [
      '--model',
      'fal-ai/trellis-2',
      '--input-image',
      './x.png',
      '--out',
      '/tmp/x.glb',
    ]);

    expect(generate3dMock.mock.calls[0]?.[0]).toMatchObject({
      inputImage: './x.png',
      prompt: undefined,
      model: 'fal-ai/trellis-2',
    });
  });

  it('forwards --rig and repeated --animation-action-id values', async () => {
    const program = createProgram();

    await parse(program, [
      '--model',
      'meshy/v7.1/text-to-3d',
      '--prompt',
      'x',
      '--out',
      '/tmp/x.glb',
      '--rig',
      '--animation-action-id',
      '0',
      '--animation-action-id',
      '92',
    ]);

    expect(generate3dMock).toHaveBeenCalledTimes(1);
    expect(generate3dMock.mock.calls[0]?.[0]).toMatchObject({
      rig: true,
      animationActionIds: ['0', '92'],
    });
  });

  it('rejects --prompt together with --input-image before running', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const program = createProgram();

    await parse(program, [
      '--model',
      'meshy/v7.1/text-to-3d',
      '--prompt',
      'a knight',
      '--input-image',
      './x.png',
      '--out',
      '/tmp/x.glb',
    ]);

    expect(process.exitCode).toBe(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
      'Pass either --prompt or --input-image, not both.'
    );
    expect(generate3dMock).not.toHaveBeenCalled();
    expect(planGenerate3dMock).not.toHaveBeenCalled();
  });

  it('reports action failures on stderr with exitCode 1', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    generate3dMock.mockRejectedValue(new Error('generation exploded'));

    const program = createProgram();
    await parse(program, [
      '--model',
      'meshy/v7.1/text-to-3d',
      '--prompt',
      'x',
      '--out',
      '/tmp/x.glb',
    ]);

    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('generation exploded');
    expect(process.exitCode).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('prints the output paths and cost lines after generation', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = createProgram();

    await parse(program, [
      '--model',
      'meshy/v7.1/text-to-3d',
      '--prompt',
      'x',
      '--out',
      '/tmp/x.glb',
    ]);

    expect(logSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      'Generated /tmp/x.glb',
      'Manifest /tmp/x.glb.json',
      'Package /tmp/x-20261027-000000.zip',
      'Preview /tmp/x-20261027-000000.html',
      'Estimated total: $1.20',
    ]);
  });

  it('forwards inline --input JSON as extraInput', async () => {
    const program = createProgram();

    await parse(program, [
      '--model',
      'fal-ai/trellis-2',
      '--input-image',
      './x.png',
      '--out',
      '/tmp/x.glb',
      '--input',
      '{"resolution":512,"seed":7}',
    ]);

    expect(generate3dMock.mock.calls[0]?.[0]).toMatchObject({
      extraInput: { resolution: 512, seed: 7 },
    });
  });

  it('reads --input from a file when prefixed with @', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'generate-3d-input-'));
    inputDirs.push(dir);
    const path = join(dir, 'input.json');
    await writeFile(path, '{"resolution":1536}', 'utf8');
    const program = createProgram();

    await parse(program, [
      '--model',
      'fal-ai/trellis-2',
      '--input-image',
      './x.png',
      '--out',
      '/tmp/x.glb',
      '--input',
      `@${path}`,
    ]);

    expect(generate3dMock.mock.calls[0]?.[0]).toMatchObject({ extraInput: { resolution: 1536 } });
  });

  it.each([
    ['not JSON', 'nope', /--input must be valid JSON/],
    ['not an object', '[1,2]', /--input must be a JSON object/],
    ['null', 'null', /--input must be a JSON object/],
  ])('rejects --input that is %s', async (_label, value, message) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const program = createProgram();

    await parse(program, [
      '--model',
      'fal-ai/trellis-2',
      '--input-image',
      './x.png',
      '--out',
      '/tmp/x.glb',
      '--input',
      value,
    ]);

    expect(process.exitCode).toBe(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(message);
    expect(generate3dMock).not.toHaveBeenCalled();
  });

  it('rejects a missing --input file', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const program = createProgram();

    await parse(program, [
      '--model',
      'fal-ai/trellis-2',
      '--input-image',
      './x.png',
      '--out',
      '/tmp/x.glb',
      '--input',
      '@/tmp/definitely-not-a-real-file.json',
    ]);

    expect(process.exitCode).toBe(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/--input file not found/);
    expect(generate3dMock).not.toHaveBeenCalled();
  });

  it('forwards --package-dir', async () => {
    const program = createProgram();

    await parse(program, [
      '--model',
      'meshy/v7.1/text-to-3d',
      '--prompt',
      'x',
      '--out',
      '/tmp/x.glb',
      '--package-dir',
      '/tmp/packages',
    ]);

    expect(generate3dMock.mock.calls[0]?.[0]).toMatchObject({ packageDir: '/tmp/packages' });
  });
});
