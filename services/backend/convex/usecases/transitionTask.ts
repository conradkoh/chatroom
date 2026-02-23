/**
 * transitionTask usecase
 *
 * This module is the public API for transitioning task state.
 * It re-exports `transitionTask` from the underlying FSM implementation,
 * making the usecase layer the canonical import path for all callers.
 *
 * Callers should import from this module going forward:
 *   import { transitionTask } from './usecases/transitionTask'
 *
 * The FSM rules, type definitions, and helper functions remain in
 * lib/taskStateMachine.ts as the authoritative implementation.
 */

// Re-export the core transition function as the usecase public API
export { transitionTask } from '../lib/taskStateMachine';

// Re-export the TaskStatus type so callers only need one import path
export type { TaskStatus } from '../lib/taskStateMachine';
