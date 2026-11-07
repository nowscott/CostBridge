import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/service.js';
import { normalize, validateInput } from '../src/core.js';
const input = {text:'虚构账单',expenseCategories:['餐饮','其他'],incomeCategories:['工资'],accounts:['信用卡','储蓄卡'],defaultAccount:'信用卡',ruleAccount:'信用卡',now:'2026/11/07 16:06'};
const config = {apiKey:'test',baseUrl:'https://example.test',model:'test'};
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
