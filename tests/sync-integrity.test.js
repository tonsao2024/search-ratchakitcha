import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monthKey,
  requiredMonths,
  sourceBytes,
  assertCompleteSource,
  assertMonthCoverage,
  coverageSummary,
  documentKeys,
  matchOcrRow,
  retryDelayMs,
} from '../src/sync-integrity.js';

const bytes = text => new TextEncoder().encode(text);

test('required months include every month from January through the current month', () => {
  assert.equal(monthKey(new Date('2026-10-26T10:00:00Z')), '2026-10');
  assert.equal(monthKey('2026-01'), '2026-01');
  assert.deepEqual(requiredMonths('2026-03'), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(requiredMonths('2026-01'), ['2026-01']);
});

test('rate-limit backoff honours Retry-After seconds and HTTP dates', () => {
  assert.equal(retryDelayMs(null, 0), 500);
  assert.equal(retryDelayMs(null, 3), 4000);
  assert.equal(retryDelayMs('30', 0), 30000);
  const now = Date.parse('2026-10-26T00:00:00Z');
  assert.equal(retryDelayMs('Mon, 26 Oct 2026 00:00:10 GMT', 0, now), 10000);
  assert.equal(retryDelayMs('not-a-date', 2), 2000);
  assert.equal(retryDelayMs('999', 0), 120000);
});
test('source size uses the real LFS size, not the pointer size', () => {
  assert.equal(sourceBytes({ size: 133, lfs: { size: 20024724 } }), 20024724);
  assert.equal(sourceBytes({ size: 1494103 }), 1494103);
  assert.equal(sourceBytes({}), null);
});

test('complete JSONL source keeps exact byte count and tolerates a BOM', () => {
  const text = '\uFEFF{"doctitle":"ประกาศแต่งตั้ง"}\n{"doctitle":"ประกาศ ป.ป.ช."}\n';
  const buffer = bytes(text).buffer;
  const file = { size: bytes(text).byteLength };
  const result = assertCompleteSource(buffer, file, '2026-10');
  assert.equal(result.byteLength, file.size);
  assert.equal(result.lineCount, 2);
  assert.equal(result.expectedBytes, file.size);
  assert.ok(result.text.includes('doctitle'));
});

test('truncated and HTML sources are rejected instead of looking complete', () => {
  const text = '{"doctitle":"ประกาศแต่งตั้ง"}\n';
  assert.throws(() => assertCompleteSource(bytes(text).buffer, { size: bytes(text).byteLength + 10 }, '2026-10'), /incomplete download/);
  assert.throws(() => assertCompleteSource(bytes('<html>error</html>').buffer, { size: bytes('<html>error</html>').byteLength }, '2026-10'), /HTML instead of JSONL/);
  const empty = assertCompleteSource(new ArrayBuffer(0), { size: 0 }, '2026-10');
  assert.equal(empty.lineCount, 0);
});

test('current-year metadata coverage rejects missing and duplicate month files', () => {
  const files = requiredMonths('2026-10').map(month => ({ path: `meta/2026/${month}.jsonl`, type: 'file' }));
  assert.deepEqual(assertMonthCoverage(files, '2026-10').missing, []);
  assert.throws(() => assertMonthCoverage(files.filter(file => !file.path.endsWith('2026-10.jsonl')), '2026-10'), /2026-10/);
  assert.throws(() => assertMonthCoverage([...files, files.at(-1)], '2026-10'), /Duplicate/);
});

test('OCR rows match metadata IDs and PDF filenames', () => {
  const row = { id: '2026-10-01-00046877', pdfFile: '2026-10-01-00046877.pdf' };
  const byKey = new Map(documentKeys(row.id, row.pdfFile).map(key => [key, row]));
  assert.equal(matchOcrRow(byKey, { doc_id: '2026-10-01-00046877', pdf_file: '2026-10-01-00046877.pdf' }), row);
  assert.equal(matchOcrRow(byKey, { doc_id: 'unknown' }), null);
  assert.ok(documentKeys('https://example.test/documents/46877.pdf').includes('46877.pdf'));
});

test('coverage reports current-month presence, gaps and OCR status without inventing completeness', () => {
  const entries = requiredMonths('2026-10').map(month => ({ month, count: 2, byteLength: 100, lineCount: 4, ocrCount: 2, ocrStatus: 'available' }));
  const complete = coverageSummary(entries, '2026-10');
  assert.equal(complete.status, 'complete');
  assert.equal(complete.hasCurrentMonth, true);
  assert.equal(complete.currentMonthCount, 2);
  assert.equal(complete.requiredMonths, 10);
  assert.equal(complete.ocrComplete, true);
  const incomplete = coverageSummary(entries.filter(entry => entry.month !== '2026-10'), '2026-10');
  assert.equal(incomplete.status, 'incomplete');
  assert.deepEqual(incomplete.missingMonths, ['2026-10']);
  const brokenOcr = coverageSummary(entries.map(entry => entry.month === '2026-10' ? { ...entry, ocrStatus: 'unavailable' } : entry), '2026-10');
  assert.equal(brokenOcr.ocrComplete, false);
});
