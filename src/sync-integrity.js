// Shared, dependency-free integrity helpers for the importer, verifier and browser client.
export function monthKey(reference = new Date()) {
  if (typeof reference === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(reference)) return reference;
  const date = reference instanceof Date ? reference : new Date(reference);
  if (Number.isNaN(date.getTime())) throw Error('Invalid month reference');
  return date.toISOString().slice(0, 7);
}

export function requiredMonths(reference = new Date()) {
  const current = monthKey(reference);
  const year = current.slice(0, 4);
  const month = Number(current.slice(5, 7));
  return Array.from({ length: month }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}

export function sourceBytes(file) {
  const value = Number(file?.lfs?.size ?? file?.size);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function retryDelayMs(retryAfter, attempt, now = Date.now()) {
  let suggested = 0;
  if (typeof retryAfter === 'string' && retryAfter.trim()) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) suggested = Math.max(0, seconds) * 1000;
    else {
      const date = Date.parse(retryAfter);
      if (!Number.isNaN(date)) suggested = Math.max(0, date - now);
    }
  }
  const backoff = 500 * 2 ** Math.max(0, attempt);
  return Math.min(120000, Math.max(backoff, suggested));
}

// Verify the raw bytes, not just parsed lines: a truncated JSONL can still end on a valid line.
export function assertCompleteSource(buffer, file, label = 'source') {
  const byteLength = buffer instanceof ArrayBuffer ? buffer.byteLength : buffer?.byteLength;
  if (!Number.isFinite(byteLength)) throw Error(`${label}: response is not a byte buffer`);
  const text = new TextDecoder('utf-8').decode(buffer);
  const lineCount = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim()).length;
  const expectedBytes = sourceBytes(file);
  if (expectedBytes !== null && expectedBytes > 0) {
    if (byteLength !== expectedBytes) throw Error(`${label}: incomplete download (${byteLength}/${expectedBytes} bytes)`);
    if (!lineCount) throw Error(`${label}: expected ${expectedBytes} bytes but found no JSONL records`);
    if (/^\s*<(!doctype|html)/i.test(text)) throw Error(`${label}: received HTML instead of JSONL`);
  }
  if (expectedBytes === 0 && lineCount) throw Error(`${label}: zero-byte source unexpectedly contains records`);
  return { text, byteLength, lineCount, expectedBytes };
}

export function assertMonthCoverage(files, reference = new Date()) {
  const byMonth = new Map();
  for (const file of files) {
    const match = typeof file?.path === 'string' && file.path.match(/^meta\/(\d{4})\/\1-(0[1-9]|1[0-2])\.jsonl$/);
    if (!match) continue;
    const month = match[0].match(/(\d{4}-\d{2})\.jsonl$/)[1];
    if (byMonth.has(month)) throw Error(`Duplicate metadata file for ${month}`);
    byMonth.set(month, file);
  }
  const missing = requiredMonths(reference).filter(month => !byMonth.has(month));
  if (missing.length) throw Error(`Upstream is missing current-year metadata months: ${missing.join(', ')}`);
  return { months: [...byMonth.keys()].sort(), missing };
}

export function documentKeys(...values) {
  const keys = new Set();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const raw = String(value).trim();
    if (!raw) continue;
    const path = raw.split(/[?#]/)[0];
    const basename = path.split('/').at(-1);
    const stem = basename.replace(/\.pdf$/i, '');
    for (const key of [raw, basename, stem, `${stem}.pdf`]) if (key) keys.add(key);
  }
  return [...keys];
}

export function matchOcrRow(byKey, record) {
  for (const key of documentKeys(record?.doc_id, record?.pdf_file, record?.id, record?.file, record?.source_url)) {
    const row = byKey.get(key);
    if (row) return row;
  }
  return null;
}

export function coverageSummary(entries = [], reference = new Date()) {
  const currentMonth = monthKey(reference);
  const required = requiredMonths(currentMonth);
  const sorted = [...entries].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const available = new Map(sorted.map(entry => [entry.month, entry]));
  const missingMonths = required.filter(month => !available.has(month));
  const current = available.get(currentMonth);
  const ocrStatus = current?.ocrStatus || 'not-imported';
  return {
    status: missingMonths.length ? 'incomplete' : 'complete',
    currentMonth,
    latestMonth: sorted.at(-1)?.month || null,
    hasCurrentMonth: available.has(currentMonth),
    requiredMonths: required.length,
    missingMonths,
    publishedMonths: sorted.length,
    metadataBytes: sorted.reduce((sum, entry) => sum + (entry.byteLength || 0), 0),
    metadataLines: sorted.reduce((sum, entry) => sum + (entry.lineCount || 0), 0),
    records: sorted.reduce((sum, entry) => sum + (entry.count || 0), 0),
    skippedIncomplete: sorted.reduce((sum, entry) => sum + (entry.skippedIncomplete || 0), 0),
    ocrCount: sorted.reduce((sum, entry) => sum + (entry.ocrCount || 0), 0),
    ocrStatus,
    ocrComplete: !['unavailable', 'partial'].includes(ocrStatus),
    ocrUnavailable: sorted.filter(entry => entry.ocrStatus === 'unavailable').length,
    ocrPartial: sorted.filter(entry => entry.ocrStatus === 'partial').length,
    currentMonthCount: current?.count || 0,
  };
}
