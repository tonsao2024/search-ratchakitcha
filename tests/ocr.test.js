import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OCR_SOURCES, meaningfulChars, MIN_TEXT_CHARS, normalizeOcrText, isMeaningfulText,
  joinPages, parseOcrJsonl, mergeTextSource, mergeLocalOcr, searchLocalOcr,
} from '../src/ocr.js';

test('meaningfulChars counts Thai letters and digits, ignores punctuation and tone marks', () => {
  // สรรหา (sarn ha, "to select") — five base letters, written with explicit
  // code points so the assertion is stable.
  const thai = '\u0E2A\u0E23\u0E23\u0E2B\u0E42\u0E2B';
  assert.equal(meaningfulChars(''), 0);
  assert.equal(meaningfulChars('2569'), 4);
  // Thai dependent vowels (e.g. U+E42) are Letters in Unicode, so every code
  // point here counts.
  assert.equal(meaningfulChars(thai), 6);
  assert.equal(meaningfulChars(`${thai} 2569`), 10);
  assert.equal(meaningfulChars('---…'), 0);
});

test('normalizeOcrText trims lines, collapses blanks and strips control chars', () => {
  assert.equal(normalizeOcrText('  a  b  \n\n\n\n c \u0007'), 'a b\n\nc');
  assert.equal(normalizeOcrText('a\u00A0\u00A0b\tc'), 'a b c');
  assert.equal(normalizeOcrText(''), '');
});

test('isMeaningfulText uses the configurable threshold', () => {
  assert.equal(isMeaningfulText('short', 40), false);
  assert.equal(isMeaningfulText('x'.repeat(40), 40), true);
  assert.equal(MIN_TEXT_CHARS, 40);
});

test('joinPages normalizes each page and drops empty ones', () => {
  assert.equal(joinPages(['  one ', '', ' two ']), 'one\n\ntwo');
  assert.equal(joinPages([]), '');
});

test('parseOcrJsonl parses valid lines and fails loudly on corrupt lines', () => {
  assert.deepEqual(parseOcrJsonl('{"id":1}\n{"id":2}\n'), [{ id: 1 }, { id: 2 }]);
  assert.throws(() => parseOcrJsonl('{"id":1}\n{bad}'), /line 2/);
});

test('mergeTextSource: upstream text always wins, local fills gaps with a source tag', () => {
  assert.deepEqual(mergeTextSource({ id: 'a', text: 'up' }, { text: 'local' }), { id: 'a', text: 'up', textSource: OCR_SOURCES.upstream });
  assert.deepEqual(mergeTextSource({ id: 'a', text: '' }, { text: '  local text ', source: 'textlayer' }), { id: 'a', text: 'local text', textSource: OCR_SOURCES.textlayer });
  assert.deepEqual(mergeTextSource({ id: 'a', text: '' }, { text: 'ocr out', source: 'ocr' }), { id: 'a', text: 'ocr out', textSource: OCR_SOURCES.local });
  assert.deepEqual(mergeTextSource({ id: 'a' }, null), { id: 'a' });
});

test('mergeLocalOcr joins by id or pdf filename without touching upstream rows', () => {
  const rows = [
    { id: 'doc-1', pdfFile: '1.pdf', text: 'upstream' },
    { id: 'doc-2', pdfFile: '2.pdf', text: '' },
    { id: 'doc-3', pdfFile: '3.pdf', text: '' },
    { id: 'doc-4', pdfFile: '4.pdf', text: '' },
  ];
  const local = [
    { id: 'doc-2', text: 'from id', source: 'ocr' },
    { pdfFile: '3.pdf', text: 'from file', source: 'textlayer' },
    { id: 'doc-1', text: 'must not win' },
    { id: 'doc-x', text: 'no such row' },
  ];
  const merged = mergeLocalOcr(rows, local);
  assert.equal(merged[0].text, 'upstream');
  assert.equal(merged[0].textSource, OCR_SOURCES.upstream);
  assert.equal(merged[1].text, 'from id');
  assert.equal(merged[1].textSource, OCR_SOURCES.local);
  assert.equal(merged[2].text, 'from file');
  assert.equal(merged[2].textSource, OCR_SOURCES.textlayer);
  assert.deepEqual(merged[3], { id: 'doc-4', pdfFile: '4.pdf', text: '' });
  assert.equal(merged.length, 4);
});

test('searchLocalOcr matches every term by default and any term in OR mode', () => {
  const records = [
    { id: 'a', text: 'แต่งตั้งกรรมการ ผู้ทรงคุณวุฒิ' },
    { id: 'b', text: 'แต่งตั้ง ข้าราชการพลเรือน' },
    { id: 'c', text: '' },
  ];
  assert.deepEqual(searchLocalOcr(records, 'แต่งตั้งกรรมการ').map(r => r.id), ['a']);
  assert.deepEqual(searchLocalOcr(records, 'แต่งตั้ง ผู้ทรงคุณวุฒิ').map(r => r.id), ['a']);
  assert.deepEqual(searchLocalOcr(records, 'กรรมการ พลเรือน', { match: 'any' }).map(r => r.id), ['a', 'b']);
  assert.equal(searchLocalOcr(records, '  ').length, 0);
  assert.equal(searchLocalOcr(records, 'แต่งตั้ง')[0].matchIndex, 0);
});
