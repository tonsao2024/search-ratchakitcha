#!/usr/bin/env node
// OCR coverage report: how many announcements still have NO searchable text,
// per month and per year, and a worklist of the PDFs the local pipeline must
// process. Runs against the public Hugging Face dataset only (no PDF
// downloads unless --probe is given).
//
// Output:
//   .ocr-coverage/<year>.json  per-month totals + worklist (+ probe results)
//   stdout                     human-readable summary (CI-friendly)
//
// Usage:
//   node scripts/ocr-coverage.mjs --year 2026 [--limit 50] [--probe]
//   node scripts/ocr-coverage.mjs --months 2026-10,2026-09
//
// --probe downloads each worklist PDF and classifies it:
//   hasTextLayer true  → the pipeline will extract text without an OCR engine
//   hasTextLayer false → the PDF is a scan and needs the OCR pass

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DATASET, fetchPdf, probeTextLayer } from './ocr-pipeline.mjs';

export const COVERAGE_DIR = process.env.OCR_COVERAGE_DIR || '.ocr-coverage';

// Pure join: metadata records + upstream OCR doc ids -> coverage numbers and
// the worklist (documents that still need a local text source).
export function computeMonthCoverage(metaRecords, upstreamIds = new Set()) {
  const rows = [];
  for (const record of metaRecords || []) {
    if (record?.is_test) continue;
    if (typeof record?.doctitle !== 'string' || !record.doctitle.trim()) continue;
    const id = String(record?.id || record?.pdf_file || record?.source_url || '').trim();
    if (!id) continue;
    const pdf = /^https?:\/\//.test(record?.source_url || '') ? record.source_url : null;
    rows.push({
      id,
      title: record.doctitle,
      date: record.publishDate || record.publish_date || '',
      pdf,
      pdfFile: record?.pdf_file || '',
    });
  }
  const worklist = rows.filter(row => !upstreamIds.has(row.id) && !(row.pdfFile && upstreamIds.has(row.pdfFile)));
  return {
    total: rows.length,
    withOcr: rows.length - worklist.length,
    withoutOcr: worklist.length,
    worklist: worklist.map(row => ({ ...row, month: row.date.slice(0, 7) || null })),
  };
}

// Parse an upstream OCR JSONL body into the set of doc ids that actually have
// non-empty text.
export function upstreamOcrIdsFromJsonl(text) {
  const ids = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (typeof row?.text !== 'string' || !row.text.trim()) continue;
    for (const key of [row.doc_id, row.pdf_file].filter(Boolean)) ids.add(String(key));
  }
  return ids;
}

function parseArgs(argv) {
  const args = { year: null, months: null, limit: 0, probe: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => { i += 1; return argv[i]; };
    if (arg === '--year') args.year = next();
    else if (arg === '--months') args.months = next().split(',').map(value => value.trim()).filter(Boolean);
    else if (arg === '--limit') args.limit = Number(next()) || 0;
    else if (arg === '--probe') args.probe = true;
  }
  return args;
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function monthCoverage(month) {
  const [year] = month.split('-');
  const metaText = await fetchText(`${DATASET}/resolve/main/meta/${year}/${month}.jsonl`);
  const metaRecords = metaText.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  let upstreamIds = new Set();
  try {
    upstreamIds = upstreamOcrIdsFromJsonl(await fetchText(`${DATASET}/resolve/main/ocr/openlawdata-ocr/${year}/${month}.jsonl`));
  } catch { /* the dataset may not publish OCR for this month */ }
  return { month, ...computeMonthCoverage(metaRecords, upstreamIds) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  let months = args.months;
  if (!months?.length) {
    if (!args.year) {
      console.error('Usage: ocr-coverage.mjs --year YYYY | --months YYYY-MM,... [--limit N] [--probe]');
      process.exit(2);
    }
    const listing = JSON.parse(await fetchText(`${DATASET}/tree/main/meta/${args.year}`));
    months = listing.filter(entry => entry.type === 'file' && /-\d{2}\.jsonl$/.test(entry.path)).map(entry => entry.path.match(/(\d{4}-\d{2})\.jsonl$/)[1]).sort();
  }
  await mkdir(COVERAGE_DIR, { recursive: true });
  const reportFile = `${COVERAGE_DIR}/${months[0].slice(0, 4)}.json`;
  const report = JSON.parse((await (async () => { try { return readFile(reportFile, 'utf8'); } catch { return null; } })()) || 'null') || { year: months[0].slice(0, 4), months: [] };
  let totals = { total: 0, withOcr: 0, withoutOcr: 0, worklist: 0 };
  for (const month of months) {
    const result = await monthCoverage(month);
    if (args.probe && result.worklist.length) {
      let probed = 0;
      for (const item of result.worklist) {
        if (args.limit && probed >= args.limit) break;
        try {
          const probe = await probeTextLayer(await fetchPdf(item.pdf));
          item.hasTextLayer = probe.hasTextLayer;
          item.textChars = probe.chars;
          item.pages = probe.pages;
        } catch {
          item.hasTextLayer = null;
        }
        probed++;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      console.log(`${month} probed ${probed} PDFs`);
    }
    report.months = report.months.filter(entry => entry.month !== month);
    report.months.push(result);
    totals.total += result.total;
    totals.withOcr += result.withOcr;
    totals.withoutOcr += result.withoutOcr;
    totals.worklist += result.worklist.length;
    console.log(`${month}: ${result.withOcr}/${result.total} announcements have upstream OCR, ${result.withoutOcr} need local text`);
  }
  report.months.sort((a, b) => a.month.localeCompare(b.month));
  report.totals = totals;
  report.updatedAt = new Date().toISOString();
  await writeFile(`${reportFile}.tmp`, JSON.stringify(report, null, 1));
  await import('node:fs/promises').then(({ rename }) => rename(`${reportFile}.tmp`, reportFile));
  console.log(`Report written to ${reportFile}`);
}
