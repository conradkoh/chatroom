import { describe, expect, it } from 'vitest';

import { getLocalWebHealth } from './get-local-web-health.js';

describe('getLocalWebHealth', () => {
  it('returns ok health with port', () => {
    expect(getLocalWebHealth(18765)).toEqual({
      status: 'ok',
      service: 'v2-local-web',
      port: 18765,
    });
  });
});
