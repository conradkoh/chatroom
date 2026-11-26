import { describe, expect, test } from 'vitest';

import { getCompactionRecoveryNote, getCompactionRecoveryOneLiner } from './reminder';

const CONTEXT_REFERENCE = /chatroom context|context read/i;

const PARAMS = {
  cliEnvPrefix: '',
  chatroomId: 'chat-1',
} as const;

const renderers: [string, (role: string) => string][] = [
  ['note', (role) => getCompactionRecoveryNote({ ...PARAMS, role })],
  ['one-liner', (role) => getCompactionRecoveryOneLiner({ ...PARAMS, role })],
];

describe.each(renderers)('compaction recovery %s', (_name, render) => {
  test('reloads the prompt and downloads the latest page', () => {
    const output = render('verifier');

    expect(output).toContain('get-system-prompt');
    expect(output).toContain('chatroom messages download --chatroom-id="chat-1" --role="verifier"');
    expect(output.toLowerCase()).toContain('latest page');
    expect(output).not.toMatch(CONTEXT_REFERENCE);
  });

  test('names exactly one download command and no anchor command', () => {
    const output = render('verifier');
    expect(output).not.toContain('messages anchor');
    expect(output).not.toContain('--since-message-id');
    expect(output.match(/chatroom messages download/g)).toHaveLength(1);
  });

  test('recovers a non-verifier role through the latest page, not context read', () => {
    const output = render('builder');

    expect(output).toContain('get-system-prompt');
    expect(output).toContain('chatroom messages download --chatroom-id="chat-1" --role="builder"');
    expect(output).not.toContain('context read');
  });

  test('treats the verifier role case-insensitively', () => {
    expect(render('Verifier')).not.toMatch(CONTEXT_REFERENCE);
  });
});

describe('compaction recovery note', () => {
  test('names the verification request as the subject for the verifier', () => {
    expect(getCompactionRecoveryNote({ ...PARAMS, role: 'verifier' })).toContain(
      'your verification request'
    );
    expect(getCompactionRecoveryNote({ ...PARAMS, role: 'Verifier' })).toContain(
      'your verification request'
    );
  });

  test('names the current task as the subject for other roles', () => {
    expect(getCompactionRecoveryNote({ ...PARAMS, role: 'builder' })).toContain(
      'your current task'
    );
  });
});
