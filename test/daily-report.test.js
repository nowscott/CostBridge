import test from 'node:test';
import assert from 'node:assert/strict';
import {previousShanghaiDay, buildDailyReport, sendDailyReport, createDailyReportHandler} from '../src/daily-report.js';

test('daily period uses Shanghai calendar days, including year boundaries', () => {
  assert.deepEqual(previousShanghaiDay(new Date('2026-11-13T01:00:00Z')), {date:'2026-11-12', start:'2026-11-11T16:00:00.000Z', end:'2026-11-12T16:00:00.000Z'});
  assert.equal(previousShanghaiDay(new Date('2026-12-31T16:00:00Z')).date, '2026-12-31');
});

test('report groups by key ID, separates unknown callers, and counts recovered fallback as success', () => {
  const report = buildDailyReport('2026-11-12', [
    {environment:'production', keyId:'a', keyName:'用户甲', status:200, totalMs:1000, usedFallback:true},
    {environment:'production', keyId:'a', keyName:'用户甲', status:502, totalMs:3000, errorMessage:'模型超时', usedFallback:true},
    {environment:'production', keyId:'b', keyName:'用户乙', status:200, totalMs:2000},
    {environment:'production', status:401, errorMessage:'访问凭据无效。', totalMs:0}
  ]);
  assert.match(report.content, /2 位用户，4 次请求：成功 2 次，失败 2 次/);
  assert.match(report.content, /用户甲：2 次，成功 1，失败 1/);
  assert.match(report.content, /未识别用户：1 次/);
  assert.match(report.content, /用户甲：模型超时（1 次）/);
  assert.match(report.content, /平均耗时 1.50 秒/);
  assert.match(report.content, /备用模型接管 2 次：成功 1，失败 1/);
  assert.match(buildDailyReport('2026-11-12', []).content, /昨日无调用/);
  assert.match(buildDailyReport('2026-11-12', [{status:200}]).content, /1 条历史记录未标注环境/);
});

test('PushPlus submission checks both HTTP and application status', async () => {
  let sent;
  const id = await sendDailyReport({title:'日报', content:'内容'}, 'secret', async (url, options) => {
    assert.equal(url, 'https://www.pushplus.plus/send');
    sent = JSON.parse(options.body);
    return {ok:true, json:async () => ({code:200, data:'message-id'})};
  });
  assert.equal(id, 'message-id');
  assert.deepEqual(sent, {token:'secret', title:'日报', content:'内容', template:'txt'});
  await assert.rejects(sendDailyReport({}, 'secret', async () => ({ok:true, json:async () => ({code:600})})), /pushplus_code_600/);
  await assert.rejects(sendDailyReport({}, 'secret', async () => ({ok:false, status:500})), /pushplus_http_500/);
});

test('daily endpoint protects access, reports send failure, and returns no user data', async () => {
  const names = ['CRON_SECRET','CALLLOG_DATABASE_URL','PUSHPLUS_TOKEN'];
  const previous = names.map(name => process.env[name]);
  const originalError = console.error, originalInfo = console.info;
  console.error = console.info = () => {};
  Object.assign(process.env, {CRON_SECRET:'cron', CALLLOG_DATABASE_URL:'database', PUSHPLUS_TOKEN:'push'});
  try {
    let reads = 0, fail = false;
    const handler = createDailyReportHandler({now:() => new Date('2026-11-13T01:00:00Z'), readRecords:async period => {
      reads++;
      assert.equal(period.date, '2026-11-12');
      return [{environment:'production', keyId:'id', keyName:'私有名称', status:200}];
    }, sendReport:async report => {
      assert.match(report.content, /私有名称/);
      if (fail) throw new Error('upstream secret');
      return 'message';
    }});
    const response = () => ({setHeader() {}, end(body) {this.body = body;}});
    let res = response();
    await handler({method:'GET', headers:{}}, res);
    assert.equal(res.statusCode, 401);
    assert.equal(reads, 0);
    res = response();
    await handler({method:'GET', headers:{authorization:'Bearer cron'}}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'OK');
    fail = true;
    res = response();
    await handler({method:'GET', headers:{authorization:'Bearer cron'}}, res);
    assert.equal(res.statusCode, 502);
    assert.doesNotMatch(res.body, /私有名称|secret/);
  } finally {
    names.forEach((name, i) => {if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i];});
    console.error = originalError;
    console.info = originalInfo;
  }
});
