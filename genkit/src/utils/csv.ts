/**
 * Shared RFC 4180 CSV parser. Handles quoted fields with commas,
 * newlines, and escaped double-quotes. No external dependency needed.
 */
export function parseCSV(content: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip UTF-8 BOM
  const text = content.replace(/^\uFEFF/, '');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuote) {
      if (ch === '"') {
        // Escaped quote ("") or end of quoted field
        if (text[i + 1] === '"') {
          field += '"';
          i++; // skip next quote
        } else {
          inQuote = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
      } else if (ch === '\n') {
        row.push(field.trim());
        field = '';
        if (row.length > 0 && row.some((f) => f !== '')) {
          rows.push(row);
        }
        row = [];
      } else if (ch === '\r') {
        // skip carriage return, newline will follow
      } else {
        field += ch;
      }
    }
  }

  // Flush last field/row
  if (field || row.length > 0) {
    row.push(field.trim());
    if (row.some((f) => f !== '')) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0];
  const dataRows = rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = r[i] ?? '';
    }
    return obj;
  });

  return { headers, rows: dataRows };
}
