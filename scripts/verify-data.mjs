import { readFile, appendFile } from 'node:fs/promises';
import { monthKey, requiredMonths } from '../src/sync-integrity.js';

const referenceMonth = process.env.DATA_MONTH && /^\d{4}-(0[1-9]|1[0-2])$/.test(process.env.DATA_MONTH)
  ? process.env.DATA_MONTH
  : monthKey(new Date());
const assert = (condition, message) => {
  if (!condition) throw Error(message);
};
const readJson = path => readFile(path, 'utf8').then(JSON.parse);

const manifest = await readJson('public/data/manifest.json');
assert(manifest.source && manifest.revision, 'Manifest is missing its source/revision');
assert(manifest.complete === true, 'Published manifest is not marked complete');
assert(manifest.currentMonth === referenceMonth, `Manifest covers ${manifest.currentMonth}, expected ${referenceMonth}`);
assert(manifest.coverage?.status === 'complete', `Manifest coverage is ${manifest.coverage?.status || 'unknown'}`);
assert(Array.isArray(manifest.months) && manifest.months.length, 'Manifest has no monthly entries');

const monthEntries = new Map(manifest.months.map(entry => [entry.month, entry]));
for (const month of requiredMonths(referenceMonth)) {
  assert(monthEntries.has(month), `Current-year month ${month} is missing from the manifest`);
}
const currentEntry = monthEntries.get(referenceMonth);
assert(currentEntry, `Current month ${referenceMonth} is missing from the manifest`);

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
  if (file.ocr?.expectedBytes && file.ocr.byteLength !== undefined) {
    assert(file.ocr.byteLength === file.ocr.expectedBytes, `${entry.month}: OCR download was truncated`);
  }
  const ids = new Set(file.rows.map(row => row.id));
  assert(ids.size === file.rows.length, `${entry.month}: duplicate document IDs`);
  verifiedBytes += file.byteLength || 0;
  verifiedLines += file.lineCount || 0;
  verifiedRows += file.rows.length;
}

if (manifest.ocrMonths?.includes(referenceMonth)) {
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

const summary = `${manifest.months.length} monthly files and ${manifest.yearFiles?.length || 0} annual bundles verified; ${verifiedRows} rows; ${verifiedLines} JSONL lines; ${verifiedBytes} source bytes; current month ${referenceMonth}: ${currentEntry.count} rows / ${currentEntry.ocrCount || 0} OCR; revision ${manifest.revision}`;
console.log(`::notice title=Published data integrity verified::${summary}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Published data integrity\n${summary}\n`);
}
