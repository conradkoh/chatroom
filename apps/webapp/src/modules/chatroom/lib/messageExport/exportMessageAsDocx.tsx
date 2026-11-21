import { convertHtmlToDocx } from 'dom-docx/browser';

import { buildMessageExportDom } from './buildMessageExportDom';
import {
  messageExportFilename,
  promptSaveFile,
  writeBlobToSaveTarget,
  type SaveFileResult,
} from './downloadTextFile';
import type { Message } from '../../types/message';

export async function exportMessageAsDocx(message: Message): Promise<SaveFileResult> {
  const suggestedName = messageExportFilename(message, 'docx');
  const saveTarget = await promptSaveFile(suggestedName, {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['.docx'],
    description: 'Word Document',
  });
  if (saveTarget.kind === 'cancelled') {
    return 'cancelled';
  }

  const { htmlFragment, root } = await buildMessageExportDom(
    message,
    'position:fixed;left:-9999px;top:0;width:816px;visibility:hidden;pointer-events:none;'
  );
  document.body.appendChild(root);

  try {
    const blob = await convertHtmlToDocx(htmlFragment, {
      styleSource: 'computed',
      root,
      rasterizeInPlace: { scale: 2 },
    });
    return writeBlobToSaveTarget(saveTarget, suggestedName, blob);
  } finally {
    document.body.removeChild(root);
  }
}
