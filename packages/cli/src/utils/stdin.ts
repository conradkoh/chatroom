/**
 * Read content from stdin.
 * Returns the full stdin content as a string.
 */
export async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    process.stdin.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    process.stdin.on('error', (err) => {
      reject(new Error(`Failed to read stdin: ${err.message}`));
    });
  });
}
