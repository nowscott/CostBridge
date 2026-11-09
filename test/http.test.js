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

test('rejects unsupported methods and missing credentials before verification', async () => {
 const previous = process.env.UNKEY_ROOT_KEY;
 process.env.UNKEY_ROOT_KEY = 'test-root-key';
 try {
  const unsupported = {setHeader() {}, end(data) { this.payload = JSON.parse(data); }};
  await handle({method:'GET',headers:{}},unsupported);
  assert.equal(unsupported.statusCode,405);
  const unauthorized = {setHeader() {}, end(data) { this.payload = JSON.parse(data); }};
  await handle({method:'POST',headers:{}},unauthorized);
  assert.equal(unauthorized.statusCode,401);
  assert.equal(unauthorized.payload.error.code,'unauthorized');
 } finally {
  if (previous === undefined) delete process.env.UNKEY_ROOT_KEY;
  else process.env.UNKEY_ROOT_KEY = previous;
 }
});

test('rejects oversized request bodies before calling the model', async () => {
 const previous = process.env.UNKEY_ROOT_KEY, originalFetch = globalThis.fetch;
 process.env.UNKEY_ROOT_KEY = 'test-root-key';
 globalThis.fetch = async () => ({ok:true,status:200,json:async()=>({data:{valid:true}})});
 try {
  let payload;
  const response = {setHeader() {}, end(data) { payload = JSON.parse(data); }};
  const req = {method:'POST',headers:{authorization:'Bearer test'},async *[Symbol.asyncIterator]() { yield Buffer.alloc(2_200_000); yield Buffer.alloc(2_200_000); }};
  await handle(req,response);
  assert.equal(response.statusCode,413);
  assert.equal(payload.error.code,'too_large');
 } finally {
  globalThis.fetch = originalFetch;
  if (previous === undefined) delete process.env.UNKEY_ROOT_KEY;
  else process.env.UNKEY_ROOT_KEY = previous;
 }
});

test('rejects malformed JSON after authorization', async () => {
 const previous = process.env.UNKEY_ROOT_KEY, originalFetch = globalThis.fetch;
 process.env.UNKEY_ROOT_KEY = 'test-root-key';
 globalThis.fetch = async () => ({ok:true,status:200,json:async()=>({data:{valid:true}})});
 try {
  let payload;
  const response = {setHeader() {}, end(data) { payload = JSON.parse(data); }};
  await handle({method:'POST',headers:{authorization:'Bearer test'},body:'not json'},response);
  assert.equal(response.statusCode,400);
  assert.equal(payload.error.code,'invalid_json');
 } finally {
  globalThis.fetch = originalFetch;
  if (previous === undefined) delete process.env.UNKEY_ROOT_KEY;
  else process.env.UNKEY_ROOT_KEY = previous;
 }
});

test('accepts a pre-parsed body from the platform and returns a preview', async () => {
 const previousRoot = process.env.UNKEY_ROOT_KEY, previousModel = process.env.GROQ_API_KEY, originalFetch = globalThis.fetch;
 process.env.UNKEY_ROOT_KEY = 'test-root-key';
 process.env.GROQ_API_KEY = 'test-model-key';
 globalThis.fetch = async (url) => String(url).includes('unkey')
  ? {ok:true,status:200,json:async()=>({data:{valid:true,keyId:'key_example_123'}})}
  : {ok:true,status:200,headers:new Headers({'x-ratelimit-remaining-requests':'987','x-ratelimit-limit-requests':'1000'}),json:async()=>({choices:[{message:{content:JSON.stringify({date:'2026/11/07 15:30',type:'支出',amount:-12.5,category:'餐饮',remark:'午餐',account:'储蓄卡'})}}],usage:{total_tokens:123}})};
 try {
  let payload, record;
  const response = {setHeader() {}, end(data) { payload = JSON.parse(data); }};
  await handle({method:'POST',headers:{authorization:'Bearer test'},body:{text:'午餐 12.50 元',expenseCategories:['餐饮','其他'],incomeCategories:['工资'],accounts:['信用卡','储蓄卡'],defaultAccount:'信用卡',ruleAccount:'信用卡',now:'2026/11/07 16:06'}},response, value => { record = value; });
  assert.equal(response.statusCode,200);
  assert.equal(payload.ok,true);
  assert.equal(record.keyId,'key_example_123');
  assert.doesNotMatch(JSON.stringify(record),/test-root-key|test-model-key|午餐/);
  assert.equal(payload.transaction.amount,-12.5);
  assert.match(payload.preview,/12\.50/);
  assert.match(payload.preview,/今日请求剩余  987 \/ 1000 次\n⏱️ 请求耗时/);
  assert.doesNotMatch(payload.preview,/123 tokens/);
  assert.match(payload.icostUrl,/^iCost:\/\/expense\?/);
  assert.equal(payload.shortcutResult,'OK');
 } finally {
  globalThis.fetch = originalFetch;
  if (previousRoot === undefined) delete process.env.UNKEY_ROOT_KEY;
  else process.env.UNKEY_ROOT_KEY = previousRoot;
  if (previousModel === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = previousModel;
 }
});

test('records diagnostic metadata without request content or credentials after responding', async () => {
  const previousRoot = process.env.UNKEY_ROOT_KEY, originalFetch = globalThis.fetch;
  process.env.UNKEY_ROOT_KEY = 'root-secret';
  globalThis.fetch = async () => ({ok:true,status:200,json:async()=>({data:{valid:false}})});
  try {
    let ended = false, record;
    const res = {setHeader() {}, end() { ended = true; }};
    await handle({method:'POST',headers:{authorization:'Bearer user-secret'},body:{text:'private-bill'}}, res, value => {
      assert.equal(ended,true);
      record = value;
    });
    assert.equal(record.status,401);
    assert.equal(record.stage,'auth');
    assert.equal(record.keyId,undefined);
    assert.equal(typeof record.authMs,'number');
    assert.doesNotMatch(JSON.stringify(record),/root-secret|user-secret|private-bill/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousRoot === undefined) delete process.env.UNKEY_ROOT_KEY;
    else process.env.UNKEY_ROOT_KEY = previousRoot;
  }
});

test('records the verified key ID when a later step fails', async () => {
 const previous = process.env.UNKEY_ROOT_KEY, originalFetch = globalThis.fetch;
 process.env.UNKEY_ROOT_KEY = 'root-secret';
 globalThis.fetch = async () => ({ok:true,status:200,json:async()=>({data:{valid:true,keyId:'key_example_123'}})});
 try {
  let record;
  const res = {setHeader() {}, end() {}};
  await handle({method:'POST',headers:{authorization:'Bearer access-secret'},body:{}}, res, value => { record = value; });
  assert.equal(record.status,400);
  assert.equal(record.keyId,'key_example_123');
  assert.doesNotMatch(JSON.stringify(record),/access-secret|root-secret/);
 } finally {
  globalThis.fetch = originalFetch;
  if (previous === undefined) delete process.env.UNKEY_ROOT_KEY;
  else process.env.UNKEY_ROOT_KEY = previous;
 }
});

test('uses the configured Qianwen platform key when Groq is unavailable', async () => {
 const oldRoot = process.env.UNKEY_ROOT_KEY, oldGroq = process.env.GROQ_API_KEY, oldQwen = process.env.QWEN_API_KEY, originalFetch = globalThis.fetch;
 process.env.UNKEY_ROOT_KEY = 'root-test'; process.env.GROQ_API_KEY = 'groq-test'; process.env.QWEN_API_KEY = 'qwen-test';
 let fallbackRequest, record, payload;
 globalThis.fetch = async (url, options) => {
  if (String(url).includes('unkey')) return {ok:true,status:200,json:async()=>({data:{valid:true,keyId:'key_test'}})};
  if (String(url).includes('groq.com')) return {ok:false,status:503};
  fallbackRequest = {url, options};
  return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({date:'2026/11/07 15:30',type:'支出',amount:-12.5,category:'餐饮',remark:'午餐',account:'储蓄卡'})}}]})};
 };
 try {
  const res = {setHeader() {}, end(data) { payload = JSON.parse(data); }};
  await handle({method:'POST',headers:{authorization:'Bearer access-test'},body:{text:'午餐 12.50 元',expenseCategories:['餐饮'],incomeCategories:['工资'],accounts:['储蓄卡'],defaultAccount:'储蓄卡',now:'2026/11/07 16:06'}}, res, value => {record=value;});
  assert.equal(res.statusCode,200);
  assert.equal(fallbackRequest.url,'https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions');
  assert.equal(fallbackRequest.options.headers.authorization,'Bearer qwen-test');
  assert.equal(record.usedFallback,true);
  assert.match(payload.preview,/千问 · 𝓠𝔀𝓮𝓷 𝟑\.𝟖 𝓕𝓵𝓪𝓼𝓱/);
 } finally {
  globalThis.fetch = originalFetch;
  for (const [name,value] of [['UNKEY_ROOT_KEY',oldRoot],['GROQ_API_KEY',oldGroq],['QWEN_API_KEY',oldQwen]]) {
   if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
 }
});
