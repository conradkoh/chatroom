import { Context, Layer } from 'effect';

import type { HandoffGatewayOps } from '../../commands/handoff/deps.js';

export class CliGatewayService extends Context.Service<CliGatewayService, HandoffGatewayOps>()(
  'CliGatewayService'
) {}

export const CliGatewayServiceLive = (gateway: HandoffGatewayOps): Layer.Layer<CliGatewayService> =>
  Layer.succeed(CliGatewayService, {
    handoff: (args) => gateway.handoff(args),
  });
