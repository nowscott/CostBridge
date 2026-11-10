import test from 'node:test';
import assert from 'node:assert/strict';
import cleanup from '../api/cleanup-call-logs.js';

function withEnv(vars, fn) {
  const previous = Object.fromEntries(Object.keys(vars).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test('cleanup rejects requests without the cron secret', async () => {
  await withEnv({ CRON_SECRET: 'cron-test-secret' }, async () => {
    const response = {end() { this.ended = true; }};
    await cleanup({headers:{}}, response);
    assert.equal(response.statusCode, 401);
    assert.equal(response.ended, true);
  });
});

test('cleanup skips safely when the database is not configured', async () => {
  await withEnv({ CRON_SECRET: 'cron-test-secret', CALLLOG_DATABASE_URL: undefined }, async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const response = {end() { this.ended = true; }};
      await cleanup({headers:{authorization:'Bearer cron-test-secret'}}, response);
      assert.equal(response.statusCode, 503);
      assert.equal(response.ended, true);
    } finally {
      console.error = originalError;
    }
  });
});
