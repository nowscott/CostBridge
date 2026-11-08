import { AppError, validateInput, normalize, prompt } from './core.js';

export async function analyze(body, config, fetcher = fetch, onRateLimits = () => {}) {
  const input = validateInput(body);
  if (!config.apiKey) throw new AppError('configuration_error', '服务尚未配置 Groq API 密钥。', 500);
  const content = [{type:'text', text: prompt(input)}];
  if (input.image) content.push({type:'image_url', image_url:{url:`data:image/jpeg;base64,${input.image}`}});
  else content.push({type:'text', text:input.text});
  let response;
  try {
    response = await fetcher(`${config.baseUrl}/chat/completions`, {method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${config.apiKey}`}, body:JSON.stringify({model:config.model, reasoning_effort:'none', temperature:0, response_format:{type:'json_object'}, messages:[{role:'user',content}]})});
  } catch { throw new AppError('model_unavailable', '模型服务连接失败，请稍后再试。', 502); }
  const rateLimits = response.headers ? {
    dailyRequestsRemaining: response.headers.get('x-ratelimit-remaining-requests'),
    dailyRequestsLimit: response.headers.get('x-ratelimit-limit-requests'),
    tokensPerMinuteRemaining: response.headers.get('x-ratelimit-remaining-tokens'),
    tokensPerMinuteLimit: response.headers.get('x-ratelimit-limit-tokens'),
    requestsReset: response.headers.get('x-ratelimit-reset-requests'),
    tokensReset: response.headers.get('x-ratelimit-reset-tokens')
  } : null;
  if (rateLimits && Object.values(rateLimits).some(value => value !== null)) onRateLimits(rateLimits, new Date().toISOString());
  if (!response.ok) {
    const error = new AppError('model_error', `模型服务请求失败（HTTP ${response.status}）。`, 502);
    error.upstreamStatus = response.status;
    throw error;
  }
  let payload;
  try { payload = await response.json(); } catch { throw new AppError('model_invalid', '模型返回内容无法识别。', 502); }
  const result = parseModelContent(payload);
  return {transaction: normalize(result, input), usage: payload.usage, rateLimits};
}

function parseModelContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new AppError('model_invalid', '模型返回内容无法识别。', 502);
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); }
  catch { throw new AppError('model_invalid', '模型返回内容无法识别。', 502); }
}
