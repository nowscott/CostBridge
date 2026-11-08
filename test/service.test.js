import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/service.js';
import { normalize, validateInput, buildIcostUrl, buildPreview } from '../src/core.js';
const input = {apiKey:'test-model-key',text:'虚构账单',expenseCategories:['餐饮','其他'],incomeCategories:['工资'],accounts:['信用卡','储蓄卡'],defaultAccount:'信用卡',ruleAccount:'信用卡',now:'2026/11/07 16:06'};
const config = {baseUrl:'https://example.test',model:'test',apiKey:'server-model-key'};
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
 await assert.rejects(analyze(input,{...config,apiKey:''},fake(transaction)), /服务尚未配置 Groq API 密钥/);
});
test('income sign and default account are explicit', () => {
 const result = normalize({...transaction,type:'收入',amount:-3,category:'工资',account:'未知'},input);
 assert.equal(result.amount,3); assert.equal(result.account,'信用卡'); assert.match(result.warnings[0],/默认账户/);
});
test('special rule selects configured account', () => {
 assert.equal(normalize({...transaction,accountRuleApplied:true},input).account,'信用卡');
});
test('invalid values and malformed requests fail', () => {
 for (const change of [{amount:0},{amount:1.234},{date:'2026/02/30 09:00'},{category:'不存在'}]) assert.throws(()=>normalize({...transaction,...change},input));
 assert.throws(()=>validateInput({...input,accounts:[]}));
});
test('upstream failures do not become success', async () => {
 await assert.rejects(analyze(input,config,async()=>({ok:false,status:401})), /HTTP 401/);
 await assert.rejects(analyze(input,config,async()=>({ok:true,json:async()=>({})})), /无法识别/);
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
 assert.match(preview,/记账小票（Groq · Qwen 3\.8 27B）/);
 assert.match(preview,/12\.50/); assert.match(preview,/餐饮/); assert.match(preview,/信用卡（默认）/);
 assert.match(preview, /支出  −12\.50\u00a0CNY/);
 assert.doesNotMatch(preview,/⚠️|注意事项/);
});

test('token display can be enabled or disabled and uses provider usage', async () => {
 const fetcher = async () => ({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(transaction)}}],usage:{total_tokens:123}})});
 const result = await analyze(input,config,fetcher);
 assert.match(buildPreview(result.transaction,result.usage,true),/123 tokens/);
 assert.doesNotMatch(buildPreview(result.transaction,result.usage,false),/消耗/);
 assert.doesNotMatch(buildPreview(result.transaction,result.usage,'关'),/消耗/);
 assert.match(buildPreview(result.transaction,undefined,true),/未提供/);
 assert.match(buildPreview(result.transaction,result.usage,true,1.234),/123 tokens\n⏱️ 服务耗时  1\.23 秒/);
 assert.match(buildPreview(result.transaction,result.usage,false,1.234),/服务耗时  1\.23 秒/);
});
