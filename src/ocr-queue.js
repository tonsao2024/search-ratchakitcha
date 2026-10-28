// Single-flight job queue for on-demand OCR (the "OCR ฉบับนี้" button).
// Jobs are small state machines: queued -> running -> done | error. One worker
// at a time keeps CPU and memory bounded while tesseract processes a PDF.
// No internal timers: stale finished jobs are swept lazily on submit/get so
// tests and the server lifecycle stay in control of time.

export function createOcrQueue({ runJob, concurrency = 1, ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  if (typeof runJob !== 'function') throw Error('runJob is required');
  const jobs = new Map();
  const queue = [];
  let active = 0;
  let seq = 0;

  function sweepStale() {
    const current = now();
    for (const [id, job] of jobs) {
      const finished = job.status === 'done' || job.status === 'error';
      if (finished && job.finishedAt && current - job.finishedAt > ttlMs) jobs.delete(id);
    }
  }

  function pump() {
    while (active < concurrency && queue.length) {
      const id = queue.shift();
      const job = jobs.get(id);
      if (!job || job.status !== 'queued') continue;
      active += 1;
      job.status = 'running';
      job.startedAt = now();
      Promise.resolve()
        .then(() => runJob(job.payload, { jobId: id }))
        .then(result => {
          job.status = 'done';
          job.result = result || {};
        })
        .catch(error => {
          job.status = 'error';
          job.error = String(error?.message || error);
        })
        .finally(() => {
          active -= 1;
          job.finishedAt = now();
          pump();
        });
    }
  }

  function submit(payload) {
    sweepStale();
    const id = `ocr-${++seq}`;
    const job = { id, status: 'queued', payload, createdAt: now() };
    jobs.set(id, job);
    queue.push(id);
    pump();
    return id;
  }

  function get(id) {
    sweepStale();
    return jobs.get(id) || null;
  }

  return {
    submit,
    get,
    size: () => queue.length + active,
  };
}
