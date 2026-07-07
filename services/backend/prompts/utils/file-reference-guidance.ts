/**
 * File reference format guidance for handoff Proof of Completion sections.
 * Paths written this way auto-linkify in the workspace UI (PR #854).
 */

/** HTML comment instructing agents how to write clickable file paths. */
export function getFileReferenceGuidanceComment(): string {
  return `<!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->`;
}

/** Guidance comment + example line for Proof of Completion file lists. */
export function getFileReferenceProofOfCompletionExample(): string {
  return `${getFileReferenceGuidanceComment()}
- \`apps/webapp/src/path/to/file.ts\` — <what changed and why>`;
}
