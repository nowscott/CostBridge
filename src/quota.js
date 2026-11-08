import { AppError } from './core.js';
import { readLatestRateLimits } from './call-log.js';

export async function handleQuota(req, res, read = readLatestRateLimits) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  try {
    if (req.method !== 'GET') throw new AppError('method_not_allowed', '请使用 GET。', 405);
    if (!process.env.CALLLOG_DATABASE_URL) throw new AppError('configuration_error', '限额记录尚未配置。', 503);
    const snapshot = await read();
    res.statusCode = 200;
    res.end(JSON.stringify({ok:true, snapshot}));
  } catch (error) {
    const known = error instanceof AppError;
    res.statusCode = known ? error.status : 503;
    res.end(JSON.stringify({ok:false, error:{code:known ? error.code : 'quota_unavailable', message:known ? error.message : '限额记录暂时不可用。'}}));
  }
}
