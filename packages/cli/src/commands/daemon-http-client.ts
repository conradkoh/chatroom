import { resolveCliHttpPort } from '../daemon/entry/resolve-cli-http-port.js';

/** Shared HTTP helpers for daemon CLI HTTP server clients (P3/P6). */
export async function postDaemonJson(path: string, body: unknown): Promise<unknown> {
  const port = resolveCliHttpPort();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function getDaemonJson(path: string): Promise<unknown> {
  const port = resolveCliHttpPort();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'GET' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Daemon request failed (${res.status})`);
  }
  return res.json();
}
