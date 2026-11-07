import http from 'node:http';
import { handle } from './http.js';
http.createServer((req,res) => {
  if (req.url === '/api/analyze') return handle(req,res);
  res.writeHead(404,{'content-type':'application/json'}); res.end(JSON.stringify({ok:false,error:{code:'not_found',message:'接口不存在。'}}));
}).listen(Number(process.env.PORT || 3000), () => console.log('CostBridge listening'));
