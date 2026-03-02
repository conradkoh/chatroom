/** Decodes structured text input from stdin for backend parsing of CLI EOF format content. */

export interface DecodeResult {
  [paramName: string]: string;
}

export interface DecodeOptions {
  /**
   * Expected parameter names (for validation)
   * If provided, will error on unknown parameters
   */
  expectedParams?: string[];

  /**
   * Required parameter names
   * Will error if these are missing
   */
  requiredParams?: string[];

  /**
   * Single parameter mode - treat entire input as one parameter
   * Parameter name to use for the content
   */
  singleParam?: string;
}

export interface DecodeError {
  code: 'UNKNOWN_PARAM' | 'MISSING_PARAM' | 'DUPLICATE_PARAM' | 'INVALID_FORMAT' | 'COLLISION';
  message: string;
  line?: number;
  paramName?: string;
}

/** Trims and returns a single message string from raw stdin content. */
export function decodeMessage(content: string): string {
  return content.trim();
}

/** Decodes multi-parameter stdin content using ---PARAM--- delimiters. */
export function decodeStructured(content: string, params: string[]): DecodeResult {
  return decode(content, {
    expectedParams: params,
    requiredParams: params,
  });
}

/** Decodes structured text input into a parameter map, supporting single-param and multi-param modes. */
export function decode(input: string, options: DecodeOptions = {}): DecodeResult {
  const { singleParam, expectedParams, requiredParams } = options;

  // Single parameter mode - treat entire input as one parameter
  if (singleParam) {
    return { [singleParam]: input.trim() };
  }

  // Multi parameter mode - parse delimited structure
  return decodeMultiParam(input, expectedParams, requiredParams);
}

/**
 * Decode multi-parameter structured input.
 * Internal function for multi-parameter mode.
 */
function decodeMultiParam(
  input: string,
  expectedParams?: string[],
  requiredParams?: string[]
): DecodeResult {
  const lines = input.split('\n');
  const result: DecodeResult = {};
  const seenParams = new Set<string>();

  // Delimiter pattern: ---PARAM_NAME--- on its own line
  const delimiterPattern = /^---([A-Z_]+)---$/;

  let currentParam: string | null = null;
  let currentContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(delimiterPattern);

    if (match) {
      // Found a delimiter
      const paramName = match[1];

      // Save previous parameter content if any
      if (currentParam !== null) {
        const content = currentContent.join('\n').trim();
        result[currentParam] = content;
      }

      // Validate parameter name
      if (expectedParams && !expectedParams.includes(paramName)) {
        throw createDecodeError(
          'UNKNOWN_PARAM',
          `Unknown parameter '${paramName}'. Expected one of: ${expectedParams.join(', ')}`,
          i + 1,
          paramName
        );
      }

      // Check for duplicates
      if (seenParams.has(paramName)) {
        throw createDecodeError(
          'DUPLICATE_PARAM',
          `Duplicate parameter '${paramName}' found at line ${i + 1}`,
          i + 1,
          paramName
        );
      }

      seenParams.add(paramName);
      currentParam = paramName;
      currentContent = [];
    } else {
      // Regular content line
      if (currentParam === null) {
        // Content before first delimiter - invalid format
        if (line.trim().length > 0) {
          throw createDecodeError(
            'INVALID_FORMAT',
            `Content found before first parameter delimiter at line ${i + 1}. Expected format: ---PARAM_NAME---`,
            i + 1
          );
        }
        // Skip empty lines before first delimiter
        continue;
      }
      currentContent.push(line);
    }
  }

  // Save last parameter content
  if (currentParam !== null) {
    const content = currentContent.join('\n').trim();
    result[currentParam] = content;
  }

  // Validate required parameters
  if (requiredParams) {
    for (const required of requiredParams) {
      if (!(required in result)) {
        throw createDecodeError(
          'MISSING_PARAM',
          `Required parameter '${required}' is missing`,
          undefined,
          required
        );
      }
    }
  }

  // Check for empty parameters
  for (const [param, content] of Object.entries(result)) {
    if (content.length === 0) {
      throw createDecodeError(
        'INVALID_FORMAT',
        `Parameter '${param}' is empty. Each parameter must have content.`,
        undefined,
        param
      );
    }
  }

  return result;
}

/**
 * Create a DecodeError object and throw it
 */
function createDecodeError(
  code: DecodeError['code'],
  message: string,
  line?: number,
  paramName?: string
): DecodeError {
  return {
    code,
    message,
    line,
    paramName,
  };
}

/** Returns delimiter patterns found in content that would collide with expected parameter names. */
export function detectDelimiterCollisions(content: string, paramNames: string[]): string[] {
  const collisions: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    for (const param of paramNames) {
      const delimiter = `---${param}---`;
      if (trimmed === delimiter) {
        collisions.push(delimiter);
      }
    }
  }

  return collisions;
}

/**
 * Format a decode error for display to the user
 */
export function formatDecodeError(error: DecodeError): string {
  let message = `❌ ${error.message}`;

  if (error.line) {
    message += `\n   Line: ${error.line}`;
  }

  if (error.code === 'COLLISION') {
    message += `\n\n💡 Workaround: Rephrase the content to avoid having the delimiter pattern on its own line.`;
  }

  if (error.code === 'INVALID_FORMAT') {
    message += `\n\n💡 Expected format:`;
    message += `\n   ---PARAM_NAME---`;
    message += `\n   Parameter content here`;
    message += `\n   ---NEXT_PARAM---`;
    message += `\n   Next parameter content`;
  }

  return message;
}
