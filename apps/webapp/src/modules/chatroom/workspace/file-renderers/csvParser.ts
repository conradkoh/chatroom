// CSV parser — handles quoted fields, escaped quotes, and mixed line endings

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current);
        current = '';
      } else if (ch === '\n' || ch === '\r') {
        row.push(current);
        current = '';
        if (row.some((c) => c.length > 0)) rows.push(row);
        row = [];
        // Handle \r\n as single newline
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else {
        current += ch;
      }
    }
  }
  row.push(current);
  if (row.some((c) => c.length > 0)) rows.push(row);

  return rows;
}
