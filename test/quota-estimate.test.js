import test from 'node:test';
import assert from 'node:assert/strict';
import { resetAfterMs, estimateQuota } from '../public/quota-estimate.js';

test('parses Groq reset durations and estimates only after the reset time', () => {
 assert.equal(resetAfterMs('1h2m3.5s'), 3723500);
 assert.equal(resetAfterMs('250ms'), 250);
 assert.equal(resetAfterMs('invalid'), null);
 const time = '2026-11-08T00:00:00Z', start = Date.parse(time);
 assert.deepEqual(estimateQuota('4', '10', '1m', time, start + 59999), {remaining:'4', estimated:false});
 assert.deepEqual(estimateQuota('4', '10', '1m', time, start + 60000), {remaining:'10', estimated:true});
 assert.deepEqual(estimateQuota('4', '10', null, time, start + 60000), {remaining:'4', estimated:false});
});
