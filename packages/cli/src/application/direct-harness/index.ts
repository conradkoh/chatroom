/**
 * Barrel re-export for the application/direct-harness module.
 */

export { openSession } from './open-session.js';
export type { OpenSessionDeps, OpenSessionOptions, OpenSessionBackend, SessionHandle } from './open-session.js';

export { resumeSession } from './resume-session.js';
export type { ResumeSessionDeps, ResumeSessionOptions } from './resume-session.js';

export { HarnessProcessRegistry } from './get-or-spawn-harness.js';
export type { HarnessProcess, HarnessProcessFactory } from './get-or-spawn-harness.js';
