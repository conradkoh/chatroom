/**
 * Local API — Public Interface
 *
 * Lightweight HTTP server that exposes daemon information to the webapp
 * when running on the same machine.
 */

export { startLocalApi, LOCAL_API_PORT } from './server.js';
export type { LocalApiHandle } from './server.js';
export type { LocalApiRequest, LocalApiResponse, LocalApiRoute } from './types.js';
