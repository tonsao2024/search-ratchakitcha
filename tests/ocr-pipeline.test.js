import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  processPdfBuffer, probeTextLayer, buildWorklist, recordLocalOcr, loadState,
  pdfCachePath, fetchPdf,
} from '../scripts/ocr-pipeline.mjs';

// Minimal valid single-page PDF with an embedded Helvetica text layer.
export function buildTextLayerPdf(lines) {
  const objects = [];
  // 12pt keeps the fixture lines inside the 612pt page (no mid-line clipping).
  const content = `BT /F1 12 Tf 72 720 Td 16 TL\n${lines.map((line, i) => (i === 0 ? '' : 'T*\n') + `(${line}) Tj`).join('\n')}\nET`;
  objects[1] = '<</Type /Catalog /Pages 2 0 R>>';
  objects[2] = '<</Type /Pages /Kids [3 0 R] /Count 1>>';
  objects[3] = '<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</Font <</F1 5 0 R>>>> /Contents 4 0 R>>';
  objects[4] = `<</Length ${Buffer.byteLength(content)}>>\nstream\n${content}\nendstream`;
  objects[5] = '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>';
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  pdf += `trailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// Minimal valid single-page PDF with ONLY a white JPEG image (a scan stand-in:
// no embedded text layer). The JPEG is a tiny 8x8 white baseline image.
export function buildImageOnlyPdf() {
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
    + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
    + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );
  const image = jpeg.length;
  const objects = [];
  objects[1] = '<</Type /Catalog /Pages 2 0 R>>';
  objects[2] = '<</Type /Pages /Kids [3 0 R] /Count 1>>';
  objects[3] = '<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</XObject <</Im0 4 0 R>>>> /Contents 5 0 R>>';
  objects[4] = `<</Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image}>>\nstream\n`;
  objects[5] = '<</Length 14>>\nstream\nq 612 0 0 792 0 0 cm /Im0 Do Q\nendstream';
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf);
    const body = i === 4 ? `${objects[4]}${jpeg.toString('binary')}\nendstream` : objects[i];
    pdf += `${i} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  pdf += `trailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const LAYER_LINES = ['Appointment announcement for the committee members', 'Royal Gazette official publication text sample'];

test('processPdfBuffer uses the embedded text layer when it is sufficient', async () => {
  const calls = [];
  const result = await processPdfBuffer(buildTextLayerPdf(LAYER_LINES), {
    recognize: async (png, i) => { calls.push(i); return 'SHOULD NOT RUN'; },
  });
  assert.equal(result.source, 'textlayer');
  assert.equal(result.pages, 1);
  assert.equal(result.ocrPages, 0);
  assert.equal(calls.length, 0);
  for (const line of LAYER_LINES) assert.ok(result.text.includes(line));
});

test('processPdfBuffer falls back to page OCR for image-only PDFs', async () => {
  const calls = [];
  const result = await processPdfBuffer(buildImageOnlyPdf(), {
    recognize: async (png, i) => {
      calls.push({ i, bytes: png.length });
      return 'OCR คำที่อ่านจากภาพ ' + 'x'.repeat(50);
    },
  });
  assert.equal(result.source, 'ocr');
  assert.equal(result.ocrPages, 1);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].bytes > 100, 'rasterized a real PNG');
  assert.ok(result.text.includes('OCR คำที่อ่านจากภาพ'));
});

test('processPdfBuffer reports none when neither text layer nor OCR yields text', async () => {
  const result = await processPdfBuffer(buildImageOnlyPdf(), {
    recognize: async () => '   ',
  });
  assert.equal(result.source, 'none');
  assert.equal(result.text, '');
  assert.equal(result.ocrPages, 1);
});

test('probeTextLayer classifies without running OCR', async () => {
  const withLayer = await probeTextLayer(buildTextLayerPdf(LAYER_LINES));
  const scan = await probeTextLayer(buildImageOnlyPdf());
  assert.equal(withLayer.hasTextLayer, true);
  assert.ok(withLayer.chars > 40);
  assert.equal(scan.hasTextLayer, false);
  assert.equal(scan.pages, 1);
});

test('buildWorklist skips tests, incomplete rows, upstream OCR and done state', () => {
  const meta = [
    { id: 'a', doctitle: 'ประกาศแต่งตั้ง ก', source_url: 'https://x/a.pdf', pdf_file: 'a.pdf', publishDate: '2026-10-01' },
    { id: 'b', doctitle: 'แต่งตั้ง ข', source_url: 'https://x/b.pdf', pdf_file: 'b.pdf', publishDate: '2026-10-02' },
    { id: 'c', doctitle: 'แต่งตั้ง ค', source_url: 'https://x/c.pdf', pdf_file: 'c.pdf', publishDate: '2026-10-03' },
    { id: 'd', doctitle: 'แต่งตั้ง ง', source_url: 'https://x/d.pdf', pdf_file: 'd.pdf', publishDate: '2026-10-04' },
    { id: 't', doctitle: 'ทดสอบ', is_test: true, source_url: 'https://x/t.pdf' },
    { id: '', doctitle: 'ไม่มี id' },
    { id: 'n', doctitle: 'ไม่มี PDF', source_url: '' },
  ];
  const worklist = buildWorklist(meta, {
    upstreamIds: new Set(['c']),
    state: { documents: { d: { status: 'done' } } },
  });
  assert.deepEqual(worklist.map(item => item.id), ['a', 'b']);
  assert.equal(worklist[0].month, '2026-10');
  const limited = buildWorklist(meta, { limit: 1 });
  assert.deepEqual(limited.map(item => item.id), ['a']);
});

test('recordLocalOcr appends JSONL and keeps state resumable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'local-ocr-'));
  const state = { documents: {} };
  await recordLocalOcr({ id: 'a', pdfFile: 'a.pdf', source_url: 'https://x/a.pdf', title: 'ประกาศ', date: '2026-10-01', text: 'ข้อความ ทดสอบ', source: 'ocr', pages: 1 }, { dir, state, month: '2026-10' });
  const line = JSON.parse((await readFile(path.join(dir, '2026-10.jsonl'), 'utf8')).trim());
  assert.equal(line.id, 'a');
  assert.equal(line.text, 'ข้อความ ทดสอบ');
  assert.equal(line.source, 'ocr');
  assert.equal(state.documents.a.status, 'done');
  const loaded = await loadState(dir);
  assert.equal(loaded.documents.a.status, 'done');
  await assert.rejects(recordLocalOcr({ id: 'x', text: '' }, { dir, month: '2026-10' }), /text is required/);
  await assert.rejects(recordLocalOcr({ id: 'x', text: 't' }, { dir, month: '2026-1' }), /month/);
});

test('fetchPdf caches downloads and rejects non-PDF bodies', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pdf-cache-'));
  const pdf = buildTextLayerPdf(['cached']);
  const urls = [];
  const fetcher = async url => {
    urls.push(url);
    return new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
  };
  const first = await fetchPdf('https://x/a.pdf', { dir, fetcher });
  const second = await fetchPdf('https://x/a.pdf', { dir, fetcher });
  assert.equal(Buffer.compare(first, pdf), 0);
  assert.equal(Buffer.compare(second, first), 0);
  assert.equal(urls.length, 1, 'second read came from cache');
  assert.equal(pdfCachePath('https://x/a.pdf', dir), pdfCachePath('https://x/a.pdf', dir));
  await assert.rejects(fetchPdf('https://x/bad.pdf', { dir, fetcher: async () => new Response('nope') }), /not a PDF/);
  await assert.rejects(fetchPdf('https://x/404.pdf', { dir, fetcher: async () => new Response('', { status: 404 }) }), /HTTP 404/);
});
