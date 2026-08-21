// RFC 4180 CSV parse/serialize. Pure; used by server export and client import.

export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop fully empty trailing rows
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function serializeCsv(rows: unknown[][], opts: { bom?: boolean; eol?: string } = {}): string {
  const eol = opts.eol ?? '\r\n';
  const body = rows.map((r) => r.map(csvEscape).join(',')).join(eol) + eol;
  return (opts.bom ? '﻿' : '') + body;
}
