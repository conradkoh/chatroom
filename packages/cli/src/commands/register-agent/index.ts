/**
 * Register agent type for a chatroom role.
 *
 * Must be called as the agent's first action before get-next-task.
 * Registers the agent as either "remote" (daemon-managed) or "custom" (manually started)
 * in the team agent config on the backend.
 * Phase 6: Migrated to Effect-TS services with typed error handling.
 */

import { Effect, Layer } from 'effect';

import type { RegisterAgentDeps } from './deps.js';
import { RegisterAgentMachineService } from './machine-service.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import { getMachineId, loadMachineConfig } from '../../infrastructure/machine/index.js';
import type { SessionService } from '../../infrastructure/services/index.js';
import {
  BackendService,
  commandServicesLayerFromDeps,
  requireSessionIdEffect,
  validateChatroomIdEffect,
} from '../../infrastructure/services/index.js';
import { getErrorMessage } from '../../utils/convex-error.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { RegisterAgentDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RegisterAgentOptions {
  role: string;
  type: 'remote' | 'custom';
  /**
   * For `type: 'custom'` only — explicit opt-in to switch a role from a
   * machine-bound (remote) config to custom. Required because the switch
   * clears the existing machine binding.
   */
  allowTypeChange?: boolean;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type RegisterAgentError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'InvalidChatroomIdChars' }
  | { readonly _tag: 'ChatroomNotFound'; readonly chatroomId: string }
  | { readonly _tag: 'MachineNotRegistered' }
  | { readonly _tag: 'RegisterFailed'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<RegisterAgentDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: {
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    },
  };
}

/**
 * Build Effect Layer from RegisterAgentDeps (for backward-compat with tests)
 */
function layerFromDeps(
  deps: RegisterAgentDeps
): Layer.Layer<BackendService | SessionService | RegisterAgentMachineService> {
  return Layer.mergeAll(
    commandServicesLayerFromDeps(deps),
    Layer.succeed(RegisterAgentMachineService, {
      getMachineId: () => Effect.promise(() => getMachineId()),
      loadMachineConfig: () => Effect.promise(() => loadMachineConfig()),
    })
  );
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit, no console.error inside.
 */
// fallow-ignore-next-line unused-export complexity
export const registerAgentEffect = (
  chatroomId: string,
  options: RegisterAgentOptions
): Effect.Effect<
  void,
  RegisterAgentError,
  BackendService | SessionService | RegisterAgentMachineService
> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const backend = yield* BackendService;
    const machine = yield* RegisterAgentMachineService;
    const { role, type, allowTypeChange } = options;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    if (!/^[a-zA-Z0-9_]+$/.test(chatroomId)) {
      return yield* Effect.fail<RegisterAgentError>({ _tag: 'InvalidChatroomIdChars' });
    }

    // Validate chatroom exists and user has access
    const chatroom = yield* backend
      .query<{ _id: string } | null>(api.chatrooms.get, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      })
      .pipe(
        Effect.mapError(
          (cause): RegisterAgentError => ({ _tag: 'RegisterFailed', cause: cause as Error })
        )
      );

    if (!chatroom) {
      return yield* Effect.fail<RegisterAgentError>({
        _tag: 'ChatroomNotFound',
        chatroomId,
      });
    }

    if (type === 'remote') {
      // Remote type: emit agent.registered event so the frontend shows the agent as online.
      const machineId = yield* machine.getMachineId();
      if (!machineId) {
        return yield* Effect.fail<RegisterAgentError>({ _tag: 'MachineNotRegistered' });
      }

      const config = yield* machine.loadMachineConfig();

      // Try to record registration (non-critical)
      yield* backend
        .mutation<void>(api.machines.recordRemoteAgentRegistered, {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          machineId,
        })
        .pipe(Effect.catchAll(() => Effect.succeed(undefined))); // Non-critical

      // Print success
      yield* Effect.sync(() => {
        console.log(`✅ Registered as remote agent for role "${role}"`);
        console.log(`   Machine: ${config?.hostname ?? 'unknown'} (${machineId})`);
        console.log(`   Working directory: ${process.cwd()}`);
      });
    } else {
      // Custom type: team config + agent.registered (via dedicated mutation)
      yield* backend
        .mutation<void>(api.machines.recordCustomAgentRegistered, {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          allowTypeChange,
        })
        .pipe(
          Effect.mapError(
            (cause): RegisterAgentError => ({ _tag: 'RegisterFailed', cause: cause as Error })
          )
        );

      // Print success
      yield* Effect.sync(() => {
        console.log(`✅ Registered as custom agent for role "${role}"`);
      });
    }
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 */
// fallow-ignore-next-line complexity
function handleRegisterAgentError(err: RegisterAgentError): Effect.Effect<void> {
  // fallow-ignore-next-line complexity
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      console.error(`❌ Not authenticated for: ${err.convexUrl}`);

      if (err.otherUrls.length > 0) {
        console.error(`\n💡 You have sessions for other environments:`);
        for (const url of err.otherUrls) {
          console.error(`   • ${url}`);
        }
        console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
        console.error(`   CHATROOM_CONVEX_URL=${err.otherUrls[0]} chatroom register-agent ...`);
        console.error(`\n   Or to authenticate for the current environment:`);
      }

      console.error(`   chatroom auth login`);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      console.error(
        `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${err.id?.length || 0})`
      );
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomIdChars') {
      console.error(
        `❌ Invalid chatroom ID format: ID must contain only alphanumeric characters and underscores`
      );
      process.exit(1);
    } else if (err._tag === 'ChatroomNotFound') {
      console.error(`❌ Chatroom ${err.chatroomId} not found or access denied`);
      process.exit(1);
    } else if (err._tag === 'MachineNotRegistered') {
      console.error(`❌ Machine not registered. Run \`chatroom machine start\` first.`);
      process.exit(1);
    } else if (err._tag === 'RegisterFailed') {
      console.error(`❌ Registration failed: ${getErrorMessage(err.cause)}`);
      process.exit(1);
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ──────────────────────

export async function registerAgent(
  chatroomId: string,
  options: RegisterAgentOptions,
  deps?: RegisterAgentDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    registerAgentEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleRegisterAgentError(err)),
      Effect.provide(layer)
    )
  );
}
