import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startDaemon } from './start-daemon.js';

const {
  getConvexWsClient,
  initDaemon,
  startAllSubscribers,
  startLocalWebServer,
  createPersistenceStore,
  createDaemonDeps,
  runFork,
  runPromise,
} = vi.hoisted(() => ({
  getConvexWsClient: vi.fn(),
  initDaemon: vi.fn(),
  startAllSubscribers: vi.fn(),
  startLocalWebServer: vi.fn(),
  createPersistenceStore: vi.fn(),
  createDaemonDeps: vi.fn(),
  runFork: vi.fn(),
  runPromise: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('effect', async (importOriginal) => {
  const actual = (await importOriginal()) as { Effect: object };
  return {
    ...(actual as object),
    Effect: {
      ...actual.Effect,
      runFork,
      runPromise,
    },
  };
});

vi.mock('../../infrastructure/convex/client.js', () => ({
  getConvexWsClient,
}));

vi.mock('./init-daemon.js', () => ({
  initDaemon,
}));

vi.mock('./daemon-runtime.js', () => ({
  createDaemonRuntime: vi.fn(() => ({
    run: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('./daemon-layers.js', async () => {
  const { Layer } = await import('effect');
  return {
    daemonSessionToLayers: vi.fn(() => Layer.empty),
  };
});

vi.mock('./subscriber-registry.js', () => ({
  startAllSubscribers,
}));

vi.mock('../local-web/server/create-local-web-server.js', () => ({
  startLocalWebServer,
}));

vi.mock('../infrastructure/persistence/index.js', () => ({
  createPersistenceStore,
}));

vi.mock('./deps.js', () => ({
  createDaemonDeps,
}));

describe('startDaemon', () => {
  const stopAll = vi.fn().mockResolvedValue(undefined);
  const localWebStop = vi.fn().mockResolvedValue(undefined);
  const persistenceClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    runPromise.mockResolvedValue(undefined);

    const mockWsClient = { onUpdate: vi.fn() };
    getConvexWsClient.mockResolvedValue(mockWsClient);

    initDaemon.mockResolvedValue({
      client: {},
      sessionId: 'session-1',
      machineId: 'machine-1',
    });

    createPersistenceStore.mockReturnValue({ close: persistenceClose });
    createDaemonDeps.mockReturnValue({ streamHub: { publish: vi.fn(), subscribe: vi.fn() } });

    startLocalWebServer.mockResolvedValue({
      port: 18765,
      streamHub: {},
      stop: localWebStop,
    });

    startAllSubscribers.mockReturnValue({ stopAll });
  });

  it('starts subscribers with ws client, session, and machine ids', async () => {
    await startDaemon();

    expect(getConvexWsClient).toHaveBeenCalledOnce();
    expect(startAllSubscribers).toHaveBeenCalledWith(
      expect.objectContaining({
        wsClient: expect.objectContaining({ onUpdate: expect.any(Function) }),
        sessionId: 'session-1',
        machineId: 'machine-1',
        router: expect.objectContaining({
          assignedTask: expect.objectContaining({
            deliverInbound: expect.any(Function),
          }),
          directHarness: expect.objectContaining({
            deliverInbound: expect.any(Function),
          }),
          command: expect.objectContaining({
            deliverInbound: expect.any(Function),
          }),
          workspaceGit: expect.objectContaining({
            deliverInbound: expect.any(Function),
          }),
          file: expect.objectContaining({
            deliverInbound: expect.any(Function),
          }),
          agenticQuery: expect.objectContaining({
            deliverInbound: expect.any(Function),
          }),
          enhancer: expect.objectContaining({
            deliverInbound: expect.any(Function),
          }),
        }),
      })
    );
  });

  it('cleans up subscribers, local web, and persistence on exit', async () => {
    await startDaemon();

    expect(stopAll).toHaveBeenCalledOnce();
    expect(localWebStop).toHaveBeenCalledOnce();
    expect(persistenceClose).toHaveBeenCalledOnce();
  });

  it('resolves persistence path from machine id', async () => {
    await startDaemon();

    expect(createPersistenceStore).toHaveBeenCalledWith(
      expect.stringContaining('machine-1/events.sqlite')
    );
  });
});
