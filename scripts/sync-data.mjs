import { mkdir, writeFile, readFile, appendFile, rename } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { TransformStream } from 'node:stream/web';
import { parseMonthly } from '../src/dataset.js';
import { DATASET } from '../src/search.js';
import { mergeLocalOcr, parseOcrJsonl } from '../src/ocr.js';
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

process.on('uncaughtException', error => {
  console.log(`::error title=Dataset import failed::${String(error.stack || error).replaceAll('%', '%25').replaceAll('\n', '%0A').replaceAll('\r', '%0D')}`);
  process.exit(1);
});
process.on('unhandledRejection', error => {
  console.log(`::error title=Dataset import failed::${String(error?.stack || error).replaceAll('%', '%25').replaceAll('\n', '%0A').replaceAll('\r', '%0D')}`);
  process.exit(1);
});

const repo = 'open-law-data-thailand/soc-ratchakitcha';
const localOcrDir = process.env.LOCAL_OCR_DIR || '.local-ocr';

// Local text extracted by scripts/ocr-pipeline.mjs for documents that upstream
// OCR does not cover. A corrupt local cache fails the build loudly; a missing
// file simply means there is no local text for that month.
async function loadLocalOcr(month) {
  try {
    return parseOcrJsonl(await readFile(`${localOcrDir}/${month}.jsonl`, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw Error(`${month}: local OCR cache is unreadable: ${error.message}`);
  }
}

const referenceMonth = process.env.DATA_MONTH && /^\d{4}-(0[1-9]|1[0-2])$/.test(process.env.DATA_MONTH)
  ? process.env.DATA_MONTH
  : monthKey(new Date());
const currentYear = Number(referenceMonth.slice(0, 4));
const ocrYears = [currentYear - 1, currentYear];
const maxAttempts = Math.max(1, Number(process.env.HF_MAX_ATTEMPTS || 8));
const requestIntervalMs = Math.max(0, Number(process.env.HF_REQUEST_INTERVAL_MS || 200));
const requestConcurrency = Math.max(1, Number(process.env.HF_CONCURRENCY || 3));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Hugging Face rate-limits a cold historical import. Space requests globally and honour Retry-After.
let requestQueue = Promise.resolve();
let lastRequestAt = 0;
async function rateLimitedFetch(url, init) {
  const task = requestQueue.then(async () => {
    const wait = requestIntervalMs - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fetch(url, init);
  });
  requestQueue = task.then(() => {}, () => {});
  return task;
}

async function get(url) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response;
    try {
      response = await rateLimitedFetch(url, { signal: AbortSignal.timeout(300000) });
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
      const delay = retryDelayMs(null, attempt) + Math.random() * 250;
      console.warn(`::warning::Network error for ${url}; retry ${attempt + 1}/${maxAttempts} in ${Math.round(delay / 1000)}s: ${error.message}`);
      await sleep(delay);
      continue;
    }
    if (response.ok) return response;
    const error = Error(`HTTP ${response.status}: ${url}`);
    const nonRetryable = [400, 401, 403, 404, 410, 422].includes(response.status);
    if (nonRetryable || attempt === maxAttempts - 1) throw error;
    const delay = retryDelayMs(response.headers.get('retry-after'), attempt) + Math.random() * 250;
    console.warn(`::warning::HTTP ${response.status} for ${url}; retry ${attempt + 1}/${maxAttempts} in ${Math.round(delay / 1000)}s`);
    await sleep(delay);
  }
  throw Error(`Request failed: ${url}`);
}

async function pool(items, fn, concurrency = requestConcurrency) {
  let next = 0;
  const results = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

async function fetchSource(url, file, label) {
  const response = await get(url);
  const buffer = await response.arrayBuffer();
  return assertCompleteSource(buffer, file, label);
}

const info = await get(`https://huggingface.co/api/datasets/${repo}`).then(response => response.json());
const revision = process.env.DATASET_REVISION || info.sha;
if (!revision) throw Error('Dataset revision missing');

async function tree(path) {
  let url = `https://huggingface.co/api/datasets/${repo}/tree/${revision}/${path}?limit=1000`;
  const items = [];
  while (url) {
    const response = await get(url);
    items.push(...await response.json());
    url = response.headers.get('link')?.match(/<([^>]+)>; rel="next"/)?.[1] || null;
  }
  return items;
}

const years = (await tree('meta'))
  .filter(file => file.type === 'directory' && /^meta\/\d{4}$/.test(file.path))
  .map(file => file.path.slice(-4))
  .sort();
if (!years.length) throw Error('No metadata years');

const files = (await pool(years, async year => (await tree(`meta/${year}`)).filter(file =>
  file.type === 'file' && /^meta\/\d{4}\/\d{4}-(0[1-9]|1[0-2])\.jsonl$/.test(file.path)
))).flat();
if (!files.length) throw Error('No metadata files');
// Every month from January through the required month must exist upstream. Empty files are valid.
assertMonthCoverage(files, referenceMonth);

// Full historical metadata; import OCR for the current and previous year to bound Pages size.
const ocrFiles = new Map();
for (const year of years.filter(value => ocrYears.includes(Number(value)))) {
  for (const file of await tree(`ocr/openlawdata-ocr/${year}`)) {
    const match = file.type === 'file' && typeof file.path === 'string' && file.path.match(/(\d{4}-(?:0[1-9]|1[0-2]))\.jsonl$/);
    if (match) ocrFiles.set(match[1], file);
  }
}

await mkdir('public/data', { recursive: true });
await mkdir('.cache/month-import', { recursive: true });
const manifest = {
  source: DATASET,
  revision,
  datasetLastModified: info.lastModified || null,
  license: 'CC-BY-4.0',
  year: String(currentYear),
  currentMonth: referenceMonth,
  years: [],
  months: [],
  syncedAt: null,
  integrityVersion: 3,
  ocrPolicyYears: ocrYears,
  ocrMonths: [...ocrFiles.keys()].sort(),
};

async function importOcr(ocrFile, rows, month) {
  const byKey = new Map();
  for (const row of rows) {
    for (const key of documentKeys(row.id, row.pdfFile, row.pdf)) byKey.set(key, row);
  }
  const expectedBytes = sourceBytes(ocrFile);
  const issues = [];
  let byteLength = 0;
  let lineCount = 0;
  let invalidLines = 0;
  let rejectedRows = 0;
  const matchedRows = new Set();
  let status = 'available';
  let error = null;

  try {
    const url = `${DATASET}/resolve/${revision}/${ocrFile.path}`;
    const response = await get(url);
    if (!response.body) throw Error('OCR response has no body');
    const contentLength = Number(response.headers.get('content-length'));
    if (expectedBytes && Number.isFinite(contentLength) && contentLength > 0 && contentLength !== expectedBytes) {
      issues.push(`content-length ${contentLength}/${expectedBytes}`);
    }
    const counter = new TransformStream({
      transform(chunk, controller) {
        byteLength += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const lines = createInterface({
      input: Readable.fromWeb(response.body.pipeThrough(counter)),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      lineCount++;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        invalidLines++;
        continue;
      }
      if (record?.is_valid === false || typeof record?.text !== 'string' || !record.text.trim()) {
        rejectedRows++;
        continue;
      }
      const row = matchOcrRow(byKey, record);
      if (row) {
        // Prefer the longest valid OCR text if upstream contains repeated document rows.
        if (!row.text || record.text.length > row.text.length) row.text = record.text;
        matchedRows.add(row.id);
      }
    }
    if (expectedBytes && byteLength !== expectedBytes) issues.push(`download ${byteLength}/${expectedBytes} bytes`);
    if (expectedBytes && !lineCount) issues.push('empty OCR file');
    if (invalidLines) issues.push(`${invalidLines} malformed OCR lines`);
  } catch (cause) {
    issues.push(cause.message);
  }

  if (issues.length) {
    status = lineCount ? 'partial' : 'unavailable';
    error = issues.join('; ');
    console.warn(`OCR ${month}: ${error}`);
  }
  return {
    ocrStatus: status,
    ocrError: error,
    ocr: {
      expectedBytes,
      byteLength,
      lineCount,
      invalidLines,
      rejectedRows,
      matchedRows: matchedRows.size,
    },
  };
}

const entries = await pool(files, async file => {
  const month = file.path.match(/(\d{4}-\d{2})\.jsonl$/)[1];
  const source = `${DATASET}/resolve/${revision}/${file.path}`;
  const ocrFile = ocrFiles.get(month);
  const expectedBytes = sourceBytes(file);
  // v6: classification now imports removal notices, so earlier caches must be rebuilt.
  const cacheKey = `v6-${file.oid}-${ocrFile?.oid || 'metadata'}`;
  let cached = null;
  try {
    cached = JSON.parse(await readFile(`.cache/month-import/${cacheKey}.json`, 'utf8'));
  } catch {}
  // Old or corrupt caches must never be published as a fresh complete import.
  if (cached && (
    cached.revision !== revision ||
    !Array.isArray(cached.rows) ||
    cached.byteLength !== expectedBytes ||
    cached.lineCount !== cached.scanned ||
    !cached.downloadedAt
  )) cached = null;

  let result = cached;
  if (!result) {
    try {
      const downloaded = await fetchSource(source, file, month);
      const parsed = expectedBytes === 0
        ? { rows: [], scanned: 0, skippedIncomplete: 0 }
        : parseMonthly(downloaded.text);
      if (parsed.scanned !== downloaded.lineCount) throw Error(`${month}: line count mismatch`);
      const ocr = ocrFile
        ? await importOcr(ocrFile, parsed.rows, month)
        : { ocrStatus: 'not-imported', ocrError: null, ocr: null };
      result = {
        ...parsed,
        ...downloaded,
        ...ocr,
        revision,
        downloadedAt: new Date().toISOString(),
      };
      delete result.text; // `text` here is the raw JSONL, not OCR content.
      if (result.ocrStatus === 'available') {
        await writeFile(`.cache/month-import/${cacheKey}.json`, JSON.stringify(result));
      }
    } catch (error) {
      throw Error(`${month}: ${error.message}`);
    }
  }

  const connectedAt = result.downloadedAt || new Date().toISOString();
  const localOcr = await loadLocalOcr(month);
  if (localOcr.length) result.rows = mergeLocalOcr(result.rows, localOcr);
  const localOcrCount = result.rows.filter(row => row.textSource && row.textSource !== 'upstream').length;
  const ocrCount = result.rows.filter(row => row.text).length;
  const data = {
    ...result,
    month,
    source,
    revision,
    complete: true,
    stale: false,
    connectedAt,
    retrievedOn: connectedAt.slice(0, 10),
    ocrStatus: result.ocrStatus,
    ocrError: result.ocrError,
    ocrCount,
    expectedBytes: result.expectedBytes,
    byteLength: result.byteLength,
    lineCount: result.lineCount,
  };
  delete data.text;
  await writeFile(`public/data/${month}.json`, JSON.stringify(data));
  return {
    month,
    skippedIncomplete: data.skippedIncomplete || 0,
    scanned: data.scanned,
    count: data.rows.length,
    appointments: data.rows.filter(row => row.group === 'appointments').length,
    removals: data.rows.filter(row => row.group === 'removals').length,
    nacc: data.rows.filter(row => row.group === 'nacc').length,
    ocrCount,
    ocrStatus: data.ocrStatus,
    localOcrCount,
    expectedBytes: data.expectedBytes,
    byteLength: data.byteLength,
    lineCount: data.lineCount,
  };
});

manifest.months = entries.sort((a, b) => a.month.localeCompare(b.month));
manifest.years = years.map(year => ({
  year,
  count: entries.filter(month => month.month.startsWith(year)).reduce((sum, month) => sum + month.count, 0),
}));
manifest.skippedIncomplete = entries.reduce((sum, month) => sum + month.skippedIncomplete, 0);
manifest.appointments = entries.reduce((sum, month) => sum + month.appointments, 0);
manifest.removals = entries.reduce((sum, month) => sum + month.removals, 0);
manifest.nacc = entries.reduce((sum, month) => sum + month.nacc, 0);
manifest.syncedAt = new Date().toISOString();
manifest.total = entries.reduce((sum, month) => sum + month.count, 0);
manifest.ocrCount = entries.reduce((sum, month) => sum + month.ocrCount, 0);
manifest.localOcrCount = entries.reduce((sum, month) => sum + (month.localOcrCount || 0), 0);
manifest.metadataBytes = entries.reduce((sum, month) => sum + (month.byteLength || 0), 0);
manifest.metadataLines = entries.reduce((sum, month) => sum + (month.lineCount || 0), 0);
manifest.coverage = coverageSummary(entries, referenceMonth);
manifest.latestMonth = manifest.coverage.latestMonth;
manifest.complete = manifest.coverage.status === 'complete';

if (!manifest.total) throw Error('No matching announcements');
if (!manifest.complete) throw Error(`Incomplete current-year coverage: ${manifest.coverage.missingMonths.join(', ')}`);
if (!manifest.months.some(month => month.month === referenceMonth)) {
  throw Error(`Current month ${referenceMonth} is missing from the imported manifest`);
}

// Annual bundles make multi-year and all-year browsing practical on static Pages.
manifest.yearFiles = [];
for (const year of years) {
  const entriesForYear = manifest.months.filter(month => month.month.startsWith(`${year}-`));
  if (!entriesForYear.length) continue;
  const batches = await Promise.all(entriesForYear.map(month =>
    readFile(`public/data/${month.month}.json`, 'utf8').then(JSON.parse)
  ));
  const rows = batches.flatMap(batch => batch.rows);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error(`${year}: duplicate document IDs in annual bundle`);
  const bundle = {
    year,
    revision,
    complete: true,
    rows,
    scanned: batches.reduce((sum, batch) => sum + batch.scanned, 0),
    months: entriesForYear.map(month => month.month),
    generatedAt: manifest.syncedAt,
  };
  await writeFile(`public/data/${year}.json`, JSON.stringify(bundle));
  manifest.yearFiles.push(year);
}

const manifestTemp = 'public/data/manifest.json.tmp';
await writeFile(manifestTemp, JSON.stringify(manifest, null, 2));
await rename(manifestTemp, 'public/data/manifest.json');
await writeFile('public/.nojekyll', '');
const current = manifest.coverage;
const summary = `${manifest.total} announcements (${manifest.appointments} appointments, ${manifest.removals} removals); ${manifest.nacc} NACC; ${manifest.ocrCount} OCR texts (${manifest.localOcrCount} from the local pipeline); ${years[0]}–${years.at(-1)}; ${entries.length} months; ${manifest.skippedIncomplete} incomplete records skipped; ${requiredMonths(referenceMonth).length} current-year months verified; ${current.currentMonthCount} records in ${referenceMonth}; OCR ${current.ocrStatus}; revision ${revision}`;
console.log(`::notice title=Verified real dataset::${summary}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Actual historical dataset\n${summary}\n\nMetadata bytes/lines are checked against the pinned upstream tree. Upstream OCR imported for ${ocrYears.join('–')}; the local pipeline (scripts/ocr-pipeline.mjs) adds text for documents it covers. Older metadata remains title-searchable.\n`);
}
