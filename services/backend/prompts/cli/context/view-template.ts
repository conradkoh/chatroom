/**
 * Command generator for context view-template CLI command.
 */

import { getContextViewTemplate } from './context-template';

export function viewContextTemplate(): string {
  return getContextViewTemplate();
}

export interface ContextViewTemplateParams {
  /** CLI environment prefix for non-production environments (empty string for production) */
  cliEnvPrefix: string;
}

/** Exact `chatroom context view-template` invocation — no flags. */
export function contextViewTemplateCommand(params: ContextViewTemplateParams): string {
  const prefix = params.cliEnvPrefix || '';
  return `${prefix}chatroom context view-template`;
}
