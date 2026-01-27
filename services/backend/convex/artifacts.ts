import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';

// Generate a UUID for artifact group IDs
function generateArtifactGroupId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Create a new artifact
 */
export const create = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    filename: v.string(),
    description: v.optional(v.string()),
    content: v.string(),
    mimeType: v.optional(v.string()), // Defaults to 'text/markdown'
  },
  handler: async (ctx, args) => {
    const artifactGroupId = generateArtifactGroupId();

    const artifactId = await ctx.db.insert('chatroom_artifacts', {
      chatroomId: args.chatroomId,
      artifactGroupId,
      filename: args.filename,
      description: args.description,
      mimeType: args.mimeType ?? 'text/markdown',
      content: args.content,
      version: 1,
      isLatest: true,
      createdBy: args.sessionId,
      createdAt: Date.now(),
    });

    return artifactId;
  },
});

/**
 * Create a new version of an existing artifact
 */
export const update = mutation({
  args: {
    ...SessionIdArg,
    artifactId: v.id('chatroom_artifacts'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get('chatroom_artifacts', args.artifactId);
    if (!existing) {
      throw new Error('Artifact not found');
    }

    // Mark the previous version as not latest
    await ctx.db.patch('chatroom_artifacts', args.artifactId, { isLatest: false });

    // Create new version
    const newVersionId = await ctx.db.insert('chatroom_artifacts', {
      chatroomId: existing.chatroomId,
      artifactGroupId: existing.artifactGroupId,
      filename: existing.filename,
      description: existing.description,
      mimeType: existing.mimeType,
      content: args.content,
      version: existing.version + 1,
      isLatest: true,
      previousVersionId: args.artifactId,
      createdBy: args.sessionId,
      createdAt: Date.now(),
    });

    return newVersionId;
  },
});

/**
 * Get a single artifact by ID (returns latest version)
 */
export const get = query({
  args: {
    ...SessionIdArg,
    artifactId: v.id('chatroom_artifacts'),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get('chatroom_artifacts', args.artifactId);
    if (!artifact) {
      return null;
    }

    // If this isn't the latest version, get the latest one
    if (!artifact.isLatest) {
      const latest = await ctx.db
        .query('chatroom_artifacts')
        .withIndex('by_group_latest', (q) =>
          q.eq('artifactGroupId', artifact.artifactGroupId).eq('isLatest', true)
        )
        .first();
      return latest || artifact;
    }

    return artifact;
  },
});

/**
 * Get multiple artifacts by IDs
 */
export const getMany = query({
  args: {
    ...SessionIdArg,
    artifactIds: v.array(v.id('chatroom_artifacts')),
  },
  handler: async (ctx, args) => {
    const artifacts = await Promise.all(
      args.artifactIds.map(async (id) => {
        const artifact = await ctx.db.get('chatroom_artifacts', id);
        if (!artifact) {
          return null;
        }

        // If this isn't the latest version, get the latest one
        if (!artifact.isLatest) {
          const latest = await ctx.db
            .query('chatroom_artifacts')
            .withIndex('by_group_latest', (q) =>
              q.eq('artifactGroupId', artifact.artifactGroupId).eq('isLatest', true)
            )
            .first();
          return latest || artifact;
        }

        return artifact;
      })
    );

    return artifacts.filter(
      (artifact): artifact is NonNullable<typeof artifact> => artifact !== null
    );
  },
});

/**
 * List all artifacts in a chatroom
 */
export const listByChatroom = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const artifacts = await ctx.db
      .query('chatroom_artifacts')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter to only return latest versions
    return artifacts.filter((artifact) => artifact.isLatest);
  },
});

/**
 * Get all versions of an artifact
 */
export const getVersions = query({
  args: {
    ...SessionIdArg,
    artifactGroupId: v.string(),
  },
  handler: async (ctx, args) => {
    const versions = await ctx.db
      .query('chatroom_artifacts')
      .withIndex('by_group_latest', (q) => q.eq('artifactGroupId', args.artifactGroupId))
      .collect();

    return versions.sort((a, b) => b.version - a.version);
  },
});

/**
 * Validate that artifact IDs exist and are accessible
 */
export const validateArtifactIds = query({
  args: {
    ...SessionIdArg,
    artifactIds: v.array(v.id('chatroom_artifacts')),
  },
  handler: async (ctx, args) => {
    const artifacts = await Promise.all(
      args.artifactIds.map(async (id) => {
        const artifact = await ctx.db.get('chatroom_artifacts', id);
        return artifact !== null;
      })
    );

    return artifacts.every(Boolean);
  },
});
