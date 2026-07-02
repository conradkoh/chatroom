import { readStdin } from './stdin.js';

export async function readHeredocOrFileContent(
  options: { contentFile?: string },
  params: {
    delimiter: string;
    fieldLabel: string;
    emptyMessage: string;
    heredocExampleCommand: string;
  }
): Promise<string> {
  let content: string;

  if (options.contentFile) {
    const { readFileContent } = await import('./file-content.js');
    content = readFileContent(options.contentFile, 'content-file');
  } else {
    const stdinContent = await readStdin();
    const { validateStdinHeredocBody } =
      await import('@workspace/backend/prompts/cli/stdin-heredoc.js');
    validateStdinHeredocBody(stdinContent, params.delimiter, params.fieldLabel);
    content = stdinContent;
  }

  if (!content || content.trim().length === 0) {
    console.error(`❌ ${params.emptyMessage}`);
    console.error('');
    console.error('   Example with heredoc:');
    console.error(`   ${params.heredocExampleCommand}`);
    process.exit(1);
  }

  return content;
}
