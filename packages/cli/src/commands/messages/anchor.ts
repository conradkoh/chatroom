/**
 * `messages anchor` — locate the user's last message and print proof-of-verification
 * workflow commands so the entry-point agent can recover all requirements before
 * handing off to the user (even after compaction on long multi-phase tasks).
 */

import { Effect } from 'effect';

import type { MessagesError } from './index.js';
import { api, type Id } from '../../api.js';
import {
  BackendService,
  commandServicesLayerFromDeps,
  requireSessionIdEffect,
  validateChatroomIdEffect,
} from '../../infrastructure/services/index.js';

const PREVIEW_MAX_CHARS = 200;
const DEFAULT_PRIOR_LIMIT = 3;

/** Deterministic output dir so the rg hint below works verbatim after download. */
const ANCHOR_DOWNLOAD_DIR = '.chatroom/downloads/messages/linear/anchor';

export interface AnchorMessagesOptions {
  role: string;
  /** How many prior user messages to include for terse follow-ups (default 3, max 5) */
  priorLimit?: number;
}

type AnchorUserMessage = {
  _id: string;
  _creationTime: number;
  senderRole: string;
  type: string;
  content: string;
  targetRole?: string | null;
  taskStatus?: string | null;
};

type LastUserMessageResult = {
  last: AnchorUserMessage | null;
  prior: AnchorUserMessage[];
};

function previewContent(content: string, maxChars: number = PREVIEW_MAX_CHARS): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars)}…` : collapsed;
}

function formatAnchorTime(creationTime: number): string {
  return new Date(creationTime).toISOString();
}

// fallow-ignore-next-line unused-export
export const anchorMessagesEffect = (chatroomId: string, options: AnchorMessagesOptions) =>
  Effect.gen(function* () {
    // Mirrors sibling messages commands: session + chatroom validation before the query.
    // fallow-ignore-next-line code-duplication
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));
    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    const priorLimit = options.priorLimit ?? DEFAULT_PRIOR_LIMIT;

    const result = yield* backend
      .query<LastUserMessageResult>(api.messages.getLastUserMessage, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        priorLimit,
      })
      .pipe(Effect.mapError((cause): MessagesError => ({ _tag: 'QueryFailed', cause })));

    // fallow-ignore-next-line complexity
    yield* Effect.sync(() => {
      const { last, prior } = result;

      if (!last) {
        console.log(`\n📭 No user messages found in chatroom ${chatroomId}`);
        return;
      }

      console.log(`\n🎯 Last user message anchor:`);
      console.log(`   ID: ${last._id}`);
      console.log(`   Time: ${formatAnchorTime(last._creationTime)}`);
      console.log(`   Content: ${previewContent(last.content)}`);

      if (prior.length > 0) {
        console.log(`\nPrior user messages (context for terse follow-ups):`);
        for (const msg of prior) {
          console.log(
            `   - ${msg._id} (${formatAnchorTime(msg._creationTime)}) — ${previewContent(msg.content)}`
          );
        }
      }

      console.log(`\n✅ Proof of verification workflow:`);
      console.log(
        `   chatroom messages download --chatroom-id=${chatroomId} --role=${options.role} --since-message-id=${last._id} --limit=100 --output-dir=${ANCHOR_DOWNLOAD_DIR}`
      );
      console.log(`   rg "handoff|Goal|Requirements" "${ANCHOR_DOWNLOAD_DIR}/"`);

      console.log(`\n💡 If the download reports truncated=true, increase --limit (e.g. 200, 500).`);
      console.log(`💡 For context before the anchor, download without --since-message-id:`);
      console.log(
        `   chatroom messages download --chatroom-id=${chatroomId} --role=${options.role} --format=linear --limit=200`
      );
      if (prior.length > 0) {
        console.log(
          `\n💡 Terse follow-up (e.g. "do it", "raise a PR")? Review the prior user messages above to recover the full request before validating commits/PRs.`
        );
      }
    });
  });

// Mirrors sibling messages command entry points (auth storage + convex client wiring).
// fallow-ignore-next-line code-duplication
export async function anchorMessages(
  chatroomId: string,
  options: AnchorMessagesOptions,
  deps?: { backend: any; session: any }
): Promise<void> {
  const { getSessionId, getOtherSessionUrls } =
    await import('../../infrastructure/auth/storage.js');
  const { getConvexClient, getConvexUrl } = await import('../../infrastructure/convex/client.js');
  const client = await getConvexClient();
  const actualDeps = deps ?? {
    backend: {
      mutation: (ep: any, args: any) => client.mutation(ep, args),
      query: (ep: any, args: any) => client.query(ep, args),
    },
    session: { getSessionId, getConvexUrl, getOtherSessionUrls },
  };
  const layer = commandServicesLayerFromDeps(actualDeps);

  // Mirrors sibling messages command error handlers.
  // fallow-ignore-next-line code-duplication
  const handler = (err: any): Effect.Effect<void> => {
    return Effect.sync(() => {
      if (err._tag === 'NotAuthenticated') {
        console.error(`❌ Not authenticated`);
        process.exit(1);
      } else if (err._tag === 'InvalidChatroomId') {
        console.error(`❌ Invalid chatroom ID`);
        process.exit(1);
      } else if (err._tag === 'QueryFailed') {
        console.error(`\n❌ Error fetching messages: ${err.cause.message}`);
        process.exit(1);
      } else {
        console.error(`\n❌ Anchor failed: ${err.message}`);
        process.exit(1);
      }
    });
  };

  await Effect.runPromise(
    anchorMessagesEffect(chatroomId, options).pipe(Effect.catchAll(handler), Effect.provide(layer))
  );
}
