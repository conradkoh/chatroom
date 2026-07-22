import type { ConvexBackendMode, RuntimeConfig } from './protocol.js';

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function isValidBackendMode(value: unknown): value is ConvexBackendMode {
  return value === 'local' || value === 'hosted';
}

export function parseRuntimeConfig(raw: unknown): RuntimeConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!isValidBackendMode(data.convexBackendMode)) return null;
  if (!isValidPort(data.webappPort) || !isValidPort(data.convexPort)) return null;
  if (typeof data.convexUrl !== 'string' || data.convexUrl.trim() === '') return null;
  return {
    webappPort: data.webappPort,
    convexBackendMode: data.convexBackendMode,
    convexPort: data.convexPort,
    convexUrl: data.convexUrl.trim(),
  };
}
