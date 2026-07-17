import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';

import { messageExportFilename } from './downloadTextFile';
import { replaceMermaidFencesWithSvg } from './replaceMermaidFencesWithSvg';
import { chatroomRemarkPlugins } from '../../components/chatroomRemarkPlugins';
import { fullMarkdownComponents } from '../../components/markdown-utils';
import type { Message } from '../../types/message';

export async function printMessageAsPdf(message: Message): Promise<void> {
  const withDiagrams = await replaceMermaidFencesWithSvg(message.content);

  const bodyHtml = renderToStaticMarkup(
    <Markdown remarkPlugins={chatroomRemarkPlugins} components={fullMarkdownComponents}>
      {withDiagrams}
    </Markdown>
  );

  const role = message.senderRole ?? 'message';
  const timestamp = new Date(message._creationTime).toLocaleString();

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${messageExportFilename(message, 'pdf')}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #1a1a1a; }
  .export-header { border-bottom: 2px solid #e5e5e5; padding-bottom: 12px; margin-bottom: 20px; font-size: 12px; color: #666; }
  .export-header strong { color: #1a1a1a; }
  .export-content { line-height: 1.6; font-size: 14px; }
  .export-content p { margin: 8px 0; }
  .export-content pre { background: #f5f5f5; padding: 12px; overflow-x: auto; border: 1px solid #e5e5e5; font-size: 13px; }
  .export-content code { background: #f5f5f5; padding: 2px 4px; font-size: 13px; }
  .export-content pre code { background: none; padding: 0; }
  .export-diagram { margin: 16px 0; text-align: center; }
  .export-diagram svg { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #e5e5e5; padding: 6px 10px; text-align: left; font-size: 13px; }
  th { background: #f5f5f5; }
  blockquote { border-left: 3px solid #e5e5e5; margin: 8px 0; padding: 4px 12px; color: #666; }
  img { max-width: 100%; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<div class="export-header">
  <strong>${role}</strong> &mdash; ${timestamp}
</div>
<div class="export-content">
${bodyHtml}
</div>
</body>
</html>`;

  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';

    iframe.onload = () => {
      try {
        const iframeWindow = iframe.contentWindow;
        if (!iframeWindow) {
          reject(new Error('Could not access iframe contentWindow'));
          return;
        }
        iframeWindow.focus();
        iframeWindow.print();
        resolve();
      } catch (err) {
        reject(err);
      }
    };

    document.body.appendChild(iframe);
    iframe.srcdoc = html;
  });
}
