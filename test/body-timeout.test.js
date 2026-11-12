import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { analyze } from '../src/service.js';
import { verifyAccessKey } from '../src/auth.js';
import { handleCreateKey } from '../src/create-key.js';

const input = {text:'午餐',expenseCategories:['餐饮'],incomeCategories:['工资'],accounts:['卡'],defaultAccount:'卡',now:'2026/11/12 12:00'};
const tx = {date:input.now,type:'支出',amount:-12,category:'餐饮',remark:'午餐',account:'卡'};

test('real HTTP stalled bodies time out for models, authorization and key creation', async t => {
 const server = http.createServer((req,res)=>{
  res.writeHead(200,{'content-type':'application/json'});
  res.write('{'); // Send headers and a partial body, then stall until aborted.
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url = `http://127.0.0.1:${server.address().port}`;
 t.after(()=>{server.closeAllConnections();server.close();});
 await t.test('model aborts body and tries the backup',async()=>{
  let calls = 0;
  const result = await analyze(input,{timeoutMs:100,providers:[{key:'groq',baseUrl:url,apiKey:'test'},{key:'qwen',baseUrl:url,apiKey:'test'}]},async(_,options)=>{
   if (++calls === 1) return fetch(url,options);
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(tx)}}]})};
  });
  assert.equal(calls,2);
  assert.equal(result.provider,'qwen');
 });
 await t.test('authorization returns unavailable after body timeout',async()=>{
  await assert.rejects(verifyAccessKey('test',{rootKey:'test',timeoutMs:100,fetcher:(_,options)=>fetch(url,options)}),error=>error.code==='auth_unavailable');
 });
 await t.test('key creation does not retry or claim success after body timeout',async()=>{
  const previous = process.env.UNKEY_CREATE_API_ID;
  process.env.UNKEY_CREATE_API_ID = 'test';
  let calls = 0;
  const res = {setHeader(){},end(data){this.payload=JSON.parse(data);}};
  try {
   await handleCreateKey({method:'POST',headers:{authorization:'Bearer test'},body:{name:'test'}},res,(_,options)=>{
    calls++;
    return fetch(url,options);
   });
   assert.equal(calls,1);
   assert.equal(res.payload.ok,false);
   assert.equal(res.payload.key,'');
   assert.match(res.payload.message,/可能已经创建/);
  } finally {
   if (previous === undefined) delete process.env.UNKEY_CREATE_API_ID; else process.env.UNKEY_CREATE_API_ID=previous;
  }
 });
});
