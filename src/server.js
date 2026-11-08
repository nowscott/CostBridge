import http from 'node:http';
import { handle } from './http.js';
import { serveStatic } from './static.js';
http.createServer(async (req,res) => {
  if ((req.url || '').split('?')[0] === '/api/analyze') return handle(req,res);
  if (await serveStatic(req,res)) return;
  res.writeHead(404,{'content-type':'application/json'}); res.end(JSON.stringify({ok:false,error:{code:'not_found',message:'接口不存在。'}}));
}).listen(Number(process.env.PORT || 3000), () => console.log('CostBridge listening'));
