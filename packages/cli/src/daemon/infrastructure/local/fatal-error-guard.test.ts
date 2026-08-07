import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('installDaemonFatalErrorGuard', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('logs unhandled rejections without rethrowing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const proc = new EventEmitter() as EventEmitter & { on: NodeJS.Process['on'] };

    vi.stubGlobal('process', proc);

    const { installDaemonFatalErrorGuard } = await import('./fatal-error-guard.js');
    installDaemonFatalErrorGuard();

    const rejection = new Error('stream auth failed');
    proc.emit('unhandledRejection', rejection);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[daemon] Unhandled promise rejection')
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('stream auth failed'));

    errorSpy.mockRestore();
  });

  it('is idempotent when called multiple times', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const proc = new EventEmitter() as EventEmitter & { on: NodeJS.Process['on'] };

    vi.stubGlobal('process', proc);

    const { installDaemonFatalErrorGuard } = await import('./fatal-error-guard.js');
    installDaemonFatalErrorGuard();
    installDaemonFatalErrorGuard();

    proc.emit('unhandledRejection', new Error('once'));

    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });
});
