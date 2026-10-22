/**
 * `chatroom generate-image` wiring tests.
 *
 * Only failure paths are exercised: a valid parse would run the real command
 * and hit the network, so success behavior lives in image.test.ts.
 */

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { registerGenerateImageCommand } from './index.js';

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
  afterEach(() => {
    process.exitCode = undefined;
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

  it('documents the flags in help output', () => {
    const program = createProgram();
    const command = program.commands[0];

    expect(command?.name()).toBe('generate-image');
    const flags = command?.options.map((option) => option.long) ?? [];
    expect(flags).toEqual([
      '--prompt',
      '--out',
      '--model',
      '--aspect-ratio',
      '--output-format',
      '--seed',
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
