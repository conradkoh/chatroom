import { describe, expect, test } from 'vitest';
import { parseMakefileTargets } from './makefile-discovery.js';

describe('parseMakefileTargets', () => {
  test('discovers .PHONY targets', () => {
    const content = `.PHONY: build test lint
build:
\tnpm run build
test:
\tnpm test`;
    expect(parseMakefileTargets(content)).toEqual(['build', 'lint', 'test']);
  });

  test('falls back to rule targets when no .PHONY', () => {
    const content = `dev:
\tnpm run dev
clean:
\trm -rf dist`;
    expect(parseMakefileTargets(content)).toEqual(['clean', 'dev']);
  });

  test('skips pattern rules and hidden targets', () => {
    const content = `.PHONY: build
%.o:
\tcc -c
.SUFFIXES:
build:
\tmake stuff`;
    expect(parseMakefileTargets(content)).toEqual(['build']);
  });
});
