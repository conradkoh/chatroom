import { afterEach, describe, expect, it } from 'vitest';

import {
  isDaemonOrchestrationP7CutoverEnabled,
  isDaemonOrchestrationP7Enabled,
  isDaemonOrchestrationP8CutoverEnabled,
  isDaemonOrchestrationP8Enabled,
  isDaemonOrchestrationP9ClaimEnabled,
  isDaemonOrchestrationP9Enabled,
  isDaemonOrchestrationP9HandoffEnabled,
  isDaemonOrchestrationP9QueueEnabled,
  isDaemonOrchestrationP9UserMessageEnabled,
} from './feature-flags.js';

const P7 = 'DAEMON_ORCHESTRATION_P7';
const P7_CUTOVER = 'DAEMON_ORCHESTRATION_P7_CUTOVER';
const P8 = 'DAEMON_ORCHESTRATION_P8';
const P8_CUTOVER = 'DAEMON_ORCHESTRATION_P8_CUTOVER';
const P9 = 'DAEMON_ORCHESTRATION_P9';
const P9_USER = 'DAEMON_ORCHESTRATION_P9_USER_MESSAGE';
const P9_QUEUE = 'DAEMON_ORCHESTRATION_P9_QUEUE';
const P9_HANDOFF = 'DAEMON_ORCHESTRATION_P9_HANDOFF';
const P9_CLAIM = 'DAEMON_ORCHESTRATION_P9_CLAIM';
const P9_CUTOVER = 'DAEMON_ORCHESTRATION_P9_CUTOVER';

describe('P7 feature flags', () => {
  afterEach(() => {
    delete process.env[P7];
    delete process.env[P7_CUTOVER];
  });

  it('isDaemonOrchestrationP7Enabled reads DAEMON_ORCHESTRATION_P7', () => {
    expect(isDaemonOrchestrationP7Enabled()).toBe(false);

    process.env[P7] = '1';
    expect(isDaemonOrchestrationP7Enabled()).toBe(true);

    process.env[P7] = 'true';
    expect(isDaemonOrchestrationP7Enabled()).toBe(true);

    process.env[P7] = '0';
    expect(isDaemonOrchestrationP7Enabled()).toBe(false);
  });

  it('isDaemonOrchestrationP7CutoverEnabled reads DAEMON_ORCHESTRATION_P7_CUTOVER', () => {
    expect(isDaemonOrchestrationP7CutoverEnabled()).toBe(false);

    process.env[P7_CUTOVER] = '1';
    expect(isDaemonOrchestrationP7CutoverEnabled()).toBe(true);

    process.env[P7_CUTOVER] = 'true';
    expect(isDaemonOrchestrationP7CutoverEnabled()).toBe(true);

    process.env[P7_CUTOVER] = '0';
    expect(isDaemonOrchestrationP7CutoverEnabled()).toBe(false);
  });
});

describe('P8 feature flags', () => {
  afterEach(() => {
    delete process.env[P8];
    delete process.env[P8_CUTOVER];
  });

  it('isDaemonOrchestrationP8Enabled reads DAEMON_ORCHESTRATION_P8', () => {
    expect(isDaemonOrchestrationP8Enabled()).toBe(false);

    process.env[P8] = '1';
    expect(isDaemonOrchestrationP8Enabled()).toBe(true);

    process.env[P8] = 'true';
    expect(isDaemonOrchestrationP8Enabled()).toBe(true);

    process.env[P8] = '0';
    expect(isDaemonOrchestrationP8Enabled()).toBe(false);
  });

  it('isDaemonOrchestrationP8CutoverEnabled reads DAEMON_ORCHESTRATION_P8_CUTOVER', () => {
    expect(isDaemonOrchestrationP8CutoverEnabled()).toBe(false);

    process.env[P8_CUTOVER] = '1';
    expect(isDaemonOrchestrationP8CutoverEnabled()).toBe(true);

    process.env[P8_CUTOVER] = 'true';
    expect(isDaemonOrchestrationP8CutoverEnabled()).toBe(true);

    process.env[P8_CUTOVER] = '0';
    expect(isDaemonOrchestrationP8CutoverEnabled()).toBe(false);
  });
});

describe('P9 feature flags', () => {
  afterEach(() => {
    delete process.env[P9];
    delete process.env[P9_USER];
    delete process.env[P9_QUEUE];
    delete process.env[P9_HANDOFF];
    delete process.env[P9_CLAIM];
    delete process.env[P9_CUTOVER];
  });

  it('isDaemonOrchestrationP9Enabled reads DAEMON_ORCHESTRATION_P9', () => {
    expect(isDaemonOrchestrationP9Enabled()).toBe(false);
    process.env[P9] = '1';
    expect(isDaemonOrchestrationP9Enabled()).toBe(true);
    process.env[P9] = '0';
    expect(isDaemonOrchestrationP9Enabled()).toBe(false);
  });

  it('sub-flags inherit from P9 umbrella', () => {
    process.env[P9] = '1';
    expect(isDaemonOrchestrationP9UserMessageEnabled()).toBe(true);
    expect(isDaemonOrchestrationP9QueueEnabled()).toBe(true);
    expect(isDaemonOrchestrationP9HandoffEnabled()).toBe(true);
    expect(isDaemonOrchestrationP9ClaimEnabled()).toBe(true);
  });

  it('sub-flags can be enabled individually', () => {
    process.env[P9_USER] = '1';
    expect(isDaemonOrchestrationP9UserMessageEnabled()).toBe(true);
    expect(isDaemonOrchestrationP9QueueEnabled()).toBe(false);
  });
});
