import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/service.js';
import { normalize, validateInput, buildIcostUrl, buildPreview, prompt } from '../src/core.js';
import { createRequire } from 'node:module';
const input = {apiKey:'test-model-key',text:'虚构账单',expenseCategories:['餐饮','其他'],incomeCategories:['工资'],accounts:['信用卡','储蓄卡'],defaultAccount:'信用卡',now:'2026/11/07 16:06'};
const provider = (overrides = {}) => ({key:'groq',label:'Groq · Qwen 3.8 27B',baseUrl:'https://example.test',model:'test',apiKey:'server-model-key',extra:{reasoning_effort:'none'},...overrides});
const fallbackProvider = (overrides = {}) => ({key:'qwen',label:'千问 · Qwen 3.8 Flash',baseUrl:'https://fallback.test/v1',model:'qwen3.8-flash',apiKey:'fallback-key',extra:{enable_thinking:false},...overrides});
const sfProvider = (overrides = {}) => ({key:'sf',label:'硅基流动 · Qwen3.5 4B',baseUrl:'https://sf.test/v1',model:'Qwen/Qwen3.5-4B',apiKey:'sf-key',extra:{enable_thinking:false},...overrides});
const config = {providers:[provider()]};
const transaction = {date:'2026/11/07 15:30',type:'支出',amount:-12.5,category:'餐饮',remark:'午餐',account:'储蓄卡',accountRuleApplied:false};
const fake = value => async () => ({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(value)}}]})});
test('returns normalized transaction from a model response', async () => {
 const result = await analyze(input,config,fake(transaction));
 assert.equal(result.transaction.amount,-12.5); assert.equal(result.transaction.account,'储蓄卡'); assert.equal(result.transaction.category,'餐饮');
});
test('uses the server model key instead of a client-supplied key', async () => {
 let authorization;
 await analyze(input,config,async (url, options) => { authorization = options.headers.authorization; return fake(transaction)(); });
 assert.equal(authorization,'Bearer server-model-key');
 await assert.rejects(analyze(input,{...config,providers:[provider({apiKey:''})]},fake(transaction)), /服务尚未配置 Groq API 密钥/);
});
test('returns Groq rate-limit headers alongside the result', async () => {
 const headers = new Headers({'x-ratelimit-remaining-requests':'987','x-ratelimit-limit-requests':'1000','x-ratelimit-remaining-tokens':'6500','x-ratelimit-limit-tokens':'8000'});
 const result = await analyze(input,config,async()=>({...(await fake(transaction)()),headers}));
 assert.deepEqual(result.rateLimits,{dailyRequestsRemaining:'987',dailyRequestsLimit:'1000',tokensPerMinuteRemaining:'6500',tokensPerMinuteLimit:'8000',requestsReset:null,tokensReset:null});
});
test('income sign and default account are explicit', () => {
 const result = normalize({...transaction,type:'收入',amount:-3,category:'工资',account:'未知'},input);
 assert.equal(result.amount,3); assert.equal(result.account,'信用卡'); assert.match(result.warnings[0],/默认账户/);
});
test('invalid default warns when the identified account is valid and stops otherwise', async () => {
 const invalid = {...input, defaultAccount:'现金'};
 const result = await analyze(invalid,config,fake(transaction));
 assert.equal(result.transaction.account,'储蓄卡');
 assert.match(buildPreview(result.transaction),/默认账户不在账户列表中/);
 assert.match(prompt(invalid),/DEF:""/);
 await assert.rejects(analyze(invalid,config,fake({...transaction,account:''})), /账户未识别，且默认账户不在账户列表中/);
});
test('ignores the legacy ruleAccount field end to end', () => {
 validateInput({...input, ruleAccount:'不存在'});
 assert.equal(normalize({...transaction,accountRuleApplied:true},input).account,'储蓄卡');
 assert.doesNotMatch(prompt(input), /Apple Pay or 0822/);
});
test('invalid values and malformed requests fail', () => {
 for (const change of [{amount:0},{amount:1.234},{date:'2026/02/30 09:00'},{category:'不存在'}]) assert.throws(()=>normalize({...transaction,...change},input));
 assert.throws(()=>validateInput({...input,accounts:[]}));
});
test('upstream failures do not become success', async () => {
 await assert.rejects(analyze(input,config,async()=>({ok:false,status:401})), /HTTP 401/);
 await assert.rejects(analyze(input,config,async()=>({ok:true,json:async()=>({})})), /无法识别/);
});

test('switches to Flash for transient Groq failures and sends the image', async () => {
 for (const failure of [429, 503, 'network']) {
  const calls = [];
  const result = await analyze({...input,text:undefined,image:'YWJj'}, {...config,providers:[provider(),fallbackProvider()]}, async (url, options) => {
   calls.push({url,options});
   if (calls.length === 1) { if (failure === 'network') throw new Error('network'); return {ok:false,status:failure}; }
   return fake(transaction)();
  });
  assert.equal(calls.length,2);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.ok(calls[1].options.signal instanceof AbortSignal);
  assert.equal(calls[1].url,'https://fallback.test/v1/chat/completions');
  assert.equal(calls[1].options.headers.authorization,'Bearer fallback-key');
  const sent = JSON.parse(calls[1].options.body);
  assert.equal(sent.model,'qwen3.8-flash');
  assert.equal(sent.enable_thinking,false);
  assert.equal(sent.messages[0].content[1].image_url.url,'data:image/jpeg;base64,YWJj');
  assert.equal(result.model,'qwen3.8-flash');
  assert.equal(result.provider,'qwen');
  assert.equal(result.rateLimits,null);
  assert.match(buildPreview(result.transaction,result.rateLimits,1,'qwen'),/记账小票〔千问 · 𝓠𝔀𝓮𝓷 𝟑\.𝟖 𝓕𝓵𝓪𝓼𝓱〕/);
  assert.doesNotMatch(buildPreview(result.transaction,result.rateLimits,1,'qwen'),/今日请求剩余/);
 }
});

test('falls through Groq and Qianwen to SiliconFlow Qwen3.5 4B', async () => {
 const calls = [];
 const result = await analyze(input, {...config,providers:[provider(),fallbackProvider(),sfProvider()]}, async (url, options) => {
  calls.push({url,options});
  if (calls.length < 3) return {ok:false,status:503};
  return fake(transaction)();
 });
 assert.equal(calls.length,3);
 assert.equal(calls[2].url,'https://sf.test/v1/chat/completions');
 assert.equal(calls[2].options.headers.authorization,'Bearer sf-key');
 const sent = JSON.parse(calls[2].options.body);
 assert.equal(sent.model,'Qwen/Qwen3.5-4B');
 assert.equal(sent.enable_thinking,false);
 assert.equal(result.provider,'sf');
 assert.equal(result.usedFallback,true);
 assert.equal(result.rateLimits,null);
 assert.match(buildPreview(result.transaction,result.rateLimits,1,'sf'),/记账小票〔硅基流动 · 𝓠𝔀𝓮𝓷𝟑\.𝟓 𝟒𝓑〕/);
});

test('times out a hanging primary model and still tries the fallback', async () => {
 const providers = [provider(), fallbackProvider()];
 let calls = 0;
 const result = await analyze(input, {...config, providers, timeoutMs: 10}, (url, options) => {
  calls++;
  if (calls === 1) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
  return fake(transaction)();
 });
 assert.equal(calls, 2);
 assert.equal(result.usedFallback, true);
});

test('reports when both the primary and fallback models time out', async () => {
 await assert.rejects(analyze(input, {...config, providers:[provider(), fallbackProvider()], timeoutMs: 5}, (url, options) => new Promise((resolve, reject) => {
  options.signal.addEventListener('abort', () => reject(options.signal.reason));
 })), /主模型和备用模型均无法连接/);
});

test('does not switch for invalid credentials and reports fallback failure', async () => {
 const providers = [provider(), fallbackProvider({baseUrl:'https://fallback.test'})];
 let calls = 0;
 await assert.rejects(analyze(input,{...config,providers},async()=>{ calls++; return {ok:false,status:401}; }),/HTTP 401/);
 assert.equal(calls,1);
 await assert.rejects(analyze(input,{...config,providers},async()=>({ok:false,status:503})),/备用模型服务请求失败（HTTP 503）/);
});

test('iCost links encode fields and use documented income and expense paths', () => {
 const tx = normalize({...transaction,remark:'午餐 & 茶'},input);
 const url = new URL(buildIcostUrl(tx));
 assert.equal(url.host, 'expense'); assert.equal(url.searchParams.get('amount'), '12.5');
 assert.equal(url.searchParams.get('date'), '2026.11.07'); assert.equal(url.searchParams.get('remark'), '午餐 & 茶');
 assert.equal(new URL(buildIcostUrl({...tx,type:'收入',amount:3})).host,'income');
});

test('accepts the iCost shortcut text lists and supplies Shanghai current time', () => {
 const converted = validateInput({...input,expenseCategories:'餐饮；其他',incomeCategories:'工资',accounts:'信用卡,储蓄卡',now:undefined});
 assert.deepEqual(converted.expenseCategories,['餐饮','其他']);
 assert.match(converted.now,/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
});

test('receipt shows the transaction and identifies a default account', () => {
 const preview = buildPreview(normalize({...transaction,account:'未知'},input));
 assert.match(preview,/记账小票〔𝓖𝓻𝓸𝓺 · 𝓠𝔀𝓮𝓷 𝟑\.𝟖 𝟐𝟕𝓑〕/);
 assert.match(preview,/⏰ 时间  𝟐𝟎𝟐𝟔\/𝟏𝟏\/𝟎𝟕 𝟏𝟓:𝟑𝟎/);
 assert.match(preview,/𝟏𝟐\.𝟓𝟎/); assert.match(preview,/餐饮/); assert.match(preview,/信用卡（默认）/);
 assert.match(preview, /支出  −𝟏𝟐\.𝟓𝟎\u00a0𝓒𝓝𝓨/);
 assert.doesNotMatch(preview,/⚠️|注意事项/);
});

test('receipt displays the daily request snapshot followed by request time', () => {
 const tx = normalize(transaction,input);
 const preview = buildPreview(tx,{dailyRequestsRemaining:'987',dailyRequestsLimit:'1000'},1.234);
 assert.match(preview,/今日请求剩余  𝟗𝟖𝟕 \/ 𝟏𝟎𝟎𝟎 次\n⏱️ 请求耗时  𝟏\.𝟐𝟑 秒/);
 assert.doesNotMatch(preview,/tokens|消耗/);
 assert.match(buildPreview(tx,null),/今日请求剩余  未提供/);
 assert.match(buildPreview(tx,{dailyRequestsRemaining:'0',dailyRequestsLimit:'1000'}),/今日请求剩余  𝟎 \/ 𝟏𝟎𝟎𝟎 次/);
 assert.doesNotMatch(buildPreview({...tx,account:'Card 123',remark:'Apple Pay 456'}),/[A-Za-z0-9]/);
});

test('receipt ends with the service signature and version', () => {
 const version = createRequire(import.meta.url)('../package.json').version;
 const styledVersion = version.replace(/[0-9]/g, digit => [...'𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗'][Number(digit)]);
 assert.ok(buildPreview(normalize(transaction,input)).endsWith(`确认以上信息后入账？\n\n𝓟𝓸𝔀𝓮𝓻𝓮𝓭 𝓫𝔂 𝓒𝓸𝓼𝓽𝓑𝓻𝓲𝓭𝓰𝓮 · 𝓿${styledVersion}`));
});

test('accepts JSON wrapped in a code fence from the model', async () => {
 const fetcher = async () => ({ok:true,json:async()=>({choices:[{message:{content:'```json\n'+JSON.stringify(transaction)+'\n```'}}]})});
 const result = await analyze(input,config,fetcher);
 assert.equal(result.transaction.amount,-12.5);
});

test('rejects empty or malformed model content as model_invalid', async () => {
 const payloads = [{},{choices:[]},{choices:[{message:{content:''}}]},{choices:[{message:{content:{}}}]},{choices:[{message:{content:'not json'}}]}];
 for (const payload of payloads) {
  await assert.rejects(analyze(input,config,async()=>({ok:true,json:async()=>payload})), error => error.code === 'model_invalid' && error.status === 502);
 }
});

test('rounds amounts to cents before building the iCost link', () => {
 const result = normalize({...transaction,amount:0.30000000000000004},input);
 assert.equal(result.amount,-0.3);
 assert.equal(new URL(buildIcostUrl(result)).searchParams.get('amount'),'0.3');
 const nearlyWhole = normalize({...transaction,amount:12.5000000001},input);
 assert.equal(nearlyWhole.amount,-12.5);
 assert.equal(new URL(buildIcostUrl(nearlyWhole)).searchParams.get('amount'),'12.5');
});

test('captures quota headers from failed model calls', async () => {
 let snapshot;
 const headers = new Headers({'x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'1h'});
 await assert.rejects(analyze(input,config,async()=>({ok:false,status:429,headers}), (limits,time)=>{ snapshot={limits,time}; }), /HTTP 429/);
 assert.equal(snapshot.limits.dailyRequestsRemaining,'0');
 assert.equal(snapshot.limits.requestsReset,'1h');
 assert.ok(!Number.isNaN(Date.parse(snapshot.time)));
});

 test('optional custom prompt replaces the legacy account rule', async () => {
  let sent;
  const custom = {...input, customPrompt:'Apple Pay 使用储蓄卡'};
  const result = await analyze(custom, config, async (url, options) => { sent = JSON.parse(options.body).messages[0].content[0].text; return fake({...transaction,accountRuleApplied:true})(); });
  assert.match(sent, /Apple Pay 使用储蓄卡/);
  assert.equal(result.transaction.account, '储蓄卡');
  assert.match(result.transaction.warnings.join(' '), /自定义规则/);
  const empty = validateInput({...input, customPrompt:''});
  assert.match(prompt(empty), /CUSTOM RULE:""/);
  assert.equal(normalize({...transaction,accountRuleApplied:true},empty).account,'储蓄卡');
  assert.throws(()=>validateInput({...input, customPrompt:123}), /自定义提示词/);
  assert.throws(()=>validateInput({...input, customPrompt:'字'.repeat(2001)}), /自定义提示词/);
 });

test('does not retry malformed JSON or invalid transaction results', async () => {
 for (const json of [async()=>{throw new SyntaxError('bad JSON');}, async()=>({choices:[{message:{content:JSON.stringify({...transaction,amount:0})}}]})]) {
  let calls = 0;
  await assert.rejects(analyze(input,{providers:[provider(),fallbackProvider()]},async()=>{
   calls++;
   return {ok:true,json};
  }));
  assert.equal(calls,1);
 }
});

test('Groq quota remains available when Groq is the successful backup', async () => {
 let calls = 0, capturedModel;
 const result = await analyze(input,{providers:[sfProvider(),provider()]},async()=>{
  if (++calls === 1) return {ok:false,status:429};
  return {ok:true,headers:new Headers({'x-ratelimit-remaining-requests':'12'}),json:async()=>({choices:[{message:{content:JSON.stringify(transaction)}}]})};
 }, (limits,time,model)=>{capturedModel=model;});
 assert.equal(result.provider,'groq');
 assert.equal(result.rateLimits.dailyRequestsRemaining,'12');
 assert.equal(capturedModel,'test');
});

test('attempt diagnostics retain failures, decisions and successful usage without bill content', async () => {
 const attempts = [];
 let calls = 0;
 const result = await analyze(input,{providers:[provider(),fallbackProvider(),sfProvider()]},async()=>{
  calls++;
  if(calls===1) throw new Error('sensitive upstream details');
  if(calls===2) return {ok:false,status:429};
  return {ok:true,status:200,json:async()=>({usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15},choices:[{message:{content:JSON.stringify(transaction)}}]})};
 },()=>{},attempt=>attempts.push(attempt));
 assert.equal(result.provider,'sf');
 assert.deepEqual(attempts.map(a=>[a.provider,a.outcome,a.errorCode,a.willFallback]),[
  ['groq','failed','connection_error',true],['qwen','failed','model_error',true],['sf','success',undefined,undefined]
 ]);
 assert.equal(attempts[1].upstreamStatus,429);
 assert.equal(attempts[2].usage.totalTokens,15);
 for(const attempt of attempts) { assert.equal(typeof attempt.durationMs,'number');assert.ok(attempt.startedAt); }
 assert.doesNotMatch(JSON.stringify(attempts),/sensitive upstream|虚构账单|server-model-key|午餐/);
});

test('terminal and malformed model failures are recorded once', async () => {
 for(const [response,code] of [
  [{ok:false,status:401},'model_error'],
  [{ok:true,status:200,json:async()=>null},'model_invalid'],
  [{ok:true,status:200,json:async()=>{throw new SyntaxError('private');}},'model_invalid'],
  [{ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({...transaction,amount:0})}}]})},'incomplete']
 ]) {
  const attempts=[];
  await assert.rejects(analyze(input,{providers:[provider(),fallbackProvider()]},async()=>response,()=>{},a=>attempts.push(a)));
  assert.equal(attempts.length,1);
  assert.equal(attempts[0].errorCode,code);
  assert.equal(attempts[0].willFallback,false);
 }
});
