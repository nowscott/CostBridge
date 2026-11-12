import { AppError, validateInput, normalize, prompt } from './core.js';
import { MODEL_TIMEOUT_MS, fetchWithTimeout } from './timeouts.js';

export async function analyze(body, config, fetcher = fetch, onRateLimits = () => {}, onAttempt = () => {}) {
  const input = validateInput(body);
  config.onValidated?.();
  const providers = config.providers ?? [];
  if (!providers.length) throw new AppError('configuration_error', '服务尚未配置模型供应商。', 500);
  const content = [{type:'text', text: prompt(input)}];
  if (input.image) content.push({type:'image_url', image_url:{url:`data:image/jpeg;base64,${input.image}`}});
  else content.push({type:'text', text:input.text});
  const timeoutMs = config.timeoutMs ?? MODEL_TIMEOUT_MS;
  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index];
    const started = performance.now();
    const attempt = {provider:provider.key, model:provider.model, startedAt:new Date().toISOString()};
    let responseRead = false;
    try {
      if (!provider.apiKey) {
        const message = provider.key === 'groq' ? '服务尚未配置 Groq API 密钥。' : `服务尚未配置 ${provider.label} 的密钥。`;
        throw new AppError('configuration_error', message, 500);
      }
      let payload, rateLimits = null;
      const response = await fetchWithTimeout(fetcher, `${provider.baseUrl}/chat/completions`, {
        method:'POST',
        headers:{'content-type':'application/json', authorization:`Bearer ${provider.apiKey}`},
        body:JSON.stringify({model:provider.model, ...provider.extra, temperature:0, response_format:{type:'json_object'}, messages:[{role:'user',content}]})
      }, timeoutMs, async response => {
        attempt.upstreamStatus = response.status;
        if (provider.key === 'groq' && response.headers) {
          rateLimits = readRateLimits(response);
          if (rateLimits && Object.values(rateLimits).some(value => value !== null)) onRateLimits(rateLimits, new Date().toISOString(), provider.model);
        }
        if (!response.ok) {
          await response.body?.cancel();
          return response;
        }
        try { payload = await response.json(); }
        catch (error) {
          if (error instanceof SyntaxError) throw new AppError('model_invalid', '模型返回内容无法识别。', 502);
          throw error;
        }
        return response;
      });
      responseRead = true;
      if (!response.ok) {
        const error = new AppError('model_error', `${index > 0 ? '备用模型' : '模型'}服务请求失败（HTTP ${response.status}）。`, 502);
        error.upstreamStatus = response.status;
        throw error;
      }
      if (payload?.usage) attempt.usage = {promptTokens:payload.usage.prompt_tokens, completionTokens:payload.usage.completion_tokens, totalTokens:payload.usage.total_tokens};
      const transaction = normalize(parseModelContent(payload), input);
      attempt.outcome = 'success';
      return {transaction, usage:payload.usage, rateLimits, model:provider.model, provider:provider.key, usedFallback:index > 0};
    } catch (error) {
      const known = error instanceof AppError;
      attempt.outcome = 'failed';
      attempt.errorCode = known ? error.code : responseRead ? 'internal_error' : ['AbortError','TimeoutError'].includes(error.name) ? 'timeout' : 'connection_error';
      const retryable = !known && !responseRead || error.code === 'model_error' && (error.upstreamStatus === 429 || error.upstreamStatus >= 500);
      attempt.willFallback = retryable && index < providers.length - 1;
      if (attempt.willFallback) continue;
      if (known || responseRead) throw error;
      throw new AppError('model_unavailable', providers.length > 1 ? '主模型和备用模型均无法连接，请稍后再试。' : '模型服务连接失败，请稍后再试。', 502);
    } finally {
      attempt.durationMs = Math.round(performance.now() - started);
      onAttempt(attempt);
    }
  }
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
