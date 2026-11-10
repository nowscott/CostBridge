import { AppError, validateInput, normalize, prompt } from './core.js';
import { MODEL_TIMEOUT_MS, fetchWithTimeout } from './timeouts.js';

export async function analyze(body, config, fetcher = fetch, onRateLimits = () => {}) {
  const input = validateInput(body);
  if (!config.apiKey) throw new AppError('configuration_error', '服务尚未配置 Groq API 密钥。', 500);
  const timeoutMs = config.timeoutMs ?? MODEL_TIMEOUT_MS;
  const content = [{type:'text', text: prompt(input)}];
  if (input.image) content.push({type:'image_url', image_url:{url:`data:image/jpeg;base64,${input.image}`}});
  else content.push({type:'text', text:input.text});
  let response;
  let usedFallback = false;
  try {
    response = await fetchWithTimeout(fetcher, `${config.baseUrl}/chat/completions`, {method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${config.apiKey}`}, body:JSON.stringify({model:config.model, reasoning_effort:'none', temperature:0, response_format:{type:'json_object'}, messages:[{role:'user',content}]})}, timeoutMs);
  } catch {
    if (!config.fallback) throw new AppError('model_unavailable', '模型服务连接失败，请稍后再试。', 502);
  }
  const rateLimits = response?.headers ? {
    dailyRequestsRemaining: response.headers.get('x-ratelimit-remaining-requests'),
    dailyRequestsLimit: response.headers.get('x-ratelimit-limit-requests'),
    tokensPerMinuteRemaining: response.headers.get('x-ratelimit-remaining-tokens'),
    tokensPerMinuteLimit: response.headers.get('x-ratelimit-limit-tokens'),
    requestsReset: response.headers.get('x-ratelimit-reset-requests'),
    tokensReset: response.headers.get('x-ratelimit-reset-tokens')
  } : null;
  if (rateLimits && Object.values(rateLimits).some(value => value !== null)) onRateLimits(rateLimits, new Date().toISOString());
  if ((!response || response.status === 429 || response.status >= 500) && config.fallback) {
    usedFallback = true;
    try {
      response = await fetchWithTimeout(fetcher, `${config.fallback.baseUrl}/chat/completions`, {method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${config.fallback.apiKey}`}, body:JSON.stringify({model:config.fallback.model, enable_thinking:false, temperature:0, response_format:{type:'json_object'}, messages:[{role:'user',content}]})}, timeoutMs);
    } catch { throw new AppError('model_unavailable', '主模型和备用模型均无法连接，请稍后再试。', 502); }
  }
  if (!response.ok) {
    const error = new AppError('model_error', `${usedFallback ? '备用模型' : '模型'}服务请求失败（HTTP ${response.status}）。`, 502);
    error.upstreamStatus = response.status;
    throw error;
  }
  let payload;
  try { payload = await response.json(); } catch { throw new AppError('model_invalid', '模型返回内容无法识别。', 502); }
  const result = parseModelContent(payload);
  return {transaction: normalize(result, input), usage: payload.usage, rateLimits: usedFallback ? null : rateLimits, model: usedFallback ? config.fallback.model : config.model, usedFallback};
}

function parseModelContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new AppError('model_invalid', '模型返回内容无法识别。', 502);
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); }
  catch { throw new AppError('model_invalid', '模型返回内容无法识别。', 502); }
}
