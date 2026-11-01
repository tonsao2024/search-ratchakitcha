import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPublishedData } from '../scripts/verify-data.mjs';
import { coverageSummary, requiredMonths } from '../src/sync-integrity.js';

const revision = 'pinned-revision';
const rowsFor = month => [{ id: `${month}-0001`, group: 'appointments', text: '' }];
const entryFor = month => {
  const rows = rowsFor(month);
  return {
    month,
    count: rows.length,
    scanned: rows.length,
    appointments: rows.length,
    removals: 0,
    nacc: 0,
    ocrCount: 0,
    ocrStatus: 'available',
    expectedBytes: 120,
    byteLength: 120,
    lineCount: rows.length,
  };
};

// A published dataset through `currentMonth`; `pendingMonth` is the calendar
// month upstream has not created a file for yet.
function published({ months = requiredMonths('2026-10'), currentMonth = '2026-10', pendingMonth = null, overrides = {} }) {
  const entries = months.map(month => ({ ...entryFor(month), ...overrides[month] }));
  return {
    source: 'https://huggingface.co/datasets/open-law-data-thailand/soc-ratchakitcha',
    revision,
    license: 'CC-BY-4.0',
    year: currentMonth.slice(0, 4),
    currentMonth,
    pendingMonth,
    latestMonth: currentMonth,
    complete: true,
    months: entries,
    yearFiles: [...new Set(months.map(month => month.slice(0, 4)))],
    ocrMonths: months,
    syncedAt: '2026-11-01T02:11:00.000Z',
    coverage: coverageSummary(entries, currentMonth, { pendingMonth }),
  };
}

function readerFor(manifest, broken = {}) {
  return async path => {
    for (const [suffix, value] of Object.entries(broken)) {
      if (path.endsWith(suffix)) return value;
    }
    const month = path.match(/(\d{4}-\d{2})\.json$/)?.[1];
    if (month) {
      const entry = manifest.months.find(item => item.month === month);
      return {
        complete: true, revision, rows: rowsFor(month), scanned: entry?.scanned ?? 1,
        byteLength: entry?.byteLength ?? 120, lineCount: entry?.lineCount ?? 1,
      };
    }
    const year = path.match(/(\d{4})\.json$/)?.[1];
    const months = manifest.months.filter(entry => entry.month.startsWith(`${year}-`));
    return {
      complete: true, revision,
      rows: months.flatMap(entry => rowsFor(entry.month)),
      scanned: months.reduce((sum, entry) => sum + entry.scanned, 0),
      months: months.map(entry => entry.month),
    };
  };
}

test('a manifest published through the newest upstream month verifies on the 1st', async () => {
  // The failing nightly: today is 2026-11, upstream has nothing newer than 2026-10.
  const manifest = published({ pendingMonth: '2026-11' });
  const result = await verifyPublishedData({ manifest, readJson: readerFor(manifest), reference: '2026-11' });
  assert.equal(result.month, '2026-10');
  assert.equal(result.pendingMonth, '2026-11');
  assert.equal(result.requestedMonth, '2026-11');
  assert.match(result.summary, /current month 2026-10: 1 rows/);
  assert.match(result.summary, /2026-11 not published upstream yet/);
});

test('the new year boundary verifies through December', async () => {
  const months = requiredMonths('2026-12');
  const manifest = published({ months, currentMonth: '2026-12', pendingMonth: '2027-01' });
  const result = await verifyPublishedData({ manifest, readJson: readerFor(manifest), reference: '2027-01' });
  assert.equal(result.month, '2026-12');
  assert.equal(result.pendingMonth, '2027-01');
});

test('a manifest that is current needs no pending month', async () => {
  const months = requiredMonths('2026-11');
  const manifest = published({ months, currentMonth: '2026-11' });
  const result = await verifyPublishedData({ manifest, readJson: readerFor(manifest), reference: '2026-11' });
  assert.equal(result.pendingMonth, null);
});

test('tolerance never hides a manifest that is older than the newest month', async () => {
  // Upstream stopped after September: two months are missing, so this is a real gap.
  const months = requiredMonths('2026-09');
  const manifest = published({ months, currentMonth: '2026-09' });
  await assert.rejects(
    verifyPublishedData({ manifest, readJson: readerFor(manifest), reference: '2026-11' }),
    /missing both 2026-11 and 2026-10/
  );
  // October data published as if November were already out.
  const ahead = published({ currentMonth: '2026-11' });
  await assert.rejects(
    verifyPublishedData({ manifest: ahead, readJson: readerFor(ahead), reference: '2026-11' }),
    /Manifest covers 2026-11, expected 2026-10/
  );
});

test('the published manifest must declare the same pending month', async () => {
  const undeclared = published({ pendingMonth: null });
  await assert.rejects(
    verifyPublishedData({ manifest: undeclared, readJson: readerFor(undeclared), reference: '2026-11' }),
    /pendingMonth is unset, expected 2026-11/
  );
  const invented = published({ pendingMonth: '2026-12' });
  await assert.rejects(
    verifyPublishedData({ manifest: invented, readJson: readerFor(invented), reference: '2026-11' }),
    /pendingMonth is 2026-12, expected 2026-11/
  );
});

test('an explicitly requested month cannot be substituted', async () => {
  const manifest = published({ pendingMonth: '2026-11' });
  await assert.rejects(
    verifyPublishedData({ manifest, readJson: readerFor(manifest), reference: '2026-11', allowPendingCurrentMonth: false }),
    /no metadata file for the requested month 2026-11/
  );
});

test('integrity failures in the newest published month still fail the gate', async () => {
  const truncated = published({ pendingMonth: '2026-11', overrides: { '2026-10': { byteLength: 999 } } });
  await assert.rejects(
    verifyPublishedData({ manifest: truncated, readJson: readerFor(truncated), reference: '2026-11' }),
    /2026-10: downloaded byte length differs from upstream/
  );
  const missingMonth = published({ months: requiredMonths('2026-10').filter(month => month !== '2026-05'), pendingMonth: '2026-11' });
  await assert.rejects(
    verifyPublishedData({ manifest: missingMonth, readJson: readerFor(missingMonth), reference: '2026-11' }),
    /month 2026-05 is missing/
  );
  const partialOcr = published({ pendingMonth: '2026-11', overrides: { '2026-10': { ocrStatus: 'partial' } } });
  await assert.rejects(
    verifyPublishedData({ manifest: partialOcr, readJson: readerFor(partialOcr), reference: '2026-11' }),
    /Current-month OCR is partial/
  );
});
