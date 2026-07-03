/**
 * Bun build configuration for chatroom-cli.
 *
 * Using Bun.build() with BuildConfig types from @types/bun provides compile-time
 * schema validation — invalid options are caught by `tsc` before the build runs.
 *
 * Run via: bun run build.config.ts
 */

import { rmSync } from 'node:fs';

import type { BuildConfig } from 'bun';

const config: BuildConfig = {
  entrypoints: ['src/node-launch.ts', 'src/index.ts'],
  outdir: 'dist',
  target: 'node',
  format: 'esm',
  sourcemap: 'external',
  external: [
    // @cursor/sdk is loaded at runtime via importBundledCursorSdk(). Keeping it
    // external preserves resolution from the chatroom-cli install root.
    '@cursor/sdk',
    // @anthropic-ai/claude-agent-sdk is loaded at runtime via importBundledClaudeSdk().
    '@anthropic-ai/claude-agent-sdk',
    '@anthropic-ai/claude-agent-sdk/extract',
  ],
};

// Clean previous output before building
rmSync('dist', { recursive: true, force: true });

const result = await Bun.build(config);

if (!result.success) {
  console.error('Build failed:');
  for (const message of result.logs) {
    console.error(' ', message);
  }
  process.exit(1);
}

console.log(`Built ${result.outputs.length} output(s):`);
for (const output of result.outputs) {
  const sizeKb = (output.size / 1024).toFixed(2);
  console.log(`  ${output.path}  (${sizeKb} KB)`);
}
