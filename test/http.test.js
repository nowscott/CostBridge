import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/http.js';

test('rejects invalid or disabled user keys without exposing credentials', async () => {
  const previous = process.env.UNKEY_ROOT_KEY, originalFetch = globalThis.fetch;
  process.env.UNKEY_ROOT_KEY = 'test-root-key';
  globalThis.fetch = async () => ({ok:true,json:async()=>({data:{valid:false}})});
  try {
    let payload;
    const response = {setHeader() {}, end(data) { payload = JSON.parse(data); }};
    await handle({method:'POST',headers:{authorization:'Bearer wrong'}},response);
    assert.equal(response.statusCode,401);
    assert.match(payload.shortcutResult,/无效或已停用/);
    assert.doesNotMatch(JSON.stringify(payload),/test-root-key|wrong/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.UNKEY_ROOT_KEY;
    else process.env.UNKEY_ROOT_KEY = previous;
  }
});

test('reports authorization service failure separately', async () => {
  const previous = process.env.UNKEY_ROOT_KEY, originalFetch = globalThis.fetch;
  process.env.UNKEY_ROOT_KEY = 'test-root-key';
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    let payload;
    const response = {setHeader() {}, end(data) { payload = JSON.parse(data); }};
    await handle({method:'POST',headers:{authorization:'Bearer test'}},response);
    assert.equal(response.statusCode,503);
    assert.equal(payload.error.code,'auth_unavailable');
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.UNKEY_ROOT_KEY;
    else process.env.UNKEY_ROOT_KEY = previous;
  }
});
