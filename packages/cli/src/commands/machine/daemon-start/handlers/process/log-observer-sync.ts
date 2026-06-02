/**
 * Log observer sync — re-exports subscription module for spawner and command-loop.
 */

export {
  consumePendingFullSync,
  isRunLogObserved,
  startLogObserverSubscription,
} from './log-observer-subscription.js';
