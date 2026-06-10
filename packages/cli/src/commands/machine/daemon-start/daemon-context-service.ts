/**
 * DaemonContextService — Effect Context.Tag wrapping the existing DaemonContext.
 *
 * This is the adapter that lets Effect programs access daemon state without
 * changing the existing DaemonContext or DaemonDeps structure.
 */

import { Context } from 'effect';

import type { DaemonContext } from './types.js';

export class DaemonContextService extends Context.Tag('DaemonContextService')<
  DaemonContextService,
  DaemonContext
>() {}
