#!/usr/bin/env node
// Integrity gate for the data the sync published. Runs in CI after
// `npm run sync:data` and before the Pages build: a manifest that is not
// marked complete, a missing month, a monthly file whose bytes/rows do not
// match the manifest, a broken annual bundle or unavailable current-month OCR
// fails the deploy so the previous site stays intact.
import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { monthKey, requiredMonths, resolveReferenceMonth } from '../src/sync-integrity.js';

const assert = (condition, message) => {
  if (!condition) throw Error(message);
};

// `manifest` is the published manifest, `readJson` loads the files it refers to,
// and `reference` is the month to verify against (today by default, or the
// DATA_MONTH pin). Both are injected so the rules are unit-testable on fixtures.
export async function verifyPublishedData({ manifest, readJson, reference = new Date(), allowPendingCurrentMonth = true }) {
  assert(manifest.source && manifest.revision, 'Manifest is missing its source/revision');
  assert(manifest.complete === true, 'Published manifest is not marked complete');
  assert(Array.isArray(manifest.months) && manifest.months.length, 'Manifest has no monthly entries');

  const monthEntries = new Map(manifest.months.map(entry => [entry.month, entry]));
  // The newest calendar month may simply not be published upstream yet: verify
  // against the newest month the data can actually cover, and require the
  // manifest to say the same thing. Any older gap still fails here.
  const { month, pendingMonth } = resolveReferenceMonth([...monthEntries.keys()], reference, {
    allowPendingCurrentMonth,
    subject: 'The published manifest',
  });
  assert(manifest.currentMonth === month, `Manifest covers ${manifest.currentMonth}, expected ${month}${pendingMonth ? ` (${pendingMonth} is not published upstream yet)` : ''}`);
  assert((manifest.pendingMonth || null) === pendingMonth, `Manifest pendingMonth is ${manifest.pendingMonth || 'unset'}, expected ${pendingMonth || 'none'}`);

  for (const requiredMonth of requiredMonths(month)) {
    assert(monthEntries.has(requiredMonth), `Current-year month ${requiredMonth} is missing from the manifest`);
  }
  assert(manifest.coverage?.status === 'complete', `Manifest coverage is ${manifest.coverage?.status || 'unknown'}`);
  const currentEntry = monthEntries.get(month);
  assert(currentEntry, `Current month ${month} is missing from the manifest`);

  let verifiedBytes = 0;
  let verifiedLines = 0;
  let verifiedRows = 0;
  for (const entry of manifest.months) {
    const file = await readJson(`public/data/${entry.month}.json`);
    assert(file.complete === true, `${entry.month}: monthly file is incomplete`);
    assert(file.revision === manifest.revision, `${entry.month}: revision does not match manifest`);
    assert(Array.isArray(file.rows), `${entry.month}: rows are missing`);
    assert(file.rows.length === entry.count, `${entry.month}: row count differs from manifest`);
    assert(file.scanned === entry.scanned, `${entry.month}: scanned count differs from manifest`);
    if (typeof entry.expectedBytes === 'number' && entry.expectedBytes > 0) {
      assert(file.byteLength === entry.expectedBytes, `${entry.month}: downloaded byte length differs from upstream`);
      assert(file.lineCount === entry.lineCount, `${entry.month}: JSONL line count differs from upstream`);
    }
    assert(file.rows.filter(row => row.text).length === (entry.ocrCount || 0), `${entry.month}: OCR count differs from manifest`);
    for (const group of ['appointments', 'removals', 'nacc']) {
      if (typeof entry[group] === 'number') {
        assert(file.rows.filter(row => row.group === group).length === entry[group], `${entry.month}: ${group} count differs from manifest`);
      }
    }
    if (file.ocr?.expectedBytes && file.ocr.byteLength !== undefined) {
      assert(file.ocr.byteLength === file.ocr.expectedBytes, `${entry.month}: OCR download was truncated`);
    }
    const ids = new Set(file.rows.map(row => row.id));
    assert(ids.size === file.rows.length, `${entry.month}: duplicate document IDs`);
    verifiedBytes += file.byteLength || 0;
    verifiedLines += file.lineCount || 0;
    verifiedRows += file.rows.length;
  }

  if (manifest.ocrMonths?.includes(month)) {
    assert(currentEntry.ocrStatus === 'available', `Current-month OCR is ${currentEntry.ocrStatus || 'missing'}`);
  }

  for (const year of manifest.yearFiles || []) {
    const bundle = await readJson(`public/data/${year}.json`);
    const months = manifest.months.filter(entry => entry.month.startsWith(`${year}-`));
    assert(bundle.complete === true, `${year}: annual bundle is incomplete`);
    assert(bundle.revision === manifest.revision, `${year}: annual bundle revision does not match manifest`);
    assert(bundle.rows.length === months.reduce((sum, entry) => sum + entry.count, 0), `${year}: annual row count differs from monthly files`);
    assert(bundle.scanned === months.reduce((sum, entry) => sum + entry.scanned, 0), `${year}: annual scanned count differs from monthly files`);
    assert(new Set(bundle.rows.map(row => row.id)).size === bundle.rows.length, `${year}: duplicate document IDs in annual bundle`);
  }

  const summary = `${manifest.months.length} monthly files and ${manifest.yearFiles?.length || 0} annual bundles verified; ${verifiedRows} rows (${manifest.appointments ?? '?'} appointments, ${manifest.removals ?? '?'} removals, ${manifest.nacc ?? '?'} NACC); ${verifiedLines} JSONL lines; ${verifiedBytes} source bytes; current month ${month}: ${currentEntry.count} rows / ${currentEntry.ocrCount || 0} OCR${pendingMonth ? `; ${pendingMonth} not published upstream yet` : ''}; revision ${manifest.revision}`;
  return {
    summary,
    month,
    requestedMonth: monthKey(reference),
    pendingMonth,
    verifiedBytes,
    verifiedLines,
    verifiedRows,
    currentEntry,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const pinnedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(process.env.DATA_MONTH || '');
  const readJson = path => readFile(path, 'utf8').then(JSON.parse);
  const manifest = await readJson('public/data/manifest.json');
  const { summary } = await verifyPublishedData({
    manifest,
    readJson,
    reference: pinnedMonth ? process.env.DATA_MONTH : new Date(),
    // An explicitly requested month has to exist; "today" may still be pending upstream.
    allowPendingCurrentMonth: !pinnedMonth,
  });
  console.log(`::notice title=Published data integrity verified::${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Published data integrity\n${summary}\n`);
  }
}
