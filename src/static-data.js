import { coverageSummary } from './sync-integrity.js';

export function selectMonths(manifest, month, { all = false, year = month.slice(0, 4), years, range, fallbackToLatest = false, clampUnknownYears = false } = {}) {
  const allAvailable = manifest.months.map(item => item.month).sort();
  let available = allAvailable;
  if (years !== undefined && years !== null) {
    if (!Array.isArray(years) || !years.length) throw Error('กรุณาเลือกอย่างน้อยหนึ่งปี');
    const known = new Set(allAvailable.map(item => item.slice(0, 4)));
    // The default rolling year window may include years upstream has not
    // published yet; when clamping is allowed, load the published subset
    // instead of failing the whole load.
    const requested = years.filter(value => known.has(value));
    if (requested.length < years.length && !clampUnknownYears) throw Error('บางปีที่เลือกยังไม่มีข้อมูลในฐาน');
    available = available.filter(item => requested.includes(item.slice(0, 4)));
  }
  const fallbackMonth = () => (available.length ? available : allAvailable).at(-1) || null;
  if (range) {
    const from = range.from?.slice(0, 7) || available[0], to = range.to?.slice(0, 7) || available.at(-1);
    if (from > to) throw Error('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
    const selected = available.filter(item => item >= from && item <= to);
    if (!selected.length) {
      if (fallbackToLatest) {
        const fallback = fallbackMonth();
        if (fallback) return [fallback];
      }
      throw Error('ต้นทางไม่มีไฟล์ข้อมูลในช่วงวันที่ที่เลือก');
    }
    return selected;
  }
  const selected = all ? (years !== undefined ? available : available.filter(item => item.startsWith(`${year}-`))) : [month];
  if (!selected.length || selected.some(item => !available.includes(item))) {
    if (fallbackToLatest) {
      const fallback = fallbackMonth();
      if (fallback) return [fallback];
    }
    throw Error(`ยังไม่มีข้อมูลสำหรับ ${all ? year : month}`);
  }
  return selected;
}

export async function loadPublishedData(base, month, { all = false, year = month.slice(0, 4), years, range, onProgress, fetcher = fetch, fallbackToLatest = false, clampUnknownYears = false } = {}) {
  const options = { cache: 'no-store', signal: AbortSignal.timeout(180000) };
  const manifestResponse = await fetcher(`${base}data/manifest.json`, options);
  if (!manifestResponse.ok) throw Error('ยังไม่พบข้อมูลที่เผยแพร่');
  const manifest = await manifestResponse.json();
  if (!Array.isArray(manifest.months) || !manifest.months.length) throw Error('Published manifest is empty');
  if (manifest.complete === false) throw Error('ชุดข้อมูลที่เผยแพร่ยังไม่ครบถ้วน กรุณารอการซิงก์ครั้งถัดไป');

  const months = selectMonths(manifest, month, { all, year, years, range, fallbackToLatest, clampUnknownYears });
  // A specific month that could not be loaded collapses to one fallback month
  // and is reported as such; a whole-year window that still has data is not.
  const fallbackTo = fallbackToLatest && !all && !months.includes(month) ? months[0] : null;
  const entryByMonth = new Map(manifest.months.map(entry => [entry.month, entry]));
  // Use one annual bundle instead of twelve monthly requests whenever a complete year is selected.
  const selectedYears = [...new Set(months.map(item => item.slice(0, 4)))].sort();
  const resources = selectedYears.flatMap(value => {
    const subset = months.filter(item => item.startsWith(`${value}-`));
    const completeYear = subset.length === manifest.months.filter(item => item.month.startsWith(`${value}-`)).length;
    return completeYear && manifest.yearFiles?.includes(value) ? [value] : subset;
  });
  const batches = [];
  let next = 0, finished = 0;
  onProgress?.({ loaded: 0, total: resources.length });
  await Promise.all(Array.from({ length: Math.min(6, resources.length) }, async () => {
    while (next < resources.length) {
      const index = next++;
      const key = resources[index];
      const response = await fetcher(`${base}data/${key}.json`, options);
      if (!response.ok) throw Error(`โหลด ${key} ไม่สำเร็จ`);
      const data = await response.json();
      if (!data.complete || !Array.isArray(data.rows) || data.revision !== manifest.revision) {
        throw Error('ข้อมูลระหว่างเผยแพร่ไม่ตรงกัน กรุณารีเฟรชอีกครั้ง');
      }
      const expectedEntries = key.length === 4
        ? manifest.months.filter(entry => entry.month.startsWith(`${key}-`))
        : [entryByMonth.get(key)].filter(Boolean);
      const expectedRows = expectedEntries.reduce((sum, entry) => sum + (typeof entry.count === 'number' ? entry.count : 0), 0);
      if (expectedEntries.length && expectedEntries.every(entry => typeof entry.count === 'number') && data.rows.length !== expectedRows) {
        throw Error(`จำนวนประกาศใน ${key} ไม่ตรงกับรายการที่เผยแพร่`);
      }
      if (key.length === 7) {
        const entry = entryByMonth.get(key);
        if (entry && typeof entry.expectedBytes === 'number' && entry.expectedBytes > 0 && data.byteLength !== entry.expectedBytes) {
          throw Error(`ไฟล์ ${key} ดาวน์โหลดไม่ครบถ้วน`);
        }
      }
      batches[index] = data;
      onProgress?.({ loaded: ++finished, total: resources.length });
    }
  }));

  const syncAge = Date.now() - Date.parse(manifest.syncedAt);
  const coverage = manifest.coverage?.status
    ? manifest.coverage
    : coverageSummary(manifest.months, manifest.currentMonth || month);
  return {
    rows: [...new Map(batches.flatMap(data => data.rows).map(row => [row.id, row])).values()],
    selectedYears,
    allYears: years === null && !range,
    month: months.length > 1 ? `${months[0]} – ${months.at(-1)}` : months[0],
    requestedMonth: month,
    fallbackTo,
    coverage,
    currentMonth: coverage.currentMonth,
    latestMonth: manifest.latestMonth || coverage.latestMonth,
    source: manifest.source,
    complete: true,
    stale: !Number.isFinite(syncAge) || syncAge > 48 * 3600000,
    connectedAt: manifest.syncedAt,
    revision: manifest.revision,
    availableMonths: manifest.months,
    availableYears: [...new Set(manifest.months.map(item => item.month.slice(0, 4)))].sort().reverse(),
    loadedMonths: months,
    scanned: batches.reduce((sum, data) => sum + data.scanned, 0),
    published: true,
  };
}
