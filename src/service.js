import { AppError, validateInput, normalize, prompt } from './core.js';
import { MODEL_TIMEOUT_MS, fetchWithTimeout } from './timeouts.js';

export async function analyze(body, config, fetcher = fetch, onRateLimits = () => {}) {
  const input = validateInput(body);
  const providers = config.providers ?? [];
  if (!providers.length) throw new AppError('configuration_error', '服务尚未配置模型供应商。', 500);
  const content = [{type:'text', text: prompt(input)}];
  if (input.image) content.push({type:'image_url', image_url:{url:`data:image/jpeg;base64,${input.image}`}});
  else content.push({type:'text', text:input.text});
  const timeoutMs = config.timeoutMs ?? MODEL_TIMEOUT_MS;
  let response;
  let provider;
  let usedFallback = false;
  let rateLimits = null;
  for (let index = 0; index < providers.length; index++) {
    provider = providers[index];
    if (!provider.apiKey) {
      const message = provider.key === 'groq' ? '服务尚未配置 Groq API 密钥。' : `服务尚未配置 ${provider.label} 的密钥。`;
      throw new AppError('configuration_error', message, 500);
    }
    try {
      response = await fetchWithTimeout(fetcher, `${provider.baseUrl}/chat/completions`, {
        method:'POST',
        headers:{'content-type':'application/json', authorization:`Bearer ${provider.apiKey}`},
        body:JSON.stringify({model:provider.model, ...provider.extra, temperature:0, response_format:{type:'json_object'}, messages:[{role:'user',content}]})
      }, timeoutMs);
    } catch {
      if (index === providers.length - 1) {
        throw new AppError('model_unavailable', providers.length > 1 ? '主模型和备用模型均无法连接，请稍后再试。' : '模型服务连接失败，请稍后再试。', 502);
      }
      usedFallback = true;
      continue;
    }
    if (index === 0 && provider.key === 'groq' && response.headers) {
      rateLimits = readRateLimits(response);
      if (rateLimits && Object.values(rateLimits).some(value => value !== null)) onRateLimits(rateLimits, new Date().toISOString());
    }
    if ((response.status === 429 || response.status >= 500) && index < providers.length - 1) {
      usedFallback = true;
      continue;
    }
    break;
  }
  if (!response.ok) {
    const error = new AppError('model_error', `${usedFallback ? '备用模型' : '模型'}服务请求失败（HTTP ${response.status}）。`, 502);
    error.upstreamStatus = response.status;
    throw error;
  }
  let payload;
  try { payload = await response.json(); } catch { throw new AppError('model_invalid', '模型返回内容无法识别。', 502); }
  const result = parseModelContent(payload);
  return {
    transaction: normalize(result, input),
    usage: payload.usage,
    rateLimits: provider.key === 'groq' && !usedFallback ? rateLimits : null,
    model: provider.model,
    provider: provider.key,
    usedFallback
  };
}

function readRateLimits(response) {
  return {
    dailyRequestsRemaining: response.headers.get('x-ratelimit-remaining-requests'),
    dailyRequestsLimit: response.headers.get('x-ratelimit-limit-requests'),
    tokensPerMinuteRemaining: response.headers.get('x-ratelimit-remaining-tokens'),
    tokensPerMinuteLimit: response.headers.get('x-ratelimit-limit-tokens'),
    requestsReset: response.headers.get('x-ratelimit-reset-requests'),
    tokensReset: response.headers.get('x-ratelimit-reset-tokens')
  };
}

function parseModelContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new AppError('model_invalid', '模型返回内容无法识别。', 502);
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); }
  catch { throw new AppError('model_invalid', '模型返回内容无法识别。', 502); }
}
