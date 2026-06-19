/**
 * Artifact command — create and view artifacts in a chatroom
 *
 * Phase 6b: Migrated to Effect-TS services with typed error handling.
 */

import { Effect, Layer } from 'effect';

import type { ArtifactDeps } from './deps.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import {
  BackendService,
  BackendServiceLive,
  SessionService,
  SessionServiceLive,
} from '../../infrastructure/services/index.js';
import { readFileContent } from '../../utils/file-content.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { ArtifactDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

// fallow-ignore-next-line unused-type
export interface ArtifactCreateOptions {
  chatroomId: string;
  role: string;
  fromFile: string;
  filename: string;
  description?: string;
}

// fallow-ignore-next-line unused-type
export interface ArtifactViewOptions {
  chatroomId: string;
  role: string;
  artifactId: string;
}

// fallow-ignore-next-line unused-type
export interface ArtifactViewManyOptions {
  chatroomId: string;
  role: string;
  artifactIds: string[];
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type ArtifactError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'InvalidFileExtension'; readonly file: string }
  | { readonly _tag: 'FileReadFailed'; readonly file: string; readonly cause: string }
  | { readonly _tag: 'EmptyFile' }
  | { readonly _tag: 'NoArtifactIds' }
  | { readonly _tag: 'ArtifactNotFound'; readonly artifactId: string }
  | { readonly _tag: 'NoArtifactsFound' }
  | { readonly _tag: 'ArtifactOperationFailed'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<ArtifactDeps> {
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
 * Build Effect Layer from ArtifactDeps (for backward-compat with tests)
 */
function layerFromDeps(deps: ArtifactDeps): Layer.Layer<BackendService | SessionService> {
  return Layer.mergeAll(
    BackendServiceLive({
      query: deps.backend.query,
      mutation: deps.backend.mutation,
    }),
    SessionServiceLive({
      getSessionId: deps.session.getSessionId,
      getConvexUrl: deps.session.getConvexUrl,
      getOtherSessionUrls: deps.session.getOtherSessionUrls,
    })
  );
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program for creating artifacts.
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export
export const createArtifactEffect = (
  chatroomId: string,
  options: {
    role: string;
    fromFile: string;
    filename: string;
    description?: string;
  }
): Effect.Effect<string | undefined, ArtifactError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const backend = yield* BackendService;

    // Get Convex URL for authentication
    const convexUrl = yield* session.getConvexUrl();

    // Get session ID for authentication
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      const otherUrls = yield* session.getOtherSessionUrls();
      return yield* Effect.fail<ArtifactError>({
        _tag: 'NotAuthenticated',
        convexUrl,
        otherUrls,
      });
    }

    // Validate chatroom ID format
    if (
      !chatroomId ||
      typeof chatroomId !== 'string' ||
      chatroomId.length < 20 ||
      chatroomId.length > 40
    ) {
      return yield* Effect.fail<ArtifactError>({
        _tag: 'InvalidChatroomId',
        id: chatroomId,
      });
    }

    // Validate file extension
    if (!options.fromFile.endsWith('.md')) {
      return yield* Effect.fail<ArtifactError>({
        _tag: 'InvalidFileExtension',
        file: options.fromFile,
      });
    }

    // Read file content
    const content = yield* Effect.try({
      try: () => readFileContent(options.fromFile, '--from-file'),
      catch: (e) =>
        ({
          _tag: 'FileReadFailed',
          file: options.fromFile,
          cause: e instanceof Error ? e.message : String(e),
        }) satisfies ArtifactError,
    });

    // Validate content is not empty
    if (!content || content.trim().length === 0) {
      return yield* Effect.fail<ArtifactError>({ _tag: 'EmptyFile' });
    }

    // Create artifact
    const artifactId = yield* backend
      .mutation<string>(api.artifacts.create, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        filename: options.filename,
        description: options.description,
        content,
        mimeType: 'text/markdown',
      })
      .pipe(
        Effect.mapError((cause): ArtifactError => ({ _tag: 'ArtifactOperationFailed', cause }))
      );

    // Print success message
    yield* Effect.sync(() => {
      console.log('✅ Artifact created successfully');
      console.log(`📄 Artifact ID: ${artifactId}`);
      console.log(`📁 Filename: ${options.filename}`);
      if (options.description) {
        console.log(`📝 Description: ${options.description}`);
      }
      console.log(`📊 Content size: ${content.length} characters`);
    });

    return artifactId;
  });

/**
 * Pure Effect program for viewing a single artifact.
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export
export const viewArtifactEffect = (
  chatroomId: string,
  options: {
    role: string;
    artifactId: string;
  }
): Effect.Effect<void, ArtifactError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const backend = yield* BackendService;

    // Get Convex URL for authentication
    const convexUrl = yield* session.getConvexUrl();

    // Get session ID for authentication
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      const otherUrls = yield* session.getOtherSessionUrls();
      return yield* Effect.fail<ArtifactError>({
        _tag: 'NotAuthenticated',
        convexUrl,
        otherUrls,
      });
    }

    // Validate chatroom ID format
    if (
      !chatroomId ||
      typeof chatroomId !== 'string' ||
      chatroomId.length < 20 ||
      chatroomId.length > 40
    ) {
      return yield* Effect.fail<ArtifactError>({
        _tag: 'InvalidChatroomId',
        id: chatroomId,
      });
    }

    // Query artifact
    const artifact = yield* backend
      .query<{
        _id: string;
        filename: string;
        version: number;
        createdBy: string;
        createdAt: number;
        content: string;
        description: string | null;
      } | null>(api.artifacts.get, {
        sessionId,
        artifactId: options.artifactId as Id<'chatroom_artifacts'>,
      })
      .pipe(
        Effect.mapError((cause): ArtifactError => ({ _tag: 'ArtifactOperationFailed', cause }))
      );

    if (!artifact) {
      return yield* Effect.fail<ArtifactError>({
        _tag: 'ArtifactNotFound',
        artifactId: options.artifactId,
      });
    }

    // Display artifact information
    yield* Effect.sync(() => {
      console.log(`📄 Artifact: ${artifact.filename}`);
      console.log(`🆔 ID: ${artifact._id}`);
      console.log(`📊 Version: ${artifact.version}`);
      console.log(`👤 Created by: ${artifact.createdBy}`);
      console.log(`📅 Created: ${new Date(artifact.createdAt).toLocaleString()}`);

      if (artifact.description) {
        console.log(`📝 Description: ${artifact.description}`);
      }

      console.log('─'.repeat(50));
      console.log(artifact.content);
      console.log('─'.repeat(50));
    });
  });

/**
 * Pure Effect program for viewing multiple artifacts.
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export
export const viewManyArtifactsEffect = (
  chatroomId: string,
  options: {
    role: string;
    artifactIds: string[];
  }
): Effect.Effect<void, ArtifactError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const backend = yield* BackendService;

    // Get Convex URL for authentication
    const convexUrl = yield* session.getConvexUrl();

    // Get session ID for authentication
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      const otherUrls = yield* session.getOtherSessionUrls();
      return yield* Effect.fail<ArtifactError>({
        _tag: 'NotAuthenticated',
        convexUrl,
        otherUrls,
      });
    }

    // Validate chatroom ID format
    if (
      !chatroomId ||
      typeof chatroomId !== 'string' ||
      chatroomId.length < 20 ||
      chatroomId.length > 40
    ) {
      return yield* Effect.fail<ArtifactError>({
        _tag: 'InvalidChatroomId',
        id: chatroomId,
      });
    }

    if (options.artifactIds.length === 0) {
      return yield* Effect.fail<ArtifactError>({ _tag: 'NoArtifactIds' });
    }

    // Query artifacts
    const artifacts = yield* backend
      .query<
        {
          _id: string;
          filename: string;
          version: number;
          createdBy: string;
          createdAt: number;
          content: string;
          description: string | null;
        }[]
      >(api.artifacts.getMany, {
        sessionId,
        artifactIds: options.artifactIds as Id<'chatroom_artifacts'>[],
      })
      .pipe(
        Effect.mapError((cause): ArtifactError => ({ _tag: 'ArtifactOperationFailed', cause }))
      );

    if (artifacts.length === 0) {
      return yield* Effect.fail<ArtifactError>({ _tag: 'NoArtifactsFound' });
    }

    // Display each artifact
    yield* Effect.sync(() => {
      artifacts.forEach((artifact, index: number) => {
        if (index > 0) {
          console.log('\n' + '='.repeat(60) + '\n');
        }

        console.log(`📄 Artifact ${index + 1}: ${artifact.filename}`);
        console.log(`🆔 ID: ${artifact._id}`);
        console.log(`📊 Version: ${artifact.version}`);
        console.log(`👤 Created by: ${artifact.createdBy}`);
        console.log(`📅 Created: ${new Date(artifact.createdAt).toLocaleString()}`);

        if (artifact.description) {
          console.log(`📝 Description: ${artifact.description}`);
        }

        console.log('─'.repeat(50));
        console.log(artifact.content);
        console.log('─'.repeat(50));
      });
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
function handleArtifactError(err: ArtifactError): Effect.Effect<void> {
  return Effect.sync(() => {
    const handler = artifactErrorHandlers[err._tag];
    if (handler) handler(err);
  });
}

const artifactErrorHandlers: Record<string, (err: ArtifactError) => void> = {
  NotAuthenticated: (err) => {
    const e = err as Extract<ArtifactError, { _tag: 'NotAuthenticated' }>;
    console.error(`❌ Not authenticated for: ${e.convexUrl}`);
    if (e.otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of e.otherUrls) {
        console.error(`   • ${url}`);
      }
      console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
      console.error(`   CHATROOM_CONVEX_URL=${e.otherUrls[0]} chatroom artifact ...`);
      console.error(`\n   Or to authenticate for the current environment:`);
    }
    console.error(`   chatroom auth login`);
    process.exit(1);
  },
  InvalidChatroomId: (err) => {
    const e = err as Extract<ArtifactError, { _tag: 'InvalidChatroomId' }>;
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${e.id?.length || 0})`
    );
    process.exit(1);
  },
  InvalidFileExtension: (err) => {
    const e = err as Extract<ArtifactError, { _tag: 'InvalidFileExtension' }>;
    console.error(`❌ Invalid file extension: ${e.file}`);
    console.error(`   Only *.md files are supported`);
    process.exit(1);
  },
  FileReadFailed: (err) => {
    const e = err as Extract<ArtifactError, { _tag: 'FileReadFailed' }>;
    console.error(`❌ Failed to read file for --from-file: ${e.file}`);
    console.error(`   Reason: ${e.cause}`);
    process.exit(1);
  },
  EmptyFile: () => {
    console.error(`❌ File is empty`);
    process.exit(1);
  },
  NoArtifactIds: () => {
    console.error(`❌ No artifact IDs provided`);
    console.error(
      `   Usage: chatroom artifact view-many <chatroomId> --artifact=id1 --artifact=id2`
    );
    process.exit(1);
  },
  ArtifactNotFound: (err) => {
    const e = err as Extract<ArtifactError, { _tag: 'ArtifactNotFound' }>;
    console.error(`❌ Artifact not found`);
    console.error(`   Artifact ID: ${e.artifactId}`);
    console.error(`   Please create an artifact first:`);
    console.error(`   chatroom artifact create <chatroomId> --from-file=... --filename=...`);
    process.exit(1);
  },
  NoArtifactsFound: () => {
    console.error(`❌ No artifacts found`);
    process.exit(1);
  },
  ArtifactOperationFailed: (err) => {
    const e = err as Extract<ArtifactError, { _tag: 'ArtifactOperationFailed' }>;
    console.error(`❌ Failed to perform artifact operation`);
    console.error(`   Error: ${e.cause.message || String(e.cause)}`);
    process.exit(1);
  },
};

// ─── Entry Point (public API — unchanged signature) ──────────────────────

/**
 * Create a new artifact from a file
 */
export async function createArtifact(
  chatroomId: string,
  options: {
    role: string;
    fromFile: string;
    filename: string;
    description?: string;
  },
  deps?: ArtifactDeps
): Promise<string | undefined> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  return Effect.runPromise(
    createArtifactEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleArtifactError(err).pipe(Effect.map(() => undefined))),
      Effect.provide(layer)
    )
  );
}

/**
 * View a single artifact
 */
export async function viewArtifact(
  chatroomId: string,
  options: {
    role: string;
    artifactId: string;
  },
  deps?: ArtifactDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    viewArtifactEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleArtifactError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * View multiple artifacts
 */
export async function viewManyArtifacts(
  chatroomId: string,
  options: {
    role: string;
    artifactIds: string[];
  },
  deps?: ArtifactDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    viewManyArtifactsEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleArtifactError(err)),
      Effect.provide(layer)
    )
  );
}
