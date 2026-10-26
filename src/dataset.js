import { classify, DATASET } from './search.js';
import { assertCompleteSource } from './sync-integrity.js';

export function validMonth(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number(month.slice(0, 4)) >= 1858 && Number(month.slice(0, 4)) <= 2100;
}
export function monthUrl(month) {
  if (!validMonth(month)) throw Error('Invalid month');
  return `${DATASET}/raw/main/meta/${month.slice(0, 4)}/${month}.jsonl`;
}
export function normalizeRecord(r) {
  if (r.is_test || typeof r.doctitle !== 'string' || !r.doctitle.trim()) return null;
  const id = String(r.id || r.pdf_file || r.source_url || '');
  if (!id) return null;
  const category = classify(r.doctitle);
  if (category.group === 'other') return null;
  const issuer = r.doctitle.match(/^(?:ประกาศ|ระเบียบ|ข้อบังคับ)(.+?)(?: เรื่อง| ว่าด้วย)/)?.[1] || '';
  return {
    id, title: r.doctitle, date: r.publishDate || '', text: '', issuer,
    volume: r.bookNo || '', part: [r.section, r.category].filter(Boolean).join(' '),
    page: r.pageNo || '', pdf: /^https:\/\//.test(r.source_url || '') ? r.source_url : null,
    pdfFile: r.pdf_file, source: DATASET, ...category,
  };
}
export function parseMonthly(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) throw Error('Empty dataset file');
  const records = lines.map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw Error(`Invalid JSONL at line ${index + 1}`); }
  });
  if (records.some(record => !record || typeof record !== 'object' || !('doctitle' in record) || !('id' in record || 'pdf_file' in record || 'source_url' in record))) {
    throw Error('Unexpected metadata schema');
  }
  const skippedIncomplete = records.filter(record => typeof record.doctitle !== 'string' || !record.doctitle.trim() || !(record.id || record.pdf_file || record.source_url)).length;
  return {
    rows: [...new Map(records.map(normalizeRecord).filter(Boolean).map(row => [row.id, row])).values()],
    scanned: records.length,
    skippedIncomplete,
  };
}
export async function fetchMonth(month, fetcher = fetch) {
  const source = monthUrl(month);
  const response = await fetcher(source, { signal: AbortSignal.timeout(18000), cache: 'no-store' });
  if (!response.ok) throw Error(`Hugging Face HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const contentLength = Number(response.headers.get('content-length'));
  const downloaded = assertCompleteSource(buffer, Number.isFinite(contentLength) && contentLength > 0 ? { size: contentLength } : {}, month);
  const result = downloaded.lineCount ? parseMonthly(downloaded.text) : { rows: [], scanned: 0, skippedIncomplete: 0 };
  const now = new Date().toISOString();
  return {
    ...result, month, source, complete: true, stale: false,
    connectedAt: now, retrievedOn: now.slice(0, 10),
    byteLength: downloaded.byteLength, lineCount: downloaded.lineCount,
  };
}
