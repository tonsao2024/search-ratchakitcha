import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { monthKey, requiredMonths, shiftMonth } from '../src/sync-integrity.js';

// End-to-end month-boundary guard: on the first days of a month the upstream
// dataset has no metadata file for it yet, and run 41264058128 failed exactly
// there. These tests drive the real sync/verify scripts against a fake upstream.

const scriptPath = name => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));

const record = (month, index) => JSON.stringify({
  id: `${month}-000${index}`,
  doctitle: `ประกาศ สำนักนายกรัฐมนตรี เรื่อง แต่งตั้งข้าราชการพลเรือนสามัญ คนที่ ${index}`,
  publishDate: `${month}-0${index + 1}-15`,
  pdf_file: `${month}-000${index}.pdf`,
  source_url: `https://ratchakitcha.soc.ee/eyJz/documents/${month}-000${index}.pdf`,
});

// A minimal stand-in for the Hugging Face dataset API: `meta/<year>/<month>.jsonl`
// listings with real byte sizes plus the matching resolve downloads. Only the
// months in `months` exist, exactly like a month upstream has not published.
async function fakeUpstream(months) {
  const files = new Map();
  const years = new Set();
  for (const month of months) {
    const year = month.slice(0, 4);
    years.add(year);
    files.set(`meta/${year}/${month}.jsonl`, Buffer.from(`${record(month, 1)}\n${record(month, 2)}\n`, 'utf8'));
  }
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const json = (value, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    const tree = pathname.match(/^\/api\/datasets\/(.+?)\/tree\/[^/]+\/(.+)$/);
    if (tree) {
      const directory = decodeURIComponent(tree[2]).replace(/\/$/, '');
      if (directory === 'meta') return json([...years].sort().map(year => ({ type: 'directory', path: `meta/${year}` })));
      const year = directory.match(/^meta\/(\d{4})$/)?.[1];
      if (year) {
        return json([...files].filter(([path]) => path.startsWith(`meta/${year}/`))
          .map(([path, body]) => ({ type: 'file', path, size: body.byteLength })));
      }
      return json([]); // no upstream OCR in this fixture
    }
    if (/^\/api\/datasets\/.+/.test(pathname)) return json({ sha: 'fake-revision', lastModified: '2026-01-01T00:00:00.000Z' });
    const resolve = pathname.match(/^\/datasets\/(.+?)\/resolve\/[^/]+\/(.+)$/);
    if (resolve) {
      const body = files.get(decodeURIComponent(resolve[2]));
      if (!body) return json({ error: 'not found' }, 404);
      response.writeHead(200, { 'content-type': 'application/x-ndjson', 'content-length': body.byteLength });
      return response.end(body);
    }
    return json({ error: 'not found' }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

// The fake upstream is served from this process, so the scripts must run
// asynchronously: a synchronous spawn would deadlock on the first request.
function runScript(name, cwd, env) {
  const childEnv = { ...process.env, ...env, HF_MAX_ATTEMPTS: '1', HF_REQUEST_INTERVAL_MS: '0', HF_CONCURRENCY: '4' };
  if (!env.DATA_MONTH) delete childEnv.DATA_MONTH;
  return new Promise(resolve => {
    execFile(process.execPath, [scriptPath(name)], { cwd, encoding: 'utf8', env: childEnv, timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ status: error ? error.code ?? 1 : 0, output: `${stdout || ''}${stderr || ''}` }));
  });
}

async function workspace() {
  return mkdtemp(`${tmpdir()}/ratcha-sync-`);
}

test('the importer publishes through the newest upstream month when the current one is missing', async () => {
  const current = monthKey(new Date());
  const lastPublished = shiftMonth(current, -1);
  const upstream = await fakeUpstream(requiredMonths(lastPublished));
  const dir = await workspace();
  try {
    const sync = await runScript('sync-data.mjs', dir, { HF_API_BASE: upstream.url });
    assert.equal(sync.status, 0, sync.output);
    assert.match(sync.output, /not published upstream yet, publishing through/);
    const manifest = JSON.parse(await readFile(`${dir}/public/data/manifest.json`, 'utf8'));
    assert.equal(manifest.currentMonth, lastPublished);
    assert.equal(manifest.pendingMonth, current);
    assert.equal(manifest.requestedMonth, current);
    assert.equal(manifest.complete, true);
    assert.equal(manifest.coverage.status, 'complete');
    assert.equal(manifest.total, 2 * requiredMonths(lastPublished).length);
    // The verified manifest is what the Pages deploy gate then checks.
    const verify = await runScript('verify-data.mjs', dir, {});
    assert.equal(verify.status, 0, verify.output);
    assert.match(verify.output, /Published data integrity verified/);
  } finally {
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a gap older than the unpublished month still fails the importer', async () => {
  const current = monthKey(new Date());
  // Upstream stopped a month before the newest missing month: a real outage.
  const upstream = await fakeUpstream(requiredMonths(shiftMonth(current, -2)));
  const dir = await workspace();
  try {
    const sync = await runScript('sync-data.mjs', dir, { HF_API_BASE: upstream.url });
    assert.notEqual(sync.status, 0);
    assert.match(sync.output, new RegExp(`missing both ${current} and ${shiftMonth(current, -1)}`));
  } finally {
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('an explicitly requested month is never substituted with an older one', async () => {
  const current = monthKey(new Date());
  const upstream = await fakeUpstream(requiredMonths(shiftMonth(current, -1)));
  const dir = await workspace();
  try {
    const sync = await runScript('sync-data.mjs', dir, { HF_API_BASE: upstream.url, DATA_MONTH: current });
    assert.notEqual(sync.status, 0);
    assert.match(sync.output, new RegExp(`no metadata file for the requested month ${current}`));
  } finally {
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
});
