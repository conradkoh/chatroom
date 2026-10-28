/**
 * `chatroom generate-3d` wiring tests.
 *
 * Failure paths run against real commander wiring; successful parses run
 * against a mocked `generate3d` so nothing hits the network. The inherited
 * command is asserted not to exist: `generate-3d` is a leaf command.
 */

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

  afterEach(() => {
    process.exitCode = undefined;
    delete process.env.FAL_API_KEY;
    vi.restoreAllMocks();
  });

  it('registers the generate-3d command', () => {
    const program = createProgram();

    expect(program.commands[0]?.name()).toBe('generate-3d');
  });

  it('lists every flag, the allowed models, and examples in help output', () => {
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
      '--name',
      '--package-dir',
      '--dry-run',
    ]) {
      expect(help).toContain(flag);
    }
    for (const model of GENERATE_3D_MODELS) {
      expect(help).toContain(model.id);
    }

    let afterHelp = '';
    command?.configureOutput({
      writeOut: (text) => {
        afterHelp += text;
      },
    });
    command?.outputHelp();
    expect(afterHelp).toContain('--model meshy/v7.1/text-to-3d --prompt "a stone knight"');
    expect(afterHelp).toContain('--model fal-ai/trellis-2 --input-image ./concept.png');
    expect(afterHelp).toContain('--rig --animation-action-id 0');
    expect(afterHelp).toContain('humanoid mesh');
    expect(afterHelp).toContain('text-to-3D:');
    expect(afterHelp).toContain('image-to-3D:');
    expect(afterHelp).toContain('2026-10-27');
    expect(afterHelp).toContain('fal returns');
    expect(afterHelp).toContain('web/<stem>.web.glb');
    expect(afterHelp).toContain('manifest.json');
    expect(afterHelp).toContain('{timestamp} (UTC), and {requestId8}');
    expect(afterHelp).toContain('Default: {stem}-{timestamp}');
    expect(help).toContain('Package base name template ({stem}, {model},');
    expect(help).toContain('{timestamp}, {requestId8}');
  });

  it('requires --model and --out', async () => {
    const program = createProgram();

    await expect(
      parse(program, ['--model', 'meshy/v7.1/text-to-3d', '--prompt', 'x'])
    ).rejects.toMatchObject({ code: 'commander.missingMandatoryOptionValue' });
    await expect(parse(program, ['--prompt', 'x', '--out', '/tmp/x.glb'])).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
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

  it('reports action failures on stderr with exitCode 1 and never prints FAL_API_KEY', async () => {
    const key = 'fal-key-sentinel-do-not-print';
    process.env.FAL_API_KEY = key;
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

    const printed = [...errorSpy.mock.calls, ...logSpy.mock.calls]
      .flat()
      .map((value) => String(value));
    expect(printed.some((line) => line.includes(key))).toBe(false);
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
      'Estimated total: $1.20',
    ]);
  });

  it('forwards --name and --package-dir', async () => {
    const program = createProgram();

    await parse(program, [
      '--model',
      'meshy/v7.1/text-to-3d',
      '--prompt',
      'x',
      '--out',
      '/tmp/x.glb',
      '--name',
      '{stem}-{requestId8}',
      '--package-dir',
      '/tmp/packages',
    ]);

    expect(generate3dMock.mock.calls[0]?.[0]).toMatchObject({
      name: '{stem}-{requestId8}',
      packageDir: '/tmp/packages',
    });
  });
});
