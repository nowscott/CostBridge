import { AppError, buildIcostUrl, buildPreview } from './core.js';
import { verifyAccessKey } from './auth.js';
import { analyze } from './service.js';
import { PROVIDERS, DEFAULT_PROVIDER, isProvider } from './models.js';
const LIMIT = 4200000;

function providerConfig(key) {
  return { key, ...PROVIDERS[key], apiKey: process.env[PROVIDERS[key].apiKeyEnv] };
}

function defaultProviders() {
  return [
    providerConfig('groq'),
    ...(process.env.QWEN_API_KEY ? [providerConfig('qwen')] : []),
    ...(process.env.SF_API_KEY ? [providerConfig('sf')] : [])
  ];
}

function selectedProvider(req, body) {
  const url = new URL(req.url || '/', 'http://localhost');
  const fromQuery = url.searchParams.get('provider');
  const raw = fromQuery && fromQuery.trim() ? fromQuery : body?.provider;
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return isProvider(name) ? name : DEFAULT_PROVIDER;
}

export async function handle(req, res, logCall = () => {}, options = {}) {
  const started = performance.now();
  let stageStarted = started;
  const record = {time: new Date().toISOString(), requestId: req.headers['x-vercel-id'], method: req.method, region: process.env.VERCEL_REGION, deployment: process.env.VERCEL_GIT_COMMIT_SHA, contentLength: req.headers['content-length'], stage: 'request'};
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  const send = (status, body) => {
    res.statusCode = status;
    record.status = status;
    record.errorCode = body.ok ? null : body.error.code;
    record.totalMs = Math.round(performance.now() - started);
    res.end(JSON.stringify({...body, shortcutResult: body.ok ? 'OK' : body.error.message}));
    logCall(record);
  };
  if (req.method !== 'POST') return send(405,{ok:false,error:{code:'method_not_allowed',message:'请使用 POST。'}});
  try {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ') || !authorization.slice(7)) throw new AppError('unauthorized','访问凭据无效。',401);
    record.stage = 'auth';
    const authStarted = stageStarted = performance.now();
    const verifiedKey = await verifyAccessKey(authorization.slice(7), {rootKey: process.env.UNKEY_ROOT_KEY});
    record.keyId = verifiedKey.keyId;
    record.authMs = Math.round(performance.now() - authStarted);
    record.stage = 'input';
    let body = req.body;
    if (body === undefined) {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > LIMIT) throw new AppError('too_large','截图过大，请压缩后重试。',413); }
      body = raw;
    }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new AppError('invalid_json','请求不是有效的 JSON。'); } }
    const requestedProvider = options.selectProvider ? selectedProvider(req, body) : DEFAULT_PROVIDER;
    const providers = options.selectProvider ? [providerConfig(requestedProvider)] : defaultProviders();
    record.provider = requestedProvider;
    record.inputType = body?.image ? 'image' : body?.text ? 'text' : 'unknown';
    record.inputLength = body?.image?.length ?? body?.text?.length;
    record.model = providers[0].model;
    record.stage = 'model';
    const modelStarted = stageStarted = performance.now();
    const {transaction, usage, rateLimits, model, provider, usedFallback} = await analyze(body,{providers}, fetch, (limits, time) => { record.rateLimits = limits; record.rateLimitsTime = time; });
    record.resultModel = model;
    record.resultProvider = provider;
    record.usedFallback = usedFallback;
    record.modelMs = Math.round(performance.now() - modelStarted);
    record.usage = usage ? {promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens} : undefined;
    record.stage = 'complete';
    send(200,{ok:true,error:'',provider,transaction,preview:buildPreview(transaction, rateLimits, (performance.now() - started) / 1000, provider),icostUrl:buildIcostUrl(transaction),rateLimits,rateLimitsTime:rateLimits ? record.rateLimitsTime : undefined});
  } catch (error) {
    if (record.stage === 'auth') record.authMs = Math.round(performance.now() - stageStarted);
    if (record.stage === 'model') record.modelMs = Math.round(performance.now() - stageStarted);
    if (error.upstreamStatus) record.upstreamStatus = error.upstreamStatus;
    const known = error instanceof AppError;
    send(known ? error.status : 500,{ok:false,error:{code:known ? error.code : 'internal_error',message:known ? error.message : '服务处理失败。'}});
  }
}
