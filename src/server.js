import http from 'node:http';
import { handle } from './http.js';
import { handleQuota } from './quota.js';
import { handleCreateKey } from './create-key.js';
import { serveStatic } from './static.js';
http.createServer(async (req,res) => {
  const path = (req.url || '').split('?')[0];
  if (path === '/api/analyze') return handle(req,res);
  if (path === '/api/analyze-provider') return handle(req,res,() => {}, {selectProvider:true});
  if (path === '/api/create-key') return handleCreateKey(req,res);
  if (path === '/api/quota') return handleQuota(req,res);
  if (await serveStatic(req,res)) return;
  res.writeHead(404,{'content-type':'application/json'}); res.end(JSON.stringify({ok:false,error:{code:'not_found',message:'接口不存在。'}}));
}).listen(Number(process.env.PORT || 3000), () => console.log('CostBridge listening'));
