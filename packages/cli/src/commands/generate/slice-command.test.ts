/**
 * `chatroom slice-image` wiring tests.
 *
 * Failure paths run against real commander wiring; successful parses run
 * against a mocked `sliceImage`, so nothing touches the filesystem or pngjs.
 * The pure slicing behavior lives in slice.test.ts.
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSliceImageCommand } from './slice-command.js';
import type * as SliceModule from './slice.js';

// The command must never load the fal SDK, even transitively.
vi.mock('@fal-ai/client', () => {
  throw new Error('must not load fal');
});

const { sliceImageMock } = vi.hoisted(() => ({ sliceImageMock: vi.fn() }));

vi.mock('./slice.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SliceModule>();
  return { ...actual, sliceImage: sliceImageMock };
});

vi.mock('./slice-deps.js', () => ({
  createDefaultSliceImageDeps: () => ({}),
}));

const RESULT = {
  dryRun: false,
  sheet: {
    path: '/sheets/sheet.png',
    sha256: 'abcdefabcdef0000000000000000000000000000000000000000000000000000',
    width: 1024,
    height: 768,
  },
  tileSize: { width: 256, height: 256 },
  droppedRemainder: { right: 0, bottom: 0 },
  outDir: '/tiles',
  tiles: [
    {
      index: 0,
      row: 0,
      col: 0,
      x: 0,
      y: 0,
      width: 256,
      height: 256,
      name: 'hero',
      path: '/tiles/hero.png',
      manifestPath: '/tiles/hero.png.json',
      sha256: 'deadbeef',
    },
  ],
  skipped: [1],
  indexPath: '/tiles/sheet.slices.json',
  warnings: ['source manifest missing'],
};

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerSliceImageCommand(program);
  return program;
}

async function parse(program: Command, args: string[]): Promise<unknown> {
  return program.parseAsync(['node', 'chatroom', 'slice-image', ...args]);
}

const REQUIRED = ['--in', '/sheets/sheet.png', '--out-dir', '/tiles', '--cols', '4', '--rows', '3'];

describe('chatroom slice-image wiring', () => {
  beforeEach(() => {
    sliceImageMock.mockReset();
    sliceImageMock.mockResolvedValue(RESULT);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it.each([
    ['--in', ['--out-dir', '/tiles', '--cols', '4', '--rows', '3']],
    ['--out-dir', ['--in', '/sheets/sheet.png', '--cols', '4', '--rows', '3']],
    ['--cols', ['--in', '/sheets/sheet.png', '--out-dir', '/tiles', '--rows', '3']],
    ['--rows', ['--in', '/sheets/sheet.png', '--out-dir', '/tiles', '--cols', '4']],
  ])('requires %s', async (_flag, args) => {
    const program = createProgram();

    await expect(parse(program, args)).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
    });
    expect(sliceImageMock).not.toHaveBeenCalled();
  });

  it.each([
    ['--cols', '0'],
    ['--cols', '65'],
    ['--cols', 'x'],
    ['--rows', '0'],
    ['--rows', '65'],
    ['--margin', '-1'],
    ['--margin', ''],
    ['--gutter', '1.5'],
    ['--cols', '0x10'],
    ['--cols', '1e1'],
  ])('rejects %s %s before slicing', async (flag, value) => {
    const program = createProgram();

    await expect(parse(program, [...REQUIRED, flag, value])).rejects.toMatchObject({
      code: 'commander.invalidArgument',
    });
    expect(sliceImageMock).not.toHaveBeenCalled();
  });

  it('maps the flags to slice options and keeps empty names as skips', async () => {
    const program = createProgram();

    await parse(program, [
      ...REQUIRED,
      '--margin',
      '4',
      '--gutter',
      '2',
      '--names',
      'a,,c',
      '--allow-remainder',
      '--allow-edge-content',
      '--force',
      '--dry-run',
    ]);

    expect(sliceImageMock.mock.calls[0]?.[0]).toEqual({
      in: '/sheets/sheet.png',
      outDir: '/tiles',
      cols: 4,
      rows: 3,
      margin: 4,
      gutter: 2,
      names: ['a', '', 'c'],
      prefix: undefined,
      allowRemainder: true,
      allowEdgeContent: true,
      force: true,
      dryRun: true,
    });
  });

  it('defaults margin and gutter to 0', async () => {
    const program = createProgram();

    await parse(program, REQUIRED);

    expect(sliceImageMock.mock.calls[0]?.[0]).toMatchObject({ margin: 0, gutter: 0 });
  });

  it('forwards --prefix', async () => {
    const program = createProgram();

    await parse(program, [...REQUIRED, '--prefix', 'dungeon']);

    expect(sliceImageMock.mock.calls[0]?.[0]).toMatchObject({ prefix: 'dungeon' });
  });

  it('prints the summary, tile lines, index, skipped cells, and warnings', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const program = createProgram();

    await parse(program, REQUIRED);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(output).toContain(
      'Sheet /sheets/sheet.png (1024x768, sha256 abcdefabcdef) -> 4x3 grid, tile 256x256'
    );
    expect(output).toContain('Sliced /tiles/hero.png (0,0 256x256)');
    expect(output).toContain('Index /tiles/sheet.slices.json');
    expect(output).toContain('Skipped cells: 2');
    expect(String(errorSpy.mock.calls[0]?.[0])).toBe('⚠️ source manifest missing');
  });

  it('says "Would slice" under --dry-run', async () => {
    sliceImageMock.mockResolvedValue({ ...RESULT, dryRun: true });
    const program = createProgram();

    await parse(program, [...REQUIRED, '--dry-run']);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(output).toContain('Would slice /tiles/hero.png');
    expect(output).not.toContain('Sliced /tiles/hero.png');
  });

  it('reports failures on stderr, sets exitCode 1, and prints nothing to stdout', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    sliceImageMock.mockRejectedValue(new Error('grid does not fit'));
    const program = createProgram();

    await parse(program, REQUIRED);

    expect(String(errorSpy.mock.calls[0]?.[0])).toBe('❌ grid does not fit');
    expect(process.exitCode).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('lists the command grammar in help output', () => {
    const program = createProgram();
    const command = program.commands[0];

    expect(command?.name()).toBe('slice-image');
    expect(command?.description()).toContain('Cut a PNG sprite sheet');
    const required = command?.options
      .filter((option) => option.mandatory)
      .map((option) => option.long);
    expect(required).toEqual(['--in', '--out-dir', '--cols', '--rows']);
    const help = command?.helpInformation() ?? '';
    for (const flag of [
      '--margin',
      '--gutter',
      '--names',
      '--prefix',
      '--allow-remainder',
      '--force',
      '--dry-run',
    ]) {
      expect(help).toContain(flag);
    }
  });

  it('documents grammar, rules, outputs, and worked examples in help output', () => {
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
      'chatroom slice-image --in <path> --out-dir <dir> --cols <n> --rows <n> [--margin <px>] [--gutter <px>] [--names <a,b,,c,...> | --prefix <text>] [--allow-remainder] [--force] [--dry-run]'
    );
    expect(help).toContain('--allow-remainder');
    expect(help).toContain('--names');
    expect(help).toContain('<stem>.slices.json');
    expect(help).toContain('--cols 4 --rows 3');
    expect(help).toContain('256x256');
    expect(help).toContain('512x384');
    expect(help).toContain('341x384');
  });
});
