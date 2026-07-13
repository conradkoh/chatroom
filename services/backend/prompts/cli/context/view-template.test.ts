import { describe, expect, test } from 'vitest';

import { contextViewTemplateCommand } from './view-template';

describe('contextViewTemplateCommand', () => {
  test('returns command without flags', () => {
    expect(
      contextViewTemplateCommand({
        cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      })
    ).toBe('CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context view-template');
  });

  test('omits prefix in production', () => {
    expect(contextViewTemplateCommand({ cliEnvPrefix: '' })).toBe('chatroom context view-template');
  });
});
