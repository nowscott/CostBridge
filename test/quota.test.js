import test from 'node:test';
import assert from 'node:assert/strict';
import { handleQuota } from '../src/quota.js';

test('returns the latest quota snapshot without credentials and handles unavailable storage', async () => {
 const oldDb = process.env.CALLLOG_DATABASE_URL;
 process.env.CALLLOG_DATABASE_URL = 'test-db';
 const res = () => ({setHeader() {}, end(data) { this.body = JSON.parse(data); }});
 try {
  const success = res(); const snapshot = {limits:{dailyRequestsRemaining:'12'},time:'2026-11-08T00:00:00Z',model:'test'};
  await handleQuota({method:'GET',headers:{}},success,async()=>snapshot);
  assert.deepEqual(success.body,{ok:true,snapshot});
  const empty = res(); await handleQuota({method:'GET',headers:{}},empty,async()=>null);
  assert.equal(empty.body.snapshot,null);
  const failed = res(); await handleQuota({method:'GET',headers:{}},failed,async()=>{throw new Error('database');});
  assert.equal(failed.statusCode,503); assert.equal(failed.body.error.code,'quota_unavailable');
  const wrongMethod = res(); await handleQuota({method:'POST',headers:{}},wrongMethod,async()=>snapshot);
  assert.equal(wrongMethod.statusCode,405);
 } finally {
  if (oldDb === undefined) delete process.env.CALLLOG_DATABASE_URL; else process.env.CALLLOG_DATABASE_URL = oldDb;
 }
});
