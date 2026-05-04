import { describe, it, expect } from 'vitest';

import { exhaustive } from './exhaustive';

describe('exhaustive', () => {
  it('throws Error with the value embedded when called', () => {
    expect(() => exhaustive('unexpected' as never)).toThrow(
      'Unhandled discriminant: "unexpected"'
    );
  });
});
