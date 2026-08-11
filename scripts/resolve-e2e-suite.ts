#!/usr/bin/env bun
// fallow-ignore-file unused-file
// fallow-ignore-file unused-export

import { TEMPLATE_OWNER_REPO, isTemplateRemote } from './template-repo';
import { TAG_DOWNSTREAM, TAG_UPSTREAM } from '../apps/webapp/tests/e2e/support/tags';

export type E2eSuiteTag = typeof TAG_UPSTREAM | typeof TAG_DOWNSTREAM;

/** Resolve which Playwright tag filter to use for pre-push e2e. */
export function resolveE2eSuiteTag(remoteUrl: string | null | undefined): E2eSuiteTag {
  return isTemplateRemote(remoteUrl) ? TAG_UPSTREAM : TAG_DOWNSTREAM;
}

/** CLI: log decision and print tag to stdout (line 2) for scripting. */
export function runCli(remoteName: string | undefined, remoteUrl: string | undefined): number {
  const tag = resolveE2eSuiteTag(remoteUrl);
  const label = isTemplateRemote(remoteUrl) ? TEMPLATE_OWNER_REPO : (remoteName ?? 'non-template');
  console.log(`[pre-push] e2e: destination "${label}" → suite ${tag}`);
  console.log(tag);
  return 0;
}

if (import.meta.main) {
  process.exit(runCli(process.argv[2], process.argv[3]));
}
