import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const cliPackageRoot = fileURLToPath(new URL('../../', import.meta.url));
const CHILD_TIMEOUT_MS = 15_000;

interface Host {
  readonly name: 'node' | 'bun';
  readonly command: () => string;
  readonly args: (source: string) => string[];
}

interface ChildResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
}

const hosts: readonly Host[] = [
  {
    name: 'node',
    command: () => process.execPath,
    args: (source) => ['--input-type=module', '--eval', source],
  },
  {
    name: 'bun',
    command: () => {
      const resolver = process.platform === 'win32' ? 'where.exe' : 'which';
      const matches = execFileSync(resolver, ['bun'], { encoding: 'utf8' }).trim().split(/\r?\n/);
      const executable = matches[0];
      if (!executable) throw new Error('Unable to locate Bun executable');
      return executable;
    },
    args: (source) => ['--eval', source],
  },
];

function runChild(host: Host, source: string): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(host.command(), host.args(source), {
        cwd: cliPackageRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CHILD_TIMEOUT_MS);

    const settle = (result: ChildResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      settle({ stdout, stderr, code, signal, timedOut });
    });
  });
}

async function expectNaturalCompletion(host: Host, source: string, marker: string): Promise<void> {
  const result = await runChild(host, source);
  expect(result.timedOut, result.stderr).toBe(false);
  expect(result.signal, result.stderr).toBeNull();
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout.match(new RegExp(marker, 'g'))).toHaveLength(1);
}

const callbackCancellation = `
import { Effect, Fiber } from 'effect';

let controller;
let finalized = 0;
let signalStarted;
const started = new Promise((resolve) => { signalStarted = resolve; });
const callback = Effect.callback(() => {
  controller = new AbortController();
  signalStarted();
  const cleanup = new Promise((resolve) => queueMicrotask(resolve));
  return Effect.promise(async () => {
    controller.abort();
    await cleanup;
    finalized++;
  });
});

let fiber;
try {
  fiber = Effect.runFork(callback);
  await started;
  await Effect.runPromise(Fiber.interrupt(fiber));
  if (!controller.signal.aborted || finalized !== 1) {
    throw new Error('callback cancellation did not await its finalizer');
  }
  console.log('callback-cleaned');
} finally {
  if (fiber) await Effect.runPromise(Fiber.interrupt(fiber));
}
`;

const detachedWorker = `
import { Effect, Fiber } from 'effect';

let signalStarted;
const started = new Promise((resolve) => { signalStarted = resolve; });
let deliver;
const message = new Promise((resolve) => { deliver = resolve; });
let signalHandled;
const handled = new Promise((resolve) => { signalHandled = resolve; });
let handledCount = 0;
let finalized = 0;
const fiber = await Effect.runPromise(Effect.gen(function* () {
  return yield* Effect.forkDetach(
    Effect.gen(function* () {
      signalStarted();
      yield* Effect.promise(() => message);
      handledCount++;
      signalHandled();
      yield* Effect.never;
    }).pipe(Effect.ensuring(Effect.sync(() => { finalized++; })))
  );
}));

try {
  await started;
  deliver();
  await handled;
  if (handledCount !== 1) throw new Error('detached worker did not handle delivery');
  await Effect.runPromise(Fiber.interrupt(fiber));
  if (finalized !== 1) throw new Error('detached worker finalizer did not complete');
  console.log('detached-worker-cleaned');
} finally {
  await Effect.runPromise(Fiber.interrupt(fiber));
}
`;

const managedRuntimeDisposal = `
import { Cause, Context, Effect, Exit, Fiber, Layer, ManagedRuntime } from 'effect';

class Resource extends Context.Service()('LifecycleResource') {}
let released = 0;
const resourceLayer = Layer.effect(
  Resource,
  Effect.acquireRelease(
    Effect.sync(() => ({ value: 'ready' })),
    () => Effect.sync(() => { released++; })
  )
);
const runtime = ManagedRuntime.make(resourceLayer);
let signalStarted;
const started = new Promise((resolve) => { signalStarted = resolve; });
let finalized = 0;
const fiber = runtime.runFork(Effect.gen(function* () {
  const resource = yield* Resource;
  if (resource.value !== 'ready') throw new Error('resource was not provided');
  signalStarted();
  yield* Effect.never;
}).pipe(Effect.ensuring(Effect.sync(() => { finalized++; }))));

try {
  await started;
  await runtime.dispose();
  const exit = await Effect.runPromise(Fiber.await(fiber));
  if (Exit.isSuccess(exit) || !Cause.hasInterruptsOnly(exit.cause)) {
    throw new Error('runtime-owned fiber was not interrupted on disposal');
  }
  if (finalized !== 1 || released !== 1) {
    throw new Error('runtime disposal did not await fiber and layer cleanup');
  }
  await runtime.dispose();
  if (finalized !== 1 || released !== 1) throw new Error('repeated disposal duplicated cleanup');
  console.log('managed-runtime-disposed');
} finally {
  await runtime.dispose();
}
`;

const failureIdentity = `
import { Effect } from 'effect';

const originalError = new Error('original typed failure');
let observedError;
try {
  await Effect.runPromise(Effect.fail(originalError));
} catch (error) {
  observedError = error;
}
if (observedError !== originalError) throw new Error('typed failure identity changed');

const originalDefect = new Error('original defect');
let observedDefect;
try {
  await Effect.runPromise(Effect.die(originalDefect));
} catch (error) {
  observedDefect = error;
}
if (observedDefect !== originalDefect) throw new Error('defect identity changed');
console.log('failure-identity-preserved');
`;

describe.each(hosts)('Effect 4 process lifecycle on $name', (host) => {
  it('awaits asynchronous callback cancellation cleanup', async () => {
    await expectNaturalCompletion(host, callbackCancellation, 'callback-cleaned');
  });

  it('keeps a detached worker alive for delivery and interrupts it explicitly', async () => {
    await expectNaturalCompletion(host, detachedWorker, 'detached-worker-cleaned');
  });

  it('disposes runtime-owned fibers and scoped layer resources', async () => {
    await expectNaturalCompletion(host, managedRuntimeDisposal, 'managed-runtime-disposed');
  });

  it('preserves original typed failure and defect identity', async () => {
    await expectNaturalCompletion(host, failureIdentity, 'failure-identity-preserved');
  });
});
