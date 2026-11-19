/**
 * Integrations CLI Commands — list a chatroom's chat-platform integrations.
 * Read-only. Never prints bot tokens, webhook URLs or webhook secrets.
 */

import type { FunctionReturnType } from 'convex/server';
import { Effect } from 'effect';

import type { IntegrationsDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { createConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import {
  BackendService,
  commandServicesLayerFromDeps,
  requireSessionForChatroomEffect,
  type SessionService,
} from '../../infrastructure/services/index.js';
import { getErrorMessage } from '../../utils/convex-error.js';
import { formatAuthError, formatChatroomIdError } from '../../utils/error-formatting.js';
import { sanitizeForTerminal } from '../../utils/terminal-safety.js';

export type { IntegrationsDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ListIntegrationsOptions {
  chatroomId: string;
  /** Case-insensitive exact match on `platform`. */
  platform?: string | undefined;
  format: 'text' | 'json';
}

export type ListIntegrationsError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'QueryFailed'; readonly cause: Error };

type IntegrationListItem = FunctionReturnType<typeof api.integrations.list>[number];

/** The ONLY fields that may leave this module. Never botToken, webhookUrl or webhookSecret. */
interface IntegrationSummary {
  integrationId: string;
  platform: string;
  name: string | null;
  description: string | null;
  enabled: boolean;
  chatId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Explicit projection (no spread) so a new backend field can never leak by accident. */
function toIntegrationSummary(i: IntegrationListItem): IntegrationSummary {
  return {
    integrationId: i._id,
    platform: i.platform,
    name: i.name ?? null,
    description: i.description ?? null,
    enabled: i.enabled,
    chatId: i.config.chatId ?? null,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

// ─── Effect Programs ───────────────────────────────────────────────────────

// fallow-ignore-next-line unused-export
export const listIntegrationsEffect = (
  options: ListIntegrationsOptions
): Effect.Effect<void, ListIntegrationsError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;
    const sessionId = yield* requireSessionForChatroomEffect({ chatroomId: options.chatroomId });

    const rows = yield* backend
      .query<IntegrationListItem[]>(api.integrations.list, {
        sessionId,
        chatroomId: options.chatroomId as Id<'chatroom_rooms'>,
      })
      .pipe(Effect.mapError((cause): ListIntegrationsError => ({ _tag: 'QueryFailed', cause })));

    // Platform filtering is client-side; the backend receives no new argument.
    const platform = options.platform?.trim().toLowerCase();
    const summaries = (rows ?? [])
      .map(toIntegrationSummary)
      .filter((s) => !platform || s.platform.toLowerCase() === platform);

    yield* Effect.sync(() =>
      options.format === 'json'
        ? console.log(JSON.stringify({ integrations: summaries }, null, 2))
        : printIntegrations(options.chatroomId, platform, summaries)
    );
  });

/** One-row presentation of untrusted text. Presentation only; JSON mode does not use it. */
function singleLine(text: string): string {
  return sanitizeForTerminal(text).replace(/\s+/g, ' ').trim();
}

// fallow-ignore-next-line complexity
function printIntegrations(
  chatroomId: string,
  platform: string | undefined,
  summaries: IntegrationSummary[]
): void {
  const room = singleLine(chatroomId);
  if (summaries.length === 0) {
    const label = platform ? `${singleLine(platform)} integrations` : 'integrations';
    console.log(`No ${label} found for chatroom ${room}.`);
    console.log('💡 Integrations are set up in the web app: chatroom settings → Integrations.');
    return;
  }
  console.log(`Integrations for chatroom ${room} (${summaries.length}):`);
  for (const s of summaries) {
    console.log('');
    console.log(`  ${singleLine(s.integrationId)}`);
    console.log(`    Platform:    ${singleLine(s.platform)}`);
    console.log(`    Name:        ${s.name ? singleLine(s.name) || '(unnamed)' : '(unnamed)'}`);
    console.log(
      `    Description: ${s.description ? singleLine(s.description) || '(none)' : '(none)'}`
    );
    console.log(`    Status:      ${s.enabled ? 'enabled' : 'disabled'}`);
    console.log(`    Chat ID:     ${s.chatId ? singleLine(s.chatId) || '(not set)' : '(not set)'}`);
  }
  console.log('');
  console.log(
    `💡 Send to one: chatroom telegram send-message --chatroom-id=${room} --integration-id=<integration-id> --message="..." --role=<your-role>`
  );
}

// ─── Error Handlers ────────────────────────────────────────────────────────

function handleListIntegrationsError(err: ListIntegrationsError): Effect.Effect<void> {
  return Effect.sync(() => {
    switch (err._tag) {
      case 'NotAuthenticated':
        formatAuthError(err.convexUrl, err.otherUrls);
        break;
      case 'InvalidChatroomId':
        formatChatroomIdError(err.id);
        break;
      case 'QueryFailed':
        console.error(`❌ Failed to list integrations: ${getErrorMessage(err.cause)}`);
        break;
    }
    process.exit(1);
  });
}

// ─── Entry Point ───────────────────────────────────────────────────────────

export async function listIntegrations(
  options: ListIntegrationsOptions,
  deps?: IntegrationsDeps
): Promise<void> {
  const d = deps ?? (await createConvexCommandDeps());
  await Effect.runPromise(
    listIntegrationsEffect(options).pipe(
      Effect.catch((err) => handleListIntegrationsError(err)),
      Effect.provide(commandServicesLayerFromDeps(d))
    )
  );
}
