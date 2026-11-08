import { timingSafeEqual } from 'node:crypto';
import { AppError, buildIcostUrl, buildPreview } from './core.js';
import { analyze } from './service.js';
const LIMIT = 4200000;
export async function handle(req, res) {
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  const send = (status, body) => {
    res.statusCode = status;
    res.end(JSON.stringify({...body, shortcutResult: body.ok ? 'OK' : body.error.message}));
  };
  if (req.method !== 'POST') return send(405,{ok:false,error:{code:'method_not_allowed',message:'请使用 POST。'}});
  const token = process.env.COSTBRIDGE_TOKEN;
  if (!token) return send(500,{ok:false,error:{code:'configuration_error',message:'服务尚未配置访问凭据。'}});
  const actual = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401,{ok:false,error:{code:'unauthorized',message:'访问凭据无效。'}});
  try {
    let body = req.body;
    if (body === undefined) {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > LIMIT) throw new AppError('too_large','截图过大，请压缩后重试。',413); }
      body = raw;
    }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new AppError('invalid_json','请求不是有效的 JSON。'); } }
    const {transaction, usage} = await analyze(body,{apiKey:process.env.GROQ_API_KEY,baseUrl:'https://api.groq.com/openai/v1',model:'qwen/qwen3.8-27b'});
    send(200,{ok:true,error:'',transaction,preview:buildPreview(transaction, usage, body.showTokens),icostUrl:buildIcostUrl(transaction)});
  } catch (error) {
    const known = error instanceof AppError;
    send(known ? error.status : 500,{ok:false,error:{code:known ? error.code : 'internal_error',message:known ? error.message : '服务处理失败。'}});
  }
}
