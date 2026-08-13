import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startDaemon } from './start-daemon.js';

const {
  getConvexWsClient,
  getConvexUrl,
  initDaemon,
  startAllSubscribers,
  startLocalWebServer,
  startCliHttpServer,
  createPersistenceStore,
  createDaemonDeps,
  startOutboxDrainWorker,
  createConvexProjectionAdapter,
  runFork,
  runPromise,
} = vi.hoisted(() => ({
  getConvexWsClient: vi.fn(),
  getConvexUrl: vi.fn(),
  initDaemon: vi.fn(),
  startAllSubscribers: vi.fn(),
  startLocalWebServer: vi.fn(),
  startCliHttpServer: vi.fn(() => ({ port: 28766, stop: vi.fn().mockResolvedValue(undefined) })),
  createPersistenceStore: vi.fn(),
  createDaemonDeps: vi.fn(),
  startOutboxDrainWorker: vi.fn(() => ({ stop: vi.fn() })),
  createConvexProjectionAdapter: vi.fn(() => ({
    project: vi.fn(),
    validateProjectable: vi.fn(),
  })),
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
  getConvexUrl,
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

vi.mock('../infrastructure/inbound/local/cli-http-server.js', () => ({
  startCliHttpServer,
}));

vi.mock('../infrastructure/persistence/index.js', () => ({
  createPersistenceStore,
}));

vi.mock('../infrastructure/projection/outbox-drain-worker.js', () => ({
  startOutboxDrainWorker,
}));

vi.mock('../infrastructure/projection/convex/convex-projection-adapter.js', () => ({
  createConvexProjectionAdapter,
}));

vi.mock('./deps.js', () => ({
  createDaemonDeps,
}));

describe('startDaemon', () => {
  const originalConvexUrl = process.env.CHATROOM_CONVEX_URL;
  const originalLocalWebPort = process.env.CHATROOM_LOCAL_WEB_PORT;
  const stopAll = vi.fn().mockResolvedValue(undefined);
  const localWebStop = vi.fn().mockResolvedValue(undefined);
  const persistenceClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    runPromise.mockResolvedValue(undefined);
    getConvexUrl.mockReturnValue('https://chatroom-cloud.duskfare.com');
    delete process.env.CHATROOM_CONVEX_URL;
    delete process.env.CHATROOM_LOCAL_WEB_PORT;

    const mockWsClient = { onUpdate: vi.fn(() => vi.fn()) };
    getConvexWsClient.mockResolvedValue(mockWsClient);

    initDaemon.mockResolvedValue({
      backend: { query: vi.fn().mockResolvedValue([]), mutation: vi.fn().mockResolvedValue(undefined) },
      sessionId: 'session-1',
      machineId: 'machine-1',
    });

    createPersistenceStore.mockReturnValue({ close: persistenceClose, db: {} });
    createDaemonDeps.mockReturnValue({ streamHub: { publish: vi.fn(), subscribe: vi.fn() } });

    startLocalWebServer.mockResolvedValue({
      port: 18765,
      streamHub: {},
      stop: localWebStop,
    });

    startAllSubscribers.mockReturnValue({ stopAll });
  });

  afterEach(() => {
    if (originalConvexUrl === undefined) {
      delete process.env.CHATROOM_CONVEX_URL;
    } else {
      process.env.CHATROOM_CONVEX_URL = originalConvexUrl;
    }
    if (originalLocalWebPort === undefined) {
      delete process.env.CHATROOM_LOCAL_WEB_PORT;
    } else {
      process.env.CHATROOM_LOCAL_WEB_PORT = originalLocalWebPort;
    }
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

  it('does not start outbox drain worker by default', async () => {
    await startDaemon();

    expect(startOutboxDrainWorker).toHaveBeenCalled();
  });

  it('starts the CLI HTTP server bound to localhost', async () => {
    await startDaemon();

    expect(startCliHttpServer).toHaveBeenCalledWith(
      { host: '127.0.0.1', port: expect.any(Number) },
      expect.objectContaining({ dispatch: expect.any(Function) })
    );
  });

  it('starts outbox drain worker when UNCONDITIONAL_CUTOVER is set', async () => {
    process.env.UNCONDITIONAL_CUTOVER = '1';
    try {
      await startDaemon();
    } finally {
      delete process.env.UNCONDITIONAL_CUTOVER;
    }

    expect(startOutboxDrainWorker).toHaveBeenCalledOnce();
    expect(createConvexProjectionAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        machineId: 'machine-1',
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

  it('uses the production local-web port by default', async () => {
    await startDaemon();

    expect(startLocalWebServer).toHaveBeenCalledWith(
      { host: '127.0.0.1', port: 18765 },
      expect.any(Object)
    );
  });

  it('uses the non-production local-web port for a non-production Convex URL', async () => {
    getConvexUrl.mockReturnValue('http://127.0.0.1:3210');

    await startDaemon();

    expect(startLocalWebServer).toHaveBeenCalledWith(
      { host: '127.0.0.1', port: 28765 },
      expect.any(Object)
    );
  });

  it('prefers the explicit local-web port override', async () => {
    getConvexUrl.mockReturnValue('http://127.0.0.1:3210');
    process.env.CHATROOM_LOCAL_WEB_PORT = '12345';

    await startDaemon();

    expect(startLocalWebServer).toHaveBeenCalledWith(
      { host: '127.0.0.1', port: 12345 },
      expect.any(Object)
    );
  });
});
