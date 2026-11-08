import { AppError } from './core.js';

const INVALID_KEY_MESSAGES = new Map([
  ['NOT_FOUND', '访问凭据无效。'],
  ['DISABLED', '访问凭据已停用。'],
  ['EXPIRED', '访问凭据已过期，请更换。'],
  ['USAGE_EXCEEDED', '访问凭据额度已用尽。'],
  ['RATE_LIMITED', '访问凭据暂时受限，请稍后再试。'],
  ['FORBIDDEN', '访问凭据无权访问本服务。'],
  ['INSUFFICIENT_PERMISSIONS', '访问凭据无权访问本服务。']
]);

export async function verifyAccessKey(accessKey, { rootKey, fetcher = fetch } = {}) {
  if (!rootKey) throw new AppError('configuration_error', '服务尚未配置授权验证。', 500);
  let response;
  try {
    response = await fetcher('https://api.unkey.com/v2/keys.verifyKey', {
      method: 'POST',
      headers: { authorization: `Bearer ${rootKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ key: accessKey })
    });
  } catch {
    throw new AppError('auth_unavailable', '授权验证服务连接失败，请稍后再试。', 503);
  }
  if (response.status === 429) throw new AppError('auth_unavailable', '授权验证服务繁忙，请稍后再试。', 503);
  if (!response.ok) throw new AppError('auth_unavailable', '授权验证服务不可用，请稍后再试。', 503);
  let payload;
  try { payload = await response.json(); } catch {
    throw new AppError('auth_unavailable', '授权验证服务返回内容无法识别，请稍后再试。', 503);
  }
  const data = payload?.data;
  if (!data || typeof data.valid !== 'boolean') {
    throw new AppError('auth_unavailable', '授权验证服务返回内容无法识别，请稍后再试。', 503);
  }
  if (!data.valid) {
    throw new AppError('unauthorized', INVALID_KEY_MESSAGES.get(data.code) || '访问凭据无效或已停用。', 401);
  }
  return data;
}
