#!/usr/bin/env node
// Local OCR pipeline for Royal Gazette PDFs that have no upstream OCR text.
//
// For every PDF it tries, in order:
//   1. the embedded text layer (digital-born PDFs) — mupdf extraction, free;
//   2. rasterized pages + tesseract.js (tha+eng) for scanned image-only PDFs.
//
// Outputs (all gitignored, never committed):
//   .local-ocr/YYYY-MM.jsonl  extracted text, one record per document
//   .local-ocr/state.json     per-document state so runs are resumable
//   .ocr-cache/<sha1>.pdf     downloaded PDF cache
//
// The record schema mirrors the upstream openlawdata-ocr rows (doc id,
// pdf filename, title, date, text) so scripts/sync-data.mjs can merge it
// into the published static JSON with upstream text taking precedence.
//
// Usage:
//   node scripts/ocr-pipeline.mjs --month 2026-10 [--limit N] [--probe-only]
//   node scripts/ocr-pipeline.mjs --pdf https://.../132337.pdf --id doc-1 \
//     [--title "ประกาศ ..."] [--month 2026-10]
//
// Environment:
//   OCR_LANGS             tesseract languages, default "tha+eng"
//   TESSDATA_PATH         local directory with *.traineddata (avoids CDN)
//   LOCAL_OCR_DIR / PDF_CACHE_DIR   move the work directories
//   OCR_MIN_CHARS         minimum text-layer chars before OCR kicks in (40)

import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  joinPages, meaningfulChars, isMeaningfulText, MIN_TEXT_CHARS,
} from '../src/ocr.js';

export const LOCAL_OCR_DIR = process.env.LOCAL_OCR_DIR || '.local-ocr';
export const PDF_CACHE_DIR = process.env.PDF_CACHE_DIR || '.ocr-cache';
export const DATASET = 'https://huggingface.co/datasets/open-law-data-thailand/soc-ratchakitcha';

export function ocrPaths(dir = LOCAL_OCR_DIR) {
  return {
    dir,
    month: month => path.join(dir, `${month}.jsonl`),
    state: path.join(dir, 'state.json'),
  };
}

// --- state (resumable runs) -------------------------------------------------

// Returns the full state object: { documents: { <key>: {...} } }.
// saveState/recordLocalOcr expect this wrapped shape, so keep it wrapped.
export async function loadState(dir = LOCAL_OCR_DIR) {
  try {
    const raw = JSON.parse(await readFile(ocrPaths(dir).state, 'utf8'));
    return { documents: raw?.documents && typeof raw.documents === 'object' ? raw.documents : {} };
  } catch {
    return { documents: {} };
  }
}

export async function saveState(state, dir = LOCAL_OCR_DIR) {
  const paths = ocrPaths(dir);
  await mkdir(paths.dir, { recursive: true });
  const temp = `${paths.state}.tmp`;
  await writeFile(temp, JSON.stringify({ updatedAt: new Date().toISOString(), documents: state.documents || {} }, null, 1));
  await import('node:fs/promises').then(({ rename }) => rename(temp, paths.state));
}

// Append one record to .local-ocr/<month>.jsonl and mark it done in state.
export async function recordLocalOcr(record, { dir = LOCAL_OCR_DIR, state, month } = {}) {
  if (!record || typeof record.text !== 'string' || !record.text.trim()) {
    throw Error('record.text is required');
  }
  if (!month || !/^\d{4}-\d{2}$/.test(month)) throw Error('month YYYY-MM is required');
  const paths = ocrPaths(dir);
  await mkdir(paths.dir, { recursive: true });
  const line = JSON.stringify({
    id: record.id || null,
    pdfFile: record.pdfFile || null,
    source_url: record.source_url || record.pdf || null,
    doctitle: record.title || record.doctitle || '',
    publish_date: record.date || record.publish_date || '',
    text: record.text,
    source: record.source,
    pages: record.pages ?? null,
    createdAt: new Date().toISOString(),
  });
  await appendFile(paths.month(month), `${line}\n`);
  if (state) {
    const key = record.id || record.pdfFile;
    if (key) state.documents[key] = { status: 'done', source: record.source, pages: record.pages ?? null, at: new Date().toISOString() };
    await saveState(state, dir);
  }
  return line;
}

// --- PDF processing ----------------------------------------------------------

let mupdfPromise;
async function mupdfLib() {
  mupdfPromise ??= import('mupdf');
  return mupdfPromise;
}

let tesseractPromise;
async function tesseractWorker() {
  tesseractPromise ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    const langs = String(process.env.OCR_LANGS || 'tha+eng').split('+').filter(Boolean);
    const options = {};
    if (process.env.TESSDATA_PATH) options.langPath = process.env.TESSDATA_PATH;
    return createWorker(langs, 1, options);
  })();
  return tesseractPromise;
}

// Default OCR: one lazily-created tesseract worker shared by all pages.
export async function defaultRecognize(png, pageIndex) {
  const worker = await tesseractWorker();
  const { data } = await worker.recognize(png);
  return (data?.text || `@page:${pageIndex}@`);
}

// Extract text from a PDF buffer. `recognize` is injectable for tests and for
// swapping OCR engines. Returns { text, source, pages, ocrPages }.
//   source 'textlayer' — embedded text was sufficient, no OCR engine used
//   source 'ocr'       — pages were rasterized and OCR'd
//   source 'none'      — the PDF has no usable text at all
export async function processPdfBuffer(buffer, {
  recognize = defaultRecognize,
  minChars = MIN_TEXT_CHARS,
  dpi = 200,
  maxPages = 300,
  onPage,
} = {}) {
  const mupdf = await mupdfLib();
  const doc = mupdf.Document.openDocument(new Uint8Array(buffer));
  const pageCount = Math.min(doc.countPages(), maxPages);
  const scale = dpi / 72;

  // Pass 1: embedded text layer (free, no OCR engine).
  const textPages = [];
  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    textPages.push(page.toStructuredText().asText());
    onPage?.({ page: i, phase: 'textlayer' });
  }
  const layered = joinPages(textPages);
  if (isMeaningfulText(layered, minChars)) {
    return { text: layered, source: 'textlayer', pages: pageCount, ocrPages: 0 };
  }

  // Pass 2: rasterize each page and run OCR.
  const ocrPages = [];
  let ocrPageCount = 0;
  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const png = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB).asPNG();
    const text = await recognize(png, i);
    ocrPages.push(text);
    ocrPageCount++;
    onPage?.({ page: i, phase: 'ocr' });
  }
  const ocrText = joinPages(ocrPages);
  if (isMeaningfulText(ocrText, minChars)) {
    return { text: ocrText, source: 'ocr', pages: pageCount, ocrPages: ocrPageCount };
  }
  return { text: '', source: 'none', pages: pageCount, ocrPages: ocrPageCount };
}

// Cheap classification for --probe-only: does the PDF carry an embedded text
// layer at all? Never writes local OCR records.
export async function probeTextLayer(buffer, { minChars = MIN_TEXT_CHARS } = {}) {
  const mupdf = await mupdfLib();
  const doc = mupdf.Document.openDocument(new Uint8Array(buffer));
  const pages = doc.countPages();
  let chars = 0;
  for (let i = 0; i < pages; i++) chars += meaningfulChars(doc.loadPage(i).toStructuredText().asText());
  return { pages, chars, hasTextLayer: chars >= minChars };
}

// --- worklist ----------------------------------------------------------------

// Filter a month's raw metadata records down to documents that still need a
// local text source: not a test row, complete, has an HTTP PDF, no upstream
// OCR and not already processed by a previous run.
export function buildWorklist(metaRecords, { upstreamIds = new Set(), state = {}, limit = Infinity } = {}) {
  const documents = state?.documents || state || {};
  const done = new Set(Object.entries(documents).filter(([, entry]) => entry?.status === 'done').map(([key]) => key));
  const worklist = [];
  for (const record of metaRecords || []) {
    if (record?.is_test) continue;
    if (typeof record?.doctitle !== 'string' || !record.doctitle.trim()) continue;
    const id = String(record?.id || record?.pdf_file || record?.source_url || '').trim();
    if (!id) continue;
    const pdf = /^https?:\/\//.test(record?.source_url || '') ? record.source_url : null;
    if (!pdf) continue;
    const pdfFile = record?.pdf_file || '';
    if (upstreamIds.has(id) || (pdfFile && upstreamIds.has(pdfFile))) continue;
    if (done.has(id) || (pdfFile && done.has(pdfFile))) continue;
    worklist.push({
      id,
      title: record.doctitle,
      date: record.publishDate || record.publish_date || '',
      pdf,
      pdfFile,
      month: String(record.publishDate || record.publish_date || '').slice(0, 7) || null,
    });
    if (worklist.length >= limit) break;
  }
  return worklist;
}

// --- PDF download (cached) ----------------------------------------------------

export function pdfCachePath(url, dir = PDF_CACHE_DIR) {
  const digest = createHash('sha1').update(url).digest('hex');
  return path.join(dir, `${digest}.pdf`);
}

export async function fetchPdf(url, { dir = PDF_CACHE_DIR, fetcher = fetch } = {}) {
  const cacheFile = pdfCachePath(url, dir);
  try {
    const cached = await readFile(cacheFile);
    if (cached.length) return cached;
  } catch { /* not cached yet */ }
  const response = await fetcher(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error(`PDF download HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw Error('Downloaded file is not a PDF');
  await mkdir(dir, { recursive: true });
  await writeFile(`${cacheFile}.tmp`, buffer);
  await import('node:fs/promises').then(({ rename }) => rename(`${cacheFile}.tmp`, cacheFile));
  return buffer;
}

// --- CLI -----------------------------------------------------------------------

function parseArgs(argv) {
  const args = { month: null, pdf: null, id: null, title: null, limit: 0, probeOnly: false, delayMs: 500 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => { i += 1; return argv[i]; };
    if (arg === '--month') args.month = next();
    else if (arg === '--pdf') args.pdf = next();
    else if (arg === '--id') args.id = next();
    else if (arg === '--title') args.title = next();
    else if (arg === '--limit') args.limit = Number(next()) || 0;
    else if (arg === '--probe-only') args.probeOnly = true;
    else if (arg === '--delay-ms') args.delayMs = Number(next()) || 0;
  }
  return args;
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

// Collect upstream OCR doc ids for a month (empty set when the dataset does
// not publish OCR for that month or the row has no usable text).
async function upstreamOcrIds(month) {
  const [year] = month.split('-');
  const url = `${DATASET}/resolve/main/ocr/openlawdata-ocr/${year}/${month}.jsonl`;
  try {
    const text = await fetchText(url);
    const ids = new Set();
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (typeof row?.text !== 'string' || !row.text.trim()) continue;
      for (const key of [row.doc_id, row.pdf_file].filter(Boolean)) ids.add(String(key));
    }
    return ids;
  } catch {
    return new Set();
  }
}

async function runMonth(month, args) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw Error('month must be YYYY-MM');
  const [year] = month.split('-');
  const metaText = await fetchText(`${DATASET}/resolve/main/meta/${year}/${month}.jsonl`);
  const metaRecords = metaText.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const upstreamIds = await upstreamOcrIds(month);
  const state = await loadState();
  const worklist = buildWorklist(metaRecords, { upstreamIds, state, limit: args.limit });
  console.log(`${month}: ${metaRecords.length} metadata rows, ${upstreamIds.size} upstream OCR, ${worklist.length} to process${args.limit ? ` (limit ${args.limit})` : ''}`);
  let textlayer = 0, ocr = 0, none = 0, failed = 0;
  for (const item of worklist) {
    const label = `${item.id} ${item.title.slice(0, 40)}`;
    const stamp = () => new Date().toISOString();
    try {
      const pdf = await fetchPdf(item.pdf);
      if (args.probeOnly) {
        // Classification only: no OCR engine, no records written.
        const probe = await probeTextLayer(pdf);
        state.documents[item.id] = { status: 'probed', hasTextLayer: probe.hasTextLayer, textChars: probe.chars, pages: probe.pages, at: stamp() };
        if (probe.hasTextLayer) textlayer++;
        else none++;
        console.log(`  [${probe.hasTextLayer ? 'textlayer' : 'scan-only'}] ${label} (${probe.pages} pages, ${probe.chars} text chars)`);
      } else {
        const result = await processPdfBuffer(pdf);
        if (result.source === 'none') {
          none++;
          console.log(`  [none] ${label} (no text layer, OCR empty)`);
          state.documents[item.id] = { status: 'none', at: stamp() };
        } else {
          await recordLocalOcr({ id: item.id, pdfFile: item.pdfFile, source_url: item.pdf, title: item.title, date: item.date, text: result.text, source: result.source, pages: result.pages }, { state, month });
          if (result.source === 'textlayer') textlayer++;
          else ocr++;
          console.log(`  [${result.source}] ${label} (${result.pages} pages${result.ocrPages ? `, ${result.ocrPages} OCR'd` : ''})`);
        }
      }
    } catch (error) {
      failed++;
      state.documents[item.id] = { status: 'error', error: error.message, at: stamp() };
      console.warn(`  [error] ${label}: ${error.message}`);
    }
    if (args.delayMs) await new Promise(resolve => setTimeout(resolve, args.delayMs));
  }
  await saveState(state);
  console.log(`${month} done: textlayer ${textlayer}, ocr ${ocr}, none ${none}, failed ${failed}`);
}

async function runSingle(args) {
  if (!args.pdf || !args.id) throw Error('--pdf and --id are required for single-document mode');
  const month = args.month || new Date().toISOString().slice(0, 7);
  const state = await loadState();
  const buffer = args.pdf.startsWith('http') ? await fetchPdf(args.pdf) : await readFile(args.pdf);
  const result = await processPdfBuffer(buffer);
  if (result.source === 'none') throw Error('No usable text found (no text layer and OCR produced nothing)');
  await recordLocalOcr({ id: args.id, source_url: args.pdf.startsWith('http') ? args.pdf : null, pdfFile: path.basename(args.pdf), title: args.title || args.id, date: '', text: result.text, source: result.source, pages: result.pages }, { state, month });
  console.log(JSON.stringify({ id: args.id, source: result.source, pages: result.pages, chars: meaningfulChars(result.text) }));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (args.pdf) await runSingle(args);
    else if (args.month) await runMonth(args.month, args);
    else {
      console.error('Usage: ocr-pipeline.mjs --month YYYY-MM [--limit N] [--probe-only] | --pdf URL --id ID [--title T] [--month YYYY-MM]');
      process.exit(2);
    }
  } catch (error) {
    console.error(`OCR pipeline failed: ${error.message}`);
    process.exit(1);
  }
}
