// Pure logic for the local OCR pipeline: text normalization, validity checks,
// source-precedence merging and substring search over locally extracted text.
// Kept dependency-free so both the CLI workers and the Express server can use
// it, and so behaviour is unit-testable without mupdf/tesseract.

// Where a document's searchable text comes from.
export const OCR_SOURCES = {
  upstream: 'upstream', // openlawdata-ocr from the Hugging Face dataset
  textlayer: 'textlayer', // embedded text extracted from the PDF itself
  local: 'local', // OCR (tesseract.js) run in this repository's pipeline
};

// Letters and digits, Thai included (unicode property escapes).
const MEANINGFUL = /[\p{L}\p{N}]/gu;
export function meaningfulChars(text = '') {
  const matches = String(text).match(MEANINGFUL);
  return matches ? matches.length : 0;
}

// Minimum meaningful characters for a document to count as "has text".
// A scanned cover page or a broken extraction yields far less than this.
export const MIN_TEXT_CHARS = 40;

// Normalize extracted/OCR text before storing: drop control characters,
// trim lines, collapse tabs/nbsp runs, squeeze blank lines and trim ends.
export function normalizeOcrText(text = '') {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\t\u00A0 ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isMeaningfulText(text, minChars = MIN_TEXT_CHARS) {
  return meaningfulChars(text) >= minChars;
}

// Join per-page text into one document text, dropping empty pages.
export function joinPages(pages = []) {
  return pages.map(normalizeOcrText).filter(Boolean).join('\n\n');
}

// Parse a local OCR JSONL file strictly (mirrors the dataset import policy:
// a corrupt cache file must fail loudly instead of silently losing text).
export function parseOcrJsonl(text = '') {
  const records = [];
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  lines.forEach((line, index) => {
    try {
      records.push(JSON.parse(line));
    } catch {
      throw Error(`Invalid local OCR JSONL at line ${index + 1}`);
    }
  });
  return records;
}

// Merge precedence: existing (upstream) text always wins; local text fills
// gaps only. Rows that gain local text are tagged with their source so the
// UI can show where the text came from.
export function mergeTextSource(row, local) {
  if (!row) return row;
  if (row.text) return { ...row, textSource: row.textSource || OCR_SOURCES.upstream };
  if (local && typeof local.text === 'string' && local.text.trim()) {
    const textSource = local.source === 'textlayer' ? OCR_SOURCES.textlayer : OCR_SOURCES.local;
    return { ...row, text: normalizeOcrText(local.text), textSource };
  }
  return row;
}

// Match a local record to a row by document id or PDF filename (same key
// semantics as the upstream OCR join: id, pdfFile, URL basename or stem).
export function localRecordKeys(record) {
  const keys = new Set();
  for (const value of [record?.id, record?.pdfFile, record?.source_url, record?.pdf_file]) {
    if (value === null || value === undefined) continue;
    const raw = String(value).trim();
    if (!raw) continue;
    const path = raw.split(/[?#]/)[0];
    const basename = path.split('/').at(-1);
    const stem = basename.replace(/\.pdf$/i, '');
    for (const key of [raw, basename, stem]) if (key) keys.add(key);
  }
  return [...keys];
}

// Merge local OCR records into rows. Returns new rows; never mutates input.
// `rows` without any local records are only tagged with their source.
export function mergeLocalOcr(rows, localRecords) {
  const byKey = new Map();
  for (const record of localRecords || []) {
    if (!record || typeof record.text !== 'string' || !record.text.trim()) continue;
    for (const key of localRecordKeys(record)) if (!byKey.has(key)) byKey.set(key, record);
  }
  const merge = row => {
    if (byKey.has(row.id)) return mergeTextSource(row, byKey.get(row.id));
    if (row.pdfFile && byKey.has(row.pdfFile)) return mergeTextSource(row, byKey.get(row.pdfFile));
    return row;
  };
  return (rows || []).map(merge);
}

// Substring search over local OCR records (Thai has no case; matching is
// literal, which stays robust even when OCR output lacks word spaces).
// Default semantics mirror the app's "AND" mode: every term must be present.
export function searchLocalOcr(records, query, { match = 'all' } = {}) {
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const record of records || []) {
    const text = typeof record?.text === 'string' ? record.text : '';
    if (!text) continue;
    const lower = text.toLowerCase();
    const indexes = terms.map(term => lower.indexOf(term));
    const found = match === 'any' ? indexes.some(index => index >= 0) : indexes.every(index => index >= 0);
    if (found) results.push({ ...record, matchIndex: Math.min(...indexes.filter(index => index >= 0)) });
  }
  return results;
}
