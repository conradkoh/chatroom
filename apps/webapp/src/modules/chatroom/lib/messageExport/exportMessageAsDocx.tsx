import { convertHtmlToDocx } from 'dom-docx/browser';

import {
  buildMarkdownExportDom,
  offscreenExportRootStyle,
  type MarkdownExportHeader,
} from './buildMarkdownExportDom';
import { getDownloadFormat } from './downloadFormats';
import {
  messageExportFilename,
  promptSaveFile,
  writeBlobToSaveTarget,
  type SaveFileResult,
} from './downloadTextFile';
import type { Message } from '../../types/message';

/**
 * Exports markdown as a DOCX. The save prompt runs first so the native file picker keeps
 * the user gesture, then the document is generated and written to the chosen target.
 * Without `header` the document is the body only (file exports); with it, the chat header.
 */
export async function exportMarkdownAsDocx(args: {
  markdown: string;
  suggestedName: string;
  header?: MarkdownExportHeader;
}): Promise<SaveFileResult> {
  const definition = getDownloadFormat('docx');
  const saveTarget = await promptSaveFile(args.suggestedName, {
    mimeType: definition.mimeType,
    extensions: [definition.extension],
    description: definition.saveDescription,
  });
  if (saveTarget.kind === 'cancelled') {
    return 'cancelled';
  }

  const { htmlFragment, root } = await buildMarkdownExportDom(
    { markdown: args.markdown, header: args.header },
    offscreenExportRootStyle('visibility:hidden;')
  );
  document.body.appendChild(root);

  try {
    const blob = await convertHtmlToDocx(htmlFragment, {
      styleSource: 'computed',
      root,
      rasterizeInPlace: { scale: 2 },
    });
    return writeBlobToSaveTarget(saveTarget, args.suggestedName, blob);
  } finally {
    document.body.removeChild(root);
  }
}

/** Chat export: same pipeline with the message header and the `chatroom-<role>-<ts>` name. */
export async function exportMessageAsDocx(message: Message): Promise<SaveFileResult> {
  return exportMarkdownAsDocx({
    markdown: message.content,
    suggestedName: messageExportFilename(message, 'docx'),
    header: {
      label: message.senderRole ?? 'message',
      timestamp: new Date(message._creationTime).toLocaleString(),
    },
  });
}
