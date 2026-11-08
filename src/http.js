import { AppError, buildIcostUrl, buildPreview } from './core.js';
import { verifyAccessKey } from './auth.js';
import { analyze } from './service.js';
const LIMIT = 4200000;
export async function handle(req, res) {
  const started = performance.now();
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  const send = (status, body) => {
    res.statusCode = status;
    res.end(JSON.stringify({...body, shortcutResult: body.ok ? 'OK' : body.error.message}));
  };
  if (req.method !== 'POST') return send(405,{ok:false,error:{code:'method_not_allowed',message:'请使用 POST。'}});
  try {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ') || !authorization.slice(7)) throw new AppError('unauthorized','访问凭据无效。',401);
    if (!process.env.UNKEY_ROOT_KEY) throw new AppError('configuration_error','服务尚未配置授权验证。',500);
    await verifyAccessKey(authorization.slice(7), {rootKey: process.env.UNKEY_ROOT_KEY});
    let body = req.body;
    if (body === undefined) {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > LIMIT) throw new AppError('too_large','截图过大，请压缩后重试。',413); }
      body = raw;
    }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new AppError('invalid_json','请求不是有效的 JSON。'); } }
    const {transaction, usage, rateLimits} = await analyze(body,{apiKey:process.env.GROQ_API_KEY,baseUrl:'https://api.groq.com/openai/v1',model:'qwen/qwen3.8-27b'});
    send(200,{ok:true,error:'',transaction,preview:buildPreview(transaction, usage, body.showTokens, (performance.now() - started) / 1000),icostUrl:buildIcostUrl(transaction),rateLimits});
  } catch (error) {
    const known = error instanceof AppError;
    send(known ? error.status : 500,{ok:false,error:{code:known ? error.code : 'internal_error',message:known ? error.message : '服务处理失败。'}});
  }
}
