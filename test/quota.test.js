import test from 'node:test';
import assert from 'node:assert/strict';
import { handleQuota } from '../src/quota.js';

test('requires access and returns only the latest quota snapshot', async () => {
 const oldRoot = process.env.UNKEY_ROOT_KEY, oldDb = process.env.CALLLOG_DATABASE_URL, oldFetch = globalThis.fetch;
 process.env.UNKEY_ROOT_KEY = 'test-root'; process.env.CALLLOG_DATABASE_URL = 'test-db';
 globalThis.fetch = async () => ({ok:true,json:async()=>({data:{valid:true}})});
 const res = () => ({setHeader() {}, end(data) { this.body = JSON.parse(data); }});
 try {
  const denied = res(); await handleQuota({method:'GET',headers:{}},denied,()=>{ throw new Error('must not read'); });
  assert.equal(denied.statusCode,401);
  const success = res(); const snapshot = {limits:{dailyRequestsRemaining:'12'},time:'2026-11-08T00:00:00Z',model:'test'};
  await handleQuota({method:'GET',headers:{authorization:'Bearer test'}},success,async()=>snapshot);
  assert.deepEqual(success.body,{ok:true,snapshot});
  const empty = res(); await handleQuota({method:'GET',headers:{authorization:'Bearer test'}},empty,async()=>null);
  assert.equal(empty.body.snapshot,null);
  const failed = res(); await handleQuota({method:'GET',headers:{authorization:'Bearer test'}},failed,async()=>{throw new Error('database');});
  assert.equal(failed.statusCode,503); assert.equal(failed.body.error.code,'quota_unavailable');
 } finally {
  globalThis.fetch = oldFetch;
  if (oldRoot === undefined) delete process.env.UNKEY_ROOT_KEY; else process.env.UNKEY_ROOT_KEY = oldRoot;
  if (oldDb === undefined) delete process.env.CALLLOG_DATABASE_URL; else process.env.CALLLOG_DATABASE_URL = oldDb;
 }
});
