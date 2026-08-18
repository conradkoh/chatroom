import { describe, expect, it } from 'vitest';

import {
  commandLooksLikeDaemonStart,
  envBlobMatchesConvexUrl,
  parsePsPidCommandLines,
} from './daemon-process-scan.js';
import { CONVEX_URL } from '../../infrastructure/convex/client.js';

describe('daemon-process-scan', () => {
  it('detects daemon start argv in node, pnpm, and sh wrappers', () => {
    expect(
      commandLooksLikeDaemonStart(
        '/usr/bin/node /repo/packages/cli/dist/index.js machine daemon start'
      )
    ).toBe(true);
    expect(commandLooksLikeDaemonStart('sh -c pnpm exec chatroom machine daemon start')).toBe(true);
    expect(commandLooksLikeDaemonStart('chatroom machine daemon status')).toBe(false);
    expect(commandLooksLikeDaemonStart('chatroom machine daemon stop')).toBe(false);
  });

  it('matches explicit CHATROOM_CONVEX_URL and default cloud when unset', () => {
    expect(
      envBlobMatchesConvexUrl(
        'PATH=/usr/bin CHATROOM_CONVEX_URL=https://wonderful-raven-192.convex.cloud HOME=/tmp',
        'https://wonderful-raven-192.convex.cloud'
      )
    ).toBe(true);
    expect(
      envBlobMatchesConvexUrl(
        'PATH=/usr/bin\0CHATROOM_CONVEX_URL=https://wonderful-raven-192.convex.cloud\0HOME=/tmp',
        CONVEX_URL
      )
    ).toBe(false);
    expect(envBlobMatchesConvexUrl('PATH=/usr/bin HOME=/tmp', CONVEX_URL)).toBe(true);
    expect(
      envBlobMatchesConvexUrl('PATH=/usr/bin HOME=/tmp', 'https://wonderful-raven-192.convex.cloud')
    ).toBe(false);
  });

  it('parses ps pid/command rows', () => {
    expect(
      parsePsPidCommandLines(
        '  123 /usr/bin/node dist/index.js machine daemon start\n456 grep machine daemon start\n'
      )
    ).toEqual([
      { pid: 123, command: '/usr/bin/node dist/index.js machine daemon start' },
      { pid: 456, command: 'grep machine daemon start' },
    ]);
  });
});
