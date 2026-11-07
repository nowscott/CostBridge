import { AppError, validateInput, normalize, prompt } from './core.js';

export async function analyze(body, config, fetcher = fetch) {
  const input = validateInput(body);
  if (!config.apiKey) throw new AppError('configuration_error', '服务尚未配置模型密钥。', 500);
  const content = [{type:'text', text: prompt(input)}];
  if (input.image) content.push({type:'image_url', image_url:{url:`data:image/jpeg;base64,${input.image}`}});
  else content.push({type:'text', text:input.text});
  let response;
  try {
    response = await fetcher(`${config.baseUrl}/chat/completions`, {method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${config.apiKey}`}, body:JSON.stringify({model:config.model, enable_thinking:false, temperature:0, response_format:{type:'json_object'}, messages:[{role:'user',content}]})});
  } catch { throw new AppError('model_unavailable', '模型服务连接失败，请稍后再试。', 502); }
  if (!response.ok) throw new AppError('model_error', `模型服务请求失败（HTTP ${response.status}）。`, 502);
  let result;
  try { result = JSON.parse((await response.json()).choices[0].message.content); }
  catch { throw new AppError('model_invalid', '模型返回内容无法识别。', 502); }
  return normalize(result, input);
}
