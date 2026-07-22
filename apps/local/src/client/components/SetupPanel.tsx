import { useState } from 'react';

import type {
  ConvexBackendMode,
  RuntimeConfig,
  RuntimeConfigDefaults,
} from '../../shared/protocol';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SetupPanel({
  defaults,
  onStart,
}: {
  defaults: RuntimeConfigDefaults | null;
  onStart: (config: RuntimeConfig) => void;
}) {
  const [mode, setMode] = useState<ConvexBackendMode>(defaults?.convexBackendMode ?? 'hosted');
  const [webappPort, setWebappPort] = useState(String(defaults?.webappPort ?? 3000));
  const [convexPort, setConvexPort] = useState(String(defaults?.convexPort ?? 3210));
  const [convexUrl, setConvexUrl] = useState(defaults?.convexUrl ?? 'http://127.0.0.1:3210');

  const handleStart = () => {
    onStart({
      webappPort: Number(webappPort) || 3000,
      convexBackendMode: mode,
      convexPort: Number(convexPort) || 3210,
      convexUrl,
    });
  };

  return (
    <div className="flex h-dvh items-center justify-center bg-chatroom-bg-primary p-8">
      <div className="w-full max-w-md space-y-6">
        <h1 className="text-lg font-bold uppercase tracking-wider text-chatroom-text-primary">
          Chatroom Local Dev
        </h1>
        <p className="text-sm text-chatroom-text-muted">
          Configure the local development stack before starting.
        </p>

        {defaults && (
          <div className="space-y-1 text-xs text-chatroom-text-muted">
            <div>Manager port: {defaults.managerPort}</div>
            {defaults.hostedConvexUrlFromEnv && (
              <div>Detected hosted Convex: {defaults.hostedConvexUrlFromEnv}</div>
            )}
            {defaults.webappPortFromEnv && (
              <div>Detected webapp port: {defaults.webappPortFromEnv}</div>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
              Backend mode
            </label>
            <div className="mt-1 flex gap-2">
              {(['local', 'hosted'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={cn(
                    'flex-1 rounded-none border-2 px-4 py-2 text-sm font-medium uppercase tracking-wider transition-colors',
                    mode === m
                      ? 'border-chatroom-border-strong bg-chatroom-bg-tertiary text-chatroom-text-primary'
                      : 'border-chatroom-border bg-transparent text-chatroom-text-muted hover:bg-chatroom-bg-hover'
                  )}
                  onClick={() => setMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
              Webapp port
            </label>
            <input
              type="number"
              className="mt-1 w-full rounded-none border-2 border-chatroom-border bg-transparent px-3 py-2 text-sm text-chatroom-text-primary outline-none focus:border-chatroom-border-strong"
              value={webappPort}
              onChange={(e) => setWebappPort(e.target.value)}
              min={1024}
              max={65535}
            />
          </div>

          {mode === 'local' ? (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                Convex port
              </label>
              <input
                type="number"
                className="mt-1 w-full rounded-none border-2 border-chatroom-border bg-transparent px-3 py-2 text-sm text-chatroom-text-primary outline-none focus:border-chatroom-border-strong"
                value={convexPort}
                onChange={(e) => setConvexPort(e.target.value)}
                min={1024}
                max={65535}
              />
            </div>
          ) : (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
                Convex URL
              </label>
              <input
                type="text"
                className="mt-1 w-full rounded-none border-2 border-chatroom-border bg-transparent px-3 py-2 text-sm text-chatroom-text-primary outline-none focus:border-chatroom-border-strong"
                value={convexUrl}
                onChange={(e) => setConvexUrl(e.target.value)}
                placeholder="https://*.convex.cloud"
              />
            </div>
          )}
        </div>

        <Button
          variant="default"
          className="w-full rounded-none py-6 text-sm font-bold uppercase tracking-wider"
          onClick={handleStart}
        >
          Start Stack
        </Button>
      </div>
    </div>
  );
}
