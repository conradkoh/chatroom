import { decodeHtmlEntities } from '@workspace/shared/utilities/markdown';

import { stripHandoffSectionComments } from './handoffSectionContent';

/** Prepare extracted handoff section markdown for react-markdown and mermaid rendering. */
export function prepareHandoffSectionMarkdown(body: string): string {
  const withoutComments = stripHandoffSectionComments(body);
  return decodeHtmlEntities(withoutComments);
}
