#!/usr/bin/env bun
import { dirname, resolve } from 'node:path';

import { applyConvexDevEnvDefaults } from './convex-dev-env';

const repoRoot = resolve(dirname(import.meta.path), '..');
const backendDir = resolve(repoRoot, 'services/backend');

applyConvexDevEnvDefaults();

const child = Bun.spawn(['pnpm', 'exec', 'convex', 'codegen', '--typecheck', 'disable'], {
  cwd: backendDir,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});

process.exit(await child.exited);
