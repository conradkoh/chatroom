import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DropdownMenuItem', () => {
  it('includes data-highlighted accent classes for pointer hover', () => {
    const source = readFileSync(resolve(__dirname, 'dropdown-menu.tsx'), 'utf-8');
    expect(source).toContain('data-[highlighted]:bg-accent');
    expect(source).toContain('data-[highlighted]:text-accent-foreground');
  });
});
