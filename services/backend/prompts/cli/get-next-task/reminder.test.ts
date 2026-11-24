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
  test('reloads the verifier prompt and downloads the log from the request user message id', () => {
    const output = render('verifier');

    expect(output).toContain('get-system-prompt');
    expect(output).toContain('messages download');
    expect(output).toContain('--since-message-id="<user-message-id>"');
    expect(output).not.toMatch(CONTEXT_REFERENCE);
  });

  test('anchors on the user message id before downloading the log', () => {
    const output = render('verifier');
    expect(output).toContain('messages anchor');
    expect(output.indexOf('messages anchor')).toBeLessThan(output.indexOf('messages download'));
  });

  test('keeps the context-read recovery for a non-verifier role', () => {
    expect(render('builder')).toContain('chatroom context read');
  });

  test('treats the verifier role case-insensitively', () => {
    expect(render('Verifier')).not.toMatch(CONTEXT_REFERENCE);
  });
});
