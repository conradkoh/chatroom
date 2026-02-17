import type { ArtifactDeps } from './deps.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import {
  formatError,
  formatAuthError,
  formatChatroomIdError,
  formatFileError,
  formatValidationError,
} from '../../utils/error-formatting.js';
import { readFileContent } from '../../utils/file-content.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { ArtifactDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ArtifactCreateOptions {
  chatroomId: string;
  role: string;
  fromFile: string;
  filename: string;
  description?: string;
}

export interface ArtifactViewOptions {
  chatroomId: string;
  role: string;
  artifactId: string;
}

export interface ArtifactViewManyOptions {
  chatroomId: string;
  role: string;
  artifactIds: string[];
}

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

// ─── Commands ──────────────────────────────────────────────────────────────

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
) {
  const d = deps ?? (await createDefaultDeps());

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    formatAuthError(d.session.getConvexUrl(), d.session.getOtherSessionUrls());
    process.exit(1);
    return;
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    formatChatroomIdError(chatroomId);
    process.exit(1);
    return;
  }

  // Validate file extension
  if (!options.fromFile.endsWith('.md')) {
    formatValidationError('file extension', options.fromFile, '*.md');
    process.exit(1);
    return;
  }

  // Read file content
  let content: string;
  try {
    content = readFileContent(options.fromFile, '--from-file');
  } catch (err) {
    formatFileError('read for --from-file', options.fromFile, (err as Error).message);
    process.exit(1);
    return;
  }

  // Validate content is not empty
  if (!content || content.trim().length === 0) {
    formatError('File is empty');
    process.exit(1);
    return;
  }

  try {
    const artifactId = await d.backend.mutation(api.artifacts.create, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      filename: options.filename,
      description: options.description,
      content,
      mimeType: 'text/markdown',
    });

    console.log('✅ Artifact created successfully');
    console.log(`📄 Artifact ID: ${artifactId}`);
    console.log(`📁 Filename: ${options.filename}`);
    if (options.description) {
      console.log(`📝 Description: ${options.description}`);
    }
    console.log(`📊 Content size: ${content.length} characters`);

    return artifactId;
  } catch (error) {
    formatError('Failed to create artifact', [String(error)]);
    process.exit(1);
    return;
  }
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
) {
  const d = deps ?? (await createDefaultDeps());

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    formatAuthError(d.session.getConvexUrl(), d.session.getOtherSessionUrls());
    process.exit(1);
    return;
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    formatChatroomIdError(chatroomId);
    process.exit(1);
    return;
  }

  try {
    const artifact = await d.backend.query(api.artifacts.get, {
      sessionId,
      artifactId: options.artifactId as Id<'chatroom_artifacts'>,
    });

    if (!artifact) {
      formatError('Artifact not found', [
        `Artifact ID: ${options.artifactId}`,
        'Please create an artifact first:',
        `chatroom artifact create ${chatroomId} --from-file=... --filename=...`,
      ]);
      process.exit(1);
      return;
    }

    // Display artifact information
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
  } catch (error) {
    formatError('Failed to view artifact', [String(error)]);
    process.exit(1);
    return;
  }
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
) {
  const d = deps ?? (await createDefaultDeps());

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    formatAuthError(d.session.getConvexUrl(), d.session.getOtherSessionUrls());
    process.exit(1);
    return;
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    formatChatroomIdError(chatroomId);
    process.exit(1);
    return;
  }

  if (options.artifactIds.length === 0) {
    formatError('No artifact IDs provided', [
      'Usage: chatroom artifact view-many <chatroomId> --artifact=id1 --artifact=id2',
    ]);
    process.exit(1);
    return;
  }

  try {
    const artifacts = await d.backend.query(api.artifacts.getMany, {
      sessionId,
      artifactIds: options.artifactIds as Id<'chatroom_artifacts'>[],
    });

    if (artifacts.length === 0) {
      formatError('No artifacts found');
      process.exit(1);
      return;
    }

    // Display each artifact
    artifacts.forEach((artifact: any, index: number) => {
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
  } catch (error) {
    formatError('Failed to view artifacts', [String(error)]);
    process.exit(1);
    return;
  }
}
