/**
 * `chatroom remove-image-background` wiring tests.
 *
 * Failure paths use real commander wiring; successful parses use a mocked
 * orchestrator so nothing touches the filesystem or pngjs.
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerRemoveImageBackgroundCommand } from './remove-background-command.js';
import type * as RemoveModule from './remove-background.js';

vi.mock('@fal-ai/client', () => {
  throw new Error('must not load fal');
});

const { removeMock } = vi.hoisted(() => ({ removeMock: vi.fn() }));

vi.mock('./remove-background.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RemoveModule>();
  return { ...actual, removeImageBackground: removeMock };
});

vi.mock('./remove-background-deps.js', () => ({
  createDefaultRemoveImageBackgroundDeps: () => ({}),
}));

const RESULT = {
  dryRun: false,
  assets: [
    {
      sourceStem: 'potion',
      assignedName: 'potion_hd',
      sourcePath: '/tiles/potion.png',
      path: '/assets/potion_hd.png',
      manifestPath: '/assets/potion_hd.png.json',
      sha256: 'deadbeef',
      width: 352,
      height: 256,
      components: 1,
      contentBox: { x: 105, y: 29, width: 142, height: 200 },
      centerOffset: { x: 0, y: 1 },
      background: [193, 199, 206] as [number, number, number],
      trimmed: false,
      warnings: ['Dropped 1 speck(s) (3 px) in /tiles/potion.png.'],
    },
  ],
  ignoredNonPng: 0,
  warnings: [],
};

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerRemoveImageBackgroundCommand(program);
  return program;
}

async function parse(program: Command, args: string[]): Promise<unknown> {
  return program.parseAsync(['node', 'chatroom', 'remove-image-background', ...args]);
}

describe('chatroom remove-image-background wiring', () => {
  beforeEach(() => {
    removeMock.mockReset();
    removeMock.mockResolvedValue(RESULT);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it.each([
    ['--tolerance', '0'],
    ['--tolerance', '129'],
    ['--tolerance', 'x'],
    ['--min-area', '51'],
    ['--min-area', 'x'],
    ['--map', 'a'],
    ['--map', 'a='],
    ['--map', '=b'],
    ['--map', 'a=b,a=c'],
    ['--trim-padding', '65'],
    ['--trim-padding', 'x'],
  ])('rejects %s %s before running', async (flag, value) => {
    const program = createProgram();

    await expect(parse(program, [flag, value])).rejects.toMatchObject({
      code: 'commander.invalidArgument',
    });
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('maps every flag to the orchestrator options', async () => {
    const program = createProgram();

    await parse(program, [
      '--in-dir',
      '/tiles',
      '--out-dir',
      '/assets',
      '--map',
      'potion=potion_hd,sword=sword_hd',
      '--tolerance',
      '20',
      '--min-area',
      '1.5',
      '--allow-edge-content',
      '--trim',
      '--trim-padding',
      '2',
      '--force',
      '--dry-run',
    ]);

    expect(removeMock.mock.calls[0]?.[0]).toEqual({
      in: undefined,
      out: undefined,
      inDir: '/tiles',
      outDir: '/assets',
      map: { potion: 'potion_hd', sword: 'sword_hd' },
      tolerance: 20,
      minArea: 1.5,
      allowEdgeContent: true,
      trim: true,
      trimPadding: 2,
      force: true,
      dryRun: true,
    });
  });

  it('defaults tolerance to 24 and min-area to 0.5', async () => {
    const program = createProgram();

    await parse(program, ['--in', '/tiles/a.png', '--out', '/assets/a.png']);

    expect(removeMock.mock.calls[0]?.[0]).toMatchObject({ tolerance: 24, minArea: 0.5 });
  });

  it('prints one line per asset with content, offset, and background', async () => {
    const program = createProgram();

    await parse(program, ['--in', '/tiles/potion.png', '--out', '/assets/potion.png']);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(output).toContain(
      'Isolated /assets/potion_hd.png (1 region(s), content 142x200 at 105,29, offset 0,1, bg 193,199,206)'
    );
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain('Dropped 1 speck');
  });

  it('says "Would isolate" under --dry-run', async () => {
    removeMock.mockResolvedValue({ ...RESULT, dryRun: true });
    const program = createProgram();

    await parse(program, ['--in', '/tiles/a.png', '--out', '/assets/a.png', '--dry-run']);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(output).toContain('Would isolate /assets/potion_hd.png');
  });

  it('refuses --trim-padding without --trim through the orchestrator', async () => {
    removeMock.mockRejectedValue(new Error('--trim-padding is only valid with --trim.'));
    const program = createProgram();

    await parse(program, ['--in', '/tiles/a.png', '--out', '/assets/a.png', '--trim-padding', '2']);

    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toBe(
      '❌ --trim-padding is only valid with --trim.'
    );
    expect(process.exitCode).toBe(1);
  });

  it('reports failures on stderr, sets exitCode 1, and prints nothing to stdout', async () => {
    removeMock.mockRejectedValue(new Error('Pass either --in with --out'));
    const program = createProgram();

    await parse(program, []);

    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toBe(
      '❌ Pass either --in with --out'
    );
    expect(process.exitCode).toBe(1);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('documents grammar, algorithm, naming, refusals, limits, and examples in help', () => {
    const program = createProgram();
    const command = program.commands[0];
    let help = '';
    command?.configureOutput({
      writeOut: (text) => {
        help += text;
      },
    });
    command?.outputHelp();

    expect(help).toContain(
      'chatroom remove-image-background (--in <png> --out <png> | --in-dir <dir> --out-dir <dir>)'
    );
    expect(help).toContain('Run after chatroom slice-image');
    expect(help).toContain('One input tile becomes one asset');
    expect(help).toContain('per-channel median');
    expect(help).toContain('Flood fill');
    expect(help).toContain('Speck filter');
    expect(help).toContain('Edge ramp');
    expect(help).toContain('canvas');
    expect(help).toContain('no colour decontamination');
    expect(help).toContain('no component splitting');
    expect(help).toContain('Trim:');
    expect(help).toContain('--trim crops each asset to its opaque content');
    expect(help).toContain('--trim-padding');
    expect(help).toContain('--map items-01=potion --trim --trim-padding 2');
    expect(help).toContain('FAL_API_KEY');
    expect(help).toContain('--map');
    expect(help).toContain('remove-image-background --in tiles/potion.png --out assets/potion.png');
    expect(help).toContain('--in-dir tiles --out-dir assets');
  });
});
