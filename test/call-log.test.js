import test from 'node:test';
import assert from 'node:assert/strict';
import cleanup from '../api/cleanup-call-logs.js';

test('cleanup rejects requests without the cron secret', async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'cron-test-secret';
  try {
    const response = {end() { this.ended = true; }};
    await cleanup({headers:{}}, response);
    assert.equal(response.statusCode, 401);
    assert.equal(response.ended, true);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
