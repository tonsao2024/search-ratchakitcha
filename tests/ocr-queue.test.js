import test from 'node:test';
import assert from 'node:assert/strict';
import { createOcrQueue } from '../src/ocr-queue.js';

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

test('queue runs jobs one at a time and reports full lifecycle', async () => {
  const order = [];
  const queue = createOcrQueue({
    runJob: async (payload, { jobId }) => {
      order.push([jobId, 'start', payload]);
      await tick(10);
      order.push([jobId, 'end', payload]);
      return { text: `text-${payload.id}` };
    },
  });
  const first = queue.submit({ id: 'a' });
  const second = queue.submit({ id: 'b' });
  assert.equal(queue.size(), 2);
  assert.equal(queue.get(first).status, 'running');
  assert.equal(queue.get(second).status, 'queued');
  await tick(50);
  assert.equal(queue.get(first).status, 'done');
  assert.deepEqual(queue.get(first).result, { text: 'text-a' });
  assert.equal(queue.get(second).status, 'done');
  assert.equal(order[0][1], 'start');
  assert.deepEqual(order[0][2], { id: 'a' });
  assert.equal(order[1][1], 'end');
  assert.equal(order[2][0], second, 'second job starts only after the first finishes');
  assert.equal(queue.size(), 0);
});

test('queue records runJob errors without rejecting the submitter', async () => {
  const queue = createOcrQueue({ runJob: async () => { throw Error('boom'); } });
  const id = queue.submit({ id: 'a' });
  await tick(20);
  const job = queue.get(id);
  assert.equal(job.status, 'error');
  assert.equal(job.error, 'boom');
});

test('queue sweeps finished jobs after ttl and rejects bad options', async () => {
  let now = 1000;
  const queue = createOcrQueue({ runJob: async () => ({ ok: true }), ttlMs: 100, now: () => now });
  const id = queue.submit({});
  await tick(5);
  assert.equal(queue.get(id).status, 'done');
  now += 200;
  assert.equal(queue.get(id), null);
  assert.throws(() => createOcrQueue({}), /runJob/);
});
