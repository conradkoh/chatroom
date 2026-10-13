import { z } from 'zod';

/**
 * Durable wire schema for one workspace-state unit.
 *
 * The six git-state kinds mirror `workspaceGitStateUnitValidator` in
 * `services/backend/src/domain/entities/workspace-git-state-unit.ts` field for field.
 * `recentCommits` and `commands` are CLI-side kinds whose fields match the args of
 * `upsertRecentCommits` and `syncCommands`.
 *
 * Constraint: every object is strict so an unknown field from an older or newer
 * serialized payload fails parsing (and is quarantined) instead of being silently dropped.
 */

const diffStatSchema = z.strictObject({
  filesChanged: z.number(),
  insertions: z.number(),
  deletions: z.number(),
});

const commitStatusSchema = z.strictObject({
  state: z.string(),
  checkRuns: z.array(
    z.strictObject({
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
    })
  ),
  totalCount: z.number(),
});

const commitSchema = z.strictObject({
  sha: z.string(),
  shortSha: z.string(),
  message: z.string(),
  // exactOptional matches Convex v.optional under exactOptionalPropertyTypes (no `| undefined`).
  body: z.exactOptional(z.string()),
  author: z.string(),
  date: z.string(),
});

const commandSchema = z.strictObject({
  name: z.string(),
  script: z.string(),
  source: z.enum(['package.json', 'turbo.json', 'deno.json', 'Makefile']),
  subWorkspace: z.exactOptional(
    z.strictObject({
      type: z.string(),
      path: z.string(),
      name: z.string(),
    })
  ),
});

/**
 * `head` has three shapes distinguished by `status`. Zod rejects duplicate
 * discriminator values inside one `discriminatedUnion`, so `head` is its own
 * union and is joined to the `kind` union below.
 */
const headUnitSchema = z.discriminatedUnion('status', [
  z.strictObject({ kind: z.literal('head'), status: z.literal('available'), branch: z.string() }),
  z.strictObject({ kind: z.literal('head'), status: z.literal('not_found') }),
  z.strictObject({ kind: z.literal('head'), status: z.literal('error'), errorMessage: z.string() }),
]);

const kindUnitSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('worktree'),
    isDirty: z.boolean(),
    diffStat: diffStatSchema,
  }),
  z.strictObject({
    kind: z.literal('upstream'),
    commitsAhead: z.number(),
    commitsBehind: z.number(),
  }),
  z.strictObject({
    kind: z.literal('remotes'),
    remotes: z.array(z.strictObject({ name: z.string(), url: z.string() })),
  }),
  z.strictObject({
    kind: z.literal('pullRequests'),
    openPullRequests: z.array(
      z.strictObject({
        prNumber: z.number(),
        title: z.string(),
        url: z.string(),
        headRefName: z.string(),
        state: z.string(),
      })
    ),
  }),
  z.strictObject({
    kind: z.literal('checks'),
    headCommitStatus: commitStatusSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal('recentCommits'),
    commits: z.array(commitSchema),
    hasMoreCommits: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('commands'),
    commands: z.array(commandSchema),
  }),
]);

export const workspaceStateUnitSchema = z.union([headUnitSchema, kindUnitSchema]);

export type WorkspaceStateUnit = z.infer<typeof workspaceStateUnitSchema>;
