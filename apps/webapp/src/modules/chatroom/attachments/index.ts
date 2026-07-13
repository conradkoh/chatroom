// Context
/**
 * @see ./ATTACHMENTS_GUIDE.md — end-to-end guide (symlink to backend canonical)
 */
export {
  AttachmentsProvider,
  useAttachments,
  useTaskAttachments,
  useBacklogAttachments,
  useMessageAttachments,
  useSnippetAttachments,
  // fallow-ignore-next-line unused-export
  MAX_ATTACHMENTS,
  // fallow-ignore-next-line unused-type
  type Attachment,
  // fallow-ignore-next-line unused-type
  type TaskAttachment,
  // fallow-ignore-next-line unused-type
  type BacklogAttachment,
  // fallow-ignore-next-line unused-type
  type MessageAttachment,
  // fallow-ignore-next-line unused-type
  type SnippetAttachment,
} from './context/AttachmentsContext';

// Shared read-only
export { MessageAttachmentChips } from './shared/MessageAttachmentChips';
export { countMessageAttachments } from './shared/messageAttachmentUtils';

// Per-type chips (public)
export { AttachedTaskChip } from './task/AttachedTaskChip';
export { AttachedBacklogItemChip } from './backlog/AttachedBacklogItemChip';
export { AttachedMessageChip } from './message/AttachedMessageChip';
export { AttachedSnippetChip } from './snippet/AttachedSnippetChip';

// Snippet compose helpers
export {
  // fallow-ignore-next-line unused-export
  createExplorerSnippetAttachment,
  renderInlineReference,
  // fallow-ignore-next-line unused-type
  type ExplorerSnippetAttachment,
} from './snippet/explorerSelectionAttachment';
export {
  buildExplorerSelectionPrefill,
  dispatchComposerPrefill,
  dispatchComposerTextPrefill,
  subscribeComposerPrefill,
  subscribeComposerTextPrefill,
  PREFILL_TOAST_MESSAGE,
  SAVED_COMMAND_PREFILL_TOAST_MESSAGE,
  // fallow-ignore-next-line unused-type
  type ComposerPrefillDetail,
  // fallow-ignore-next-line unused-type
  type ComposerTextPrefillDetail,
} from './snippet/composerPrefill';
