import { neon } from '@neondatabase/serverless';
import { fetchWithTimeout } from './timeouts.js';

export function previousShanghaiDay(now = new Date()) {
  const date = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const end = new Date(`${date}T00:00:00+08:00`);
  const start = new Date(end.getTime() - 86400_000);
  return {date: new Date(start.getTime() + 8 * 3600_000).toISOString().slice(0, 10), start: start.toISOString(), end: end.toISOString()};
}

export async function readDailyRecords(period, databaseUrl) {
  const sql = neon(databaseUrl);
  const rows = await sql`SELECT record FROM call_logs
    WHERE (record->>'environment' = 'production' OR NOT record ? 'environment')
      AND (record->>'route' IN ('/api/analyze', '/api/analyze-provider') OR NOT record ? 'route')
      AND (record->>'time')::timestamptz >= ${period.start}::timestamptz
      AND (record->>'time')::timestamptz < ${period.end}::timestamptz
    ORDER BY record->>'time'`;
  return rows.map(row => row.record);
}

export function buildDailyReport(date, allRecords) {
  const records = allRecords.filter(record => record.environment === 'production');
  const unclassified = allRecords.filter(record => !record.environment);
  const users = new Map();
  const unknown = records.filter(record => !record.keyId);
  for (const record of records) {
    if (!record.keyId) continue;
    if (!users.has(record.keyId)) users.set(record.keyId, {name: record.keyName || record.keyId, records: []});
    const user = users.get(record.keyId);
    if (record.keyName) user.name = record.keyName;
    user.records.push(record);
  }
  const succeeded = records.filter(record => record.status === 200).length;
  const [, month, day] = date.split('-');
  const title = `${Number(month)}月${Number(day)}日｜CostBridge`;
  const lines = ['每日使用汇报', `统计日期：${date}（北京时间 00:00—24:00，仅生产环境）`, '',
    `${users.size} 位用户，${records.length} 次请求：成功 ${succeeded} 次，失败 ${records.length - succeeded} 次。`];
  if (unclassified.length) lines.push(`另有 ${unclassified.length} 条历史记录未标注环境，未计入以上生产统计。`);
  if (!records.length) lines.push(unclassified.length ? '昨日没有可明确归为生产环境的调用记录。' : '昨日无调用。');
  if (users.size) lines.push('', '【用户情况】');
  for (const user of [...users.values()].sort((a, b) => b.records.length - a.records.length)) {
    const ok = user.records.filter(record => record.status === 200).length;
    lines.push(`${user.name}：${user.records.length} 次，成功 ${ok}，失败 ${user.records.length - ok}。`);
  }
  if (unknown.length) lines.push('', `未识别用户：${unknown.length} 次（未通过鉴权或无 Key ID），单独统计。`);
  const failures = records.filter(record => record.status !== 200);
  if (failures.length) {
    lines.push('', '【失败原因】');
    const groups = new Map();
    for (const record of failures) {
      const name = record.keyId ? users.get(record.keyId).name : '未识别用户';
      const reason = record.errorMessage || record.errorCode || `HTTP ${record.status}`;
      const key = JSON.stringify([record.keyId || '', reason]);
      if (!groups.has(key)) groups.set(key, {name, reason, count: 0});
      groups.get(key).count++;
    }
    for (const group of groups.values()) lines.push(`${group.name}：${group.reason}（${group.count} 次）`);
  }
  const timed = records.filter(record => Number.isFinite(record.totalMs));
  const fallback = records.filter(record => record.usedFallback);
  const fallbackOk = fallback.filter(record => record.status === 200).length;
  lines.push('', '【服务情况】');
  if (timed.length) lines.push(`平均耗时 ${(timed.reduce((sum, record) => sum + record.totalMs, 0) / timed.length / 1000).toFixed(2)} 秒。`);
  lines.push(`备用模型接管 ${fallback.length} 次：成功 ${fallbackOk}，失败 ${fallback.length - fallbackOk}。`);
  lines.push('', '成功指服务返回记账结果，不代表已写入 iCost。');
  return {title, content: lines.join('\n')};
}

export async function sendDailyReport(report, token, fetcher = fetch) {
  return fetchWithTimeout(fetcher, 'https://www.pushplus.plus/send', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({token, ...report, template: 'txt'})
  }, 10000, async response => {
    if (!response.ok) throw new Error(`pushplus_http_${response.status}`);
    const payload = await response.json();
    if (payload.code !== 200) throw new Error(`pushplus_code_${payload.code}`);
    return payload.data;
  });
}

export function createDailyReportHandler({readRecords = readDailyRecords, sendReport = sendDailyReport, now = () => new Date()} = {}) {
  return async function dailyReport(req, res) {
    res.setHeader('cache-control', 'no-store');
    if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
    if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      res.statusCode = 401;
      return res.end();
    }
    if (!process.env.CALLLOG_DATABASE_URL || !process.env.PUSHPLUS_TOKEN) {
      res.statusCode = 503;
      return res.end('Daily report is not configured');
    }
    const period = previousShanghaiDay(now());
    try {
      const records = await readRecords(period, process.env.CALLLOG_DATABASE_URL);
      const report = buildDailyReport(period.date, records);
      const messageId = await sendReport(report, process.env.PUSHPLUS_TOKEN);
      console.info('daily_report_accepted', {date: period.date, requests: records.length, messageId});
      res.statusCode = 200;
      res.end('OK');
    } catch {
      console.error('daily_report_failed', {date: period.date});
      res.statusCode = 502;
      res.end('Daily report failed');
    }
  };
}
