import { convertHtmlToDocx } from 'dom-docx/browser';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';

import { downloadBlobFile, messageExportFilename } from './downloadTextFile';
import { replaceMermaidFencesWithSvg } from './replaceMermaidFencesWithSvg';
import { chatroomRemarkPlugins } from '../../components/chatroomRemarkPlugins';
import { fullMarkdownComponents } from '../../components/markdown-utils';
import type { Message } from '../../types/message';

export async function exportMessageAsDocx(message: Message): Promise<void> {
  const withDiagrams = await replaceMermaidFencesWithSvg(message.content);

  const bodyHtml = renderToStaticMarkup(
    <Markdown remarkPlugins={chatroomRemarkPlugins} components={fullMarkdownComponents}>
      {withDiagrams}
    </Markdown>
  );

  const role = message.senderRole ?? 'message';
  const timestamp = new Date(message._creationTime).toLocaleString();

  const headerHtml = renderToStaticMarkup(
    <div
      style={{
        borderBottom: '2px solid #e5e5e5',
        paddingBottom: 12,
        marginBottom: 20,
        fontSize: 12,
        color: '#666',
      }}
    >
      <strong style={{ color: '#1a1a1a' }}>{role}</strong>
      {' — '}
      {timestamp}
    </div>
  );

  const htmlFragment = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; line-height: 1.6; font-size: 14px;">${headerHtml}${bodyHtml}</div>`;

  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;';
  root.innerHTML = htmlFragment;
  document.body.appendChild(root);

  try {
    const blob = await convertHtmlToDocx(htmlFragment, {
      styleSource: 'inline',
      root,
      rasterizeInPlace: { scale: 2 },
    });
    downloadBlobFile(messageExportFilename(message, 'docx'), blob);
  } finally {
    document.body.removeChild(root);
  }
}
