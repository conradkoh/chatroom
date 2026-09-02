import { AGENT_HARNESSES } from '@workspace/backend/src/domain/entities/agent.js';

import { cursorSdkSessionMonitor } from './cursor-sdk-session-monitor.js';
import { noOpSessionMonitor } from './no-op-session-monitor.js';
import { getSessionMonitor, registerSessionMonitor } from './session-monitor-registry.js';
import { getAllHarnesses } from '../services/registry.js';

let initialized = false;

/** Populate session monitor registry. Safe to call multiple times (idempotent). */
// fallow-ignore-next-line complexity
export function initSessionMonitorRegistry(): void {
  if (initialized) return;

  for (const harness of AGENT_HARNESSES) {
    registerSessionMonitor(
      harness,
      harness === 'cursor-sdk' ? cursorSdkSessionMonitor : noOpSessionMonitor
    );
  }

  for (const service of getAllHarnesses()) {
    if (!getSessionMonitor(service.id)) {
      registerSessionMonitor(service.id, noOpSessionMonitor);
    }
  }

  initialized = true;
}
