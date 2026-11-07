import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/service.js';
import { normalize, validateInput, buildIcostUrl, buildPreview } from '../src/core.js';
const input = {apiKey:'test-model-key',text:'虚构账单',expenseCategories:['餐饮','其他'],incomeCategories:['工资'],accounts:['信用卡','储蓄卡'],defaultAccount:'信用卡',ruleAccount:'信用卡',now:'2026/11/07 16:06'};
const config = {baseUrl:'https://example.test',model:'test'};
const transaction = {date:'2026/11/07 15:30',type:'支出',amount:-12.5,category:'餐饮',remark:'午餐',account:'储蓄卡',accountRuleApplied:false};
const fake = value => async () => ({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(value)}}]})});
test('returns normalized transaction from a model response', async () => {
 const result = await analyze(input,config,fake(transaction));
 assert.equal(result.amount,-12.5); assert.equal(result.account,'储蓄卡'); assert.equal(result.category,'餐饮');
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

test('preview includes key information and warnings', () => {
 const preview = buildPreview(normalize(transaction,input));
 assert.match(preview,/12\.50/); assert.match(preview,/餐饮/); assert.match(preview,/核对/);
});
