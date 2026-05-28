/**
 * Bun build configuration for chatroom-cli.
 *
 * Using Bun.build() with BuildConfig types from @types/bun provides compile-time
 * schema validation — invalid options are caught by `tsc` before the build runs.
 *
 * Run via: bun run build.config.ts
 */

import type { BuildConfig } from 'bun';
import { rmSync } from 'node:fs';

const config: BuildConfig = {
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  target: 'node',
  format: 'esm',
  sourcemap: 'external',
  external: [
    // @cursor/sdk uses sqlite3, a native .node addon. Bun cannot bundle native
    // addons; if inlined, require('sqlite3') would resolve from dist/'s context
    // where sqlite3 is unreachable due to pnpm isolation. Keeping the SDK
    // external preserves its own node_modules resolution chain.
    '@cursor/sdk',
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
