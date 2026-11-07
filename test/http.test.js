import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/http.js';

test('shortcut receives a readable error without exposing credentials', async () => {
  const previous = process.env.COSTBRIDGE_TOKEN;
  process.env.COSTBRIDGE_TOKEN = 'test-token';
  try {
    let payload;
    const response = {setHeader() {}, end(data) { payload = JSON.parse(data); }};
    await handle({method:'POST', headers:{authorization:'Bearer wrong'}}, response);
    assert.equal(response.statusCode, 401);
    assert.equal(payload.shortcutResult, '访问凭据无效。');
    assert.doesNotMatch(JSON.stringify(payload), /test-token|wrong/);
  } finally {
    if (previous === undefined) delete process.env.COSTBRIDGE_TOKEN;
    else process.env.COSTBRIDGE_TOKEN = previous;
  }
});
