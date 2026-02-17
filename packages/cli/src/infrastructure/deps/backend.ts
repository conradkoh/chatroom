/**
 * Backend Operations — shared dependency interface for Convex backend calls.
 *
 * Wraps the Convex client to decouple command handlers from the transport layer.
 * Used across multiple commands for testability via dependency injection.
 */

export interface BackendOps {
  /** Call a Convex mutation */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutation: (endpoint: any, args: any) => Promise<any>;
  /** Call a Convex query */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (endpoint: any, args: any) => Promise<any>;
}
