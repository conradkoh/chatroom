import type { LocalWebHealth } from '../entities/local-web-health.js';

export function getLocalWebHealth(port: number): LocalWebHealth {
  return { status: 'ok', service: 'v2-local-web', port };
}
