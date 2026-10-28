/**
 * Bun build configuration for chatroom-cli.
 *
 * Using Bun.build() with BuildConfig types from @types/bun provides compile-time
 * schema validation — invalid options are caught by `tsc` before the build runs.
 *
 * Run via: bun run build.config.ts
 */

import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    // sharp ships per-platform native binaries, so it must resolve from the
    // install root at runtime instead of being bundled.
    'sharp',
    // All of these reach sharp at their module top level, and all of them are
    // only needed at runtime for one command each (3D packaging and PDF
    // parsing). Bundling them would hoist their `import sharp from "sharp"` to
    // the top of this bundle, so every CLI invocation would load sharp before
    // any command ran; marked external, Bun keeps the callers' `await
    // import(...)` lazy and the module graph loads only when that command runs.
    '@gltf-transform/functions',
    // core and extensions must be external for the same reason a package is
    // external: `@gltf-transform/functions` keeps a `Document` registry in
    // core's static `_GRAPH_DOCUMENTS` map, so a bundled copy of core would be
    // a second instance that the external functions never fills, and `weld()`
    // would fail with "Cannot read properties of null (reading 'getLogger')".
    // All four therefore have to resolve from one node_modules copy.
    '@gltf-transform/core',
    '@gltf-transform/extensions',
    '@llamaindex/liteparse',
  ],
};

// Clean previous output before building
rmSync('dist', { recursive: true, force: true });

const cliRoot = dirname(fileURLToPath(import.meta.url));
const clientBuildSrc = join(cliRoot, 'src/daemon/local-web/client/build');
const clientBuildDest = join(cliRoot, 'dist/client/build');

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

if (!existsSync(join(clientBuildSrc, 'index.html'))) {
  throw new Error(
    'local-web client build missing at src/daemon/local-web/client/build — run build:local-web first'
  );
}
cpSync(clientBuildSrc, clientBuildDest, { recursive: true });
console.log(`Copied local-web client build to ${clientBuildDest}`);
