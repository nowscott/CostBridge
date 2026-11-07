import http from 'node:http';
import { handle } from './http.js';
import { readFile } from 'node:fs/promises';
http.createServer(async (req,res) => {
  if (req.url === '/api/analyze') return handle(req,res);
  const files = {'/':'index.html','/style.css':'style.css','/app.js':'app.js'};
  if (req.method === 'GET' && files[req.url]) {
    const type = req.url === '/' ? 'text/html' : req.url.endsWith('.css') ? 'text/css' : 'text/javascript';
    res.writeHead(200, {'content-type': `${type}; charset=utf-8`}); res.end(await readFile(new URL(`../public/${files[req.url]}`, import.meta.url))); return;
  }
  res.writeHead(404,{'content-type':'application/json'}); res.end(JSON.stringify({ok:false,error:{code:'not_found',message:'接口不存在。'}}));
}).listen(Number(process.env.PORT || 3000), () => console.log('CostBridge listening'));
