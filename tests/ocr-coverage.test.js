import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMonthCoverage, upstreamOcrIdsFromJsonl } from '../scripts/ocr-coverage.mjs';

test('computeMonthCoverage counts upstream OCR coverage and builds the worklist', () => {
  const meta = [
    { id: 'a', doctitle: 'แต่งตั้ง ก', source_url: 'https://x/a.pdf', pdf_file: 'a.pdf', publishDate: '2026-10-01' },
    { id: 'b', doctitle: 'แต่งตั้ง ข', source_url: 'https://x/b.pdf', pdf_file: 'b.pdf', publishDate: '2026-10-02' },
    { id: 'c', doctitle: 'แต่งตั้ง ค', source_url: 'https://x/c.pdf', pdf_file: 'c.pdf', publishDate: '2026-10-03' },
    { id: 't', doctitle: 'ทดสอบ', is_test: true, source_url: 'https://x/t.pdf' },
    { id: 'nope', doctitle: '' },
  ];
  const coverage = computeMonthCoverage(meta, new Set(['a', 'c.pdf']));
  assert.equal(coverage.total, 3);
  assert.equal(coverage.withOcr, 2);
  assert.equal(coverage.withoutOcr, 1);
  assert.deepEqual(coverage.worklist.map(row => row.id), ['b']);
  assert.equal(coverage.worklist[0].month, '2026-10');
});

test('upstreamOcrIdsFromJsonl keeps only rows with non-empty text', () => {
  const ids = upstreamOcrIdsFromJsonl([
    '{"doc_id":"a","pdf_file":"a.pdf","text":"ข้อความ"}',
    '{"doc_id":"b","pdf_file":"b.pdf","text":"   "}',
    '{"doc_id":"c","text":""}',
    'not-json',
    '',
  ].join('\n'));
  // Both the doc id and the pdf filename are kept so the merge can join on either.
  assert.deepEqual([...ids].sort(), ['a', 'a.pdf']);
});
