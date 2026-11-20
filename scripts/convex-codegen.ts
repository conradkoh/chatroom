#!/usr/bin/env bun
import { dirname, resolve } from 'node:path';

import { applyConvexDevEnvDefaults, buildConvexDevEnv } from './convex-dev-env';

const repoRoot = resolve(dirname(import.meta.path), '..');
const backendDir = resolve(repoRoot, 'services/backend');

applyConvexDevEnvDefaults();

const child = Bun.spawn(['pnpm', 'exec', 'convex', 'codegen', '--typecheck', 'disable'], {
  cwd: backendDir,
  // `convex codegen` may start an ephemeral local backend, which panics on a non-UTC TZ.
  // This script does not classify the deployment, so TZ is always removed here.
  env: buildConvexDevEnv(process.env, true),
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});

process.exit(await child.exited);
