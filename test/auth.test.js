import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccessKey } from '../src/auth.js';

const rootKey = 'unkey_root_secret';
const accessKey = 'user_access_secret';
const reply = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

test('accepts a valid key and sends the access key to Unkey', async () => {
  let request;
  const data = await verifyAccessKey(accessKey, {
    rootKey,
    fetcher: async (url, options) => {
      request = { url, options };
      return reply({ data: { valid: true, code: 'VALID' } });
    }
  });
  assert.equal(data.valid, true);
  assert.equal(request.url, 'https://api.unkey.com/v2/keys.verifyKey');
  assert.equal(request.options.headers.authorization, `Bearer ${rootKey}`);
  assert.deepEqual(JSON.parse(request.options.body), { key: accessKey });
});

test('explains why a key was rejected without echoing the key', async () => {
  const cases = [
    ['NOT_FOUND', /无效/],
    ['DISABLED', /停用/],
    ['EXPIRED', /过期/],
    ['USAGE_EXCEEDED', /额度/],
    ['RATE_LIMITED', /受限/],
    ['FORBIDDEN', /无权/],
    ['SOMETHING_NEW', /无效或已停用/]
  ];
  for (const [code, message] of cases) {
    const fetcher = async () => reply({ data: { valid: false, code } });
    await assert.rejects(verifyAccessKey(accessKey, { rootKey, fetcher }), error => {
      assert.equal(error.status, 401);
      assert.equal(error.code, 'unauthorized');
      assert.match(error.message, message);
      assert.ok(!error.message.includes(accessKey));
      return true;
    });
  }
});

test('treats unexpected Unkey responses as an unavailable service', async () => {
  for (const payload of [{ data: {} }, { data: { valid: 'yes' } }, { meta: {} }, null]) {
    await assert.rejects(verifyAccessKey(accessKey, { rootKey, fetcher: async () => reply(payload) }), error => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'auth_unavailable');
      return true;
    });
  }
  await assert.rejects(verifyAccessKey(accessKey, {
    rootKey,
    fetcher: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('not json'); } })
  }), error => error.code === 'auth_unavailable' && /无法识别/.test(error.message));
});

test('separates Unkey outages, rate limiting and missing configuration', async () => {
  await assert.rejects(verifyAccessKey(accessKey, { rootKey, fetcher: async () => reply(null, 429) }),
    error => error.code === 'auth_unavailable' && /繁忙/.test(error.message));
  await assert.rejects(verifyAccessKey(accessKey, { rootKey, fetcher: async () => reply(null, 500) }),
    error => error.code === 'auth_unavailable' && /不可用/.test(error.message));
  await assert.rejects(verifyAccessKey(accessKey, { rootKey, fetcher: async () => { throw new Error('offline'); } }),
    error => error.code === 'auth_unavailable' && /连接失败/.test(error.message));
  let called = false;
  await assert.rejects(verifyAccessKey(accessKey, { fetcher: async () => { called = true; } }), error => {
    assert.equal(error.status, 500);
    assert.equal(error.code, 'configuration_error');
    assert.ok(!error.message.includes(rootKey));
    return true;
  });
  assert.equal(called, false);
});

test('falls back for inherited property names in the key code', async () => {
  for (const code of ['constructor', '__proto__', 'toString']) {
    await assert.rejects(verifyAccessKey(accessKey, { rootKey, fetcher: async () => reply({ data: { valid: false, code } }) }), error => {
      assert.equal(error.status, 401);
      assert.equal(error.message, '访问凭据无效或已停用。');
      return true;
    });
  }
});
