import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCreateKey } from '../src/create-key.js';

test('creates only for the configured API and returns the key without exposing the root key', async () => {
  const previous = process.env.UNKEY_CREATE_API_ID;
  process.env.UNKEY_CREATE_API_ID = 'api_test';
  try {
    let request;
    const res = {setHeader() {}, end(data) {this.body = JSON.parse(data);}};
    await handleCreateKey({method:'POST',headers:{authorization:'Bearer root-test'},body:{name:' 测试 ',apiId:'api_other'}},res,async (url, options) => {
      request = {url, ...options};
      return {ok:true,status:200,json:async()=>({data:{key:'cb_test',keyId:'key_id'}})};
    });
    assert.equal(request.url,'https://api.unkey.com/v2/keys.createKey');
    assert.deepEqual(JSON.parse(request.body),{apiId:'api_test',name:'测试',prefix:'cb',byteLength:32});
    assert.equal(request.headers.authorization,'Bearer root-test');
    assert.deepEqual(res.body,{ok:true,message:'Key 已生成并复制到剪贴板。',key:'cb_test'});
    assert.doesNotMatch(JSON.stringify(res.body),/root-test|key_id/);
  } finally {
    if (previous === undefined) delete process.env.UNKEY_CREATE_API_ID; else process.env.UNKEY_CREATE_API_ID = previous;
  }
});

test('never returns a key for errors or missing key in a successful response', async () => {
  const previous = process.env.UNKEY_CREATE_API_ID;
  process.env.UNKEY_CREATE_API_ID = 'api_test';
  try {
    for (const [upstream, pattern] of [
      [{ok:false,status:401},/无效或权限不足/],
      [{ok:false,status:403},/无效或权限不足/],
      [{ok:false,status:429},/频繁/],
      [{ok:false,status:500},/HTTP 500/],
      [{ok:true,status:200,json:async()=>({data:{keyId:'id'}})},/未返回/],
      [null,/可能已经创建/]
    ]) {
      const res = {setHeader() {}, end(data) {this.body = JSON.parse(data);}};
      await handleCreateKey({method:'POST',headers:{authorization:'Bearer root-test'},body:{name:'测试'}},res,async()=>{if (!upstream) throw Error('offline'); return upstream;});
      assert.equal(res.body.ok,false);
      assert.equal(res.body.key,'');
      assert.match(res.body.message,pattern);
      assert.doesNotMatch(JSON.stringify(res.body),/root-test/);
    }
    const res = {setHeader() {}, end(data) {this.body = JSON.parse(data);}};
    await handleCreateKey({method:'POST',headers:{authorization:'Bearer root-test'},body:{name:'  '}},res,()=>{throw Error('must not call');});
    assert.equal(res.body.ok,false);
  } finally {
    if (previous === undefined) delete process.env.UNKEY_CREATE_API_ID; else process.env.UNKEY_CREATE_API_ID = previous;
  }
});
