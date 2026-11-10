import { createRequire } from 'node:module';
import { MODELS } from './models.js';

const version = createRequire(import.meta.url)('../package.json').version;
const PLAIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const STYLED = [...'𝓐𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗'];
const styleReceipt = text => text.replace(/[A-Za-z0-9]/g, char => STYLED[PLAIN.indexOf(char)]);

export class AppError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function validateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('invalid_input', '请求必须是 JSON 对象。');
  const { image, text, defaultAccount } = body;
  for (const key of ['expenseCategories', 'incomeCategories', 'accounts']) {
    if (typeof body[key] === 'string') body[key] = body[key].split(/[,，;；\n]/).map(v => v.trim().replace(/\u200b/g, '')).filter(Boolean);
  }
  const { expenseCategories, incomeCategories, accounts } = body;
  if (!body.now) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p => [p.type,p.value]));
    body.now = `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
  }
  const now = body.now;
  if ((!image && !text) || (image && text)) throw new AppError('invalid_input', '请提供一张截图或一段文本。');
  if (image && (typeof image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 4000000)) throw new AppError('invalid_image', '截图必须为不超过限制的 JPEG Base64。');
  if (text && (typeof text !== 'string' || text.length > 10000)) throw new AppError('invalid_input', '文本内容无效或过长。');
  for (const [name, value] of Object.entries({ expenseCategories, incomeCategories, accounts })) {
    if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || !v.trim())) throw new AppError('invalid_input', `${name} 必须是非空文本列表。`);
  }
  if (body.customPrompt !== undefined && (typeof body.customPrompt !== 'string' || body.customPrompt.length > 2000)) throw new AppError('invalid_input', '自定义提示词必须是不超过 2000 字的文本。');
  if (body.customPrompt === undefined && body.ruleAccount !== undefined && !accounts.includes(body.ruleAccount)) throw new AppError('invalid_input', '特殊规则账户必须在账户列表中。');
  if (!validDate(now)) throw new AppError('invalid_input', '当前时间须为 yyyy/MM/dd HH:mm。');
  return body;
}

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(s)) return false;
  const [y,m,d,h,min] = s.match(/\d+/g).map(Number);
  const date = new Date(Date.UTC(y,m-1,d,h,min));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d && h < 24 && min < 60;
}

export function normalize(result, input) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new AppError('model_invalid', '模型返回内容无法识别。', 502);
  const {type, amount, date, category, remark} = result;
  const cents = typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
  if (!['收入','支出'].includes(type) || !Number.isInteger(cents) || cents === 0 || Math.abs(amount) > 100000000 || Math.abs(amount * 100 - cents) > 1e-6 || !validDate(date)) throw new AppError('incomplete', '金额、收支类型或时间不完整，请核对原始账单。', 422);
  const categories = type === '收入' ? input.incomeCategories : input.expenseCategories;
  if (!categories.includes(category)) throw new AppError('incomplete', '无法确定有效分类，请核对原始账单。', 422);
  if (typeof remark !== 'string' || [...remark].length > 40) throw new AppError('incomplete', '备注不符合要求，请核对原始账单。', 422);
  const warnings = [];
  const validDefault = input.accounts.includes(input.defaultAccount);
  if (!validDefault) warnings.push('默认账户不在账户列表中，请检查快捷指令设置。');
  let account = result.account;
  if (input.customPrompt === undefined && input.ruleAccount && result.accountRuleApplied === true) {
    if (!input.accounts.includes(input.ruleAccount)) throw new AppError('incomplete', '特殊规则指定的账户不在账户列表中。', 422);
    account = input.ruleAccount;
    warnings.push('已按 Apple Pay/0822 特殊规则选择账户，请核对。');
  }
  if (!input.accounts.includes(account)) {
    if (!validDefault) throw new AppError('incomplete', '账户未识别，且默认账户不在账户列表中，请检查快捷指令设置后重试。', 422);
    account = input.defaultAccount;
    warnings.push('账户未识别，使用默认账户，请核对。');
  }
  if (input.customPrompt?.trim() && result.accountRuleApplied === true) warnings.push('模型已按自定义规则判断账户，请核对。');
  warnings.push('分类由模型判断，请核对后再入账。');
  return {type, amount: (type === '支出' ? -1 : 1) * Math.abs(cents) / 100, currency:'CNY', date, category, account, remark, warnings};
}

export function prompt(input) {
  const rule = input.customPrompt !== undefined ? input.customPrompt.trim() : input.ruleAccount ? `If the source explicitly shows Apple Pay or 0822, choose ${input.ruleAccount}.` : '';
  return `Extract one bookkeeping transaction. JSON only: {"date":"yyyy/MM/dd HH:mm","type":"收入/支出","amount":number,"category":"二级分类","remark":"备注","account":"账户","accountRuleApplied":boolean}. CNY; expense=-, income=+. Use transaction time, else DATE. category=exact item from EXP/INC only. account=exact ACC. Unknown→DEF. remark≤40 Chinese chars. Apply CUSTOM RULE only when relevant; set accountRuleApplied true only when you applied it. Never invent details. EXP:${JSON.stringify(input.expenseCategories)} INC:${JSON.stringify(input.incomeCategories)} ACC:${JSON.stringify(input.accounts)} DEF:${JSON.stringify(input.accounts.includes(input.defaultAccount) ? input.defaultAccount : '')} CUSTOM RULE:${JSON.stringify(rule)} DATE:${input.now} JSON only.`;
}

export function buildIcostUrl(transaction) {
  const path = transaction.type === '支出' ? 'expense' : 'income';
  const [date, time] = transaction.date.split(' ');
  const params = new URLSearchParams({amount:String(Math.abs(transaction.amount)), currency:transaction.currency, account:transaction.account, category:transaction.category, date:date.replaceAll('/','.'), time, remark:transaction.remark});
  return `iCost://${path}?${params}`;
}

export function buildPreview(tx, rateLimits, elapsedSeconds, usedFallback = false) {
  const amount = `${tx.type === '支出' ? '−' : '+'}${Math.abs(tx.amount).toFixed(2)}`;
  const line = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';
  const accountNote = tx.warnings.some(warning => warning.startsWith('账户未识别')) ? '（默认）'
    : tx.warnings.some(warning => warning.startsWith('已按 Apple Pay') || warning.startsWith('模型已按自定义规则')) ? '（规则）' : '';
  return styleReceipt([
    `🧾  记账小票〔${usedFallback ? MODELS.fallback.label : MODELS.primary.label}〕`,
    line,
    '',
    `${tx.type}  ${amount}\u00a0CNY`,
    '',
    line,
    `⏰ 时间  ${tx.date}`,
    `💳 账户  ${tx.account}${accountNote}`,
    ...tx.warnings.filter(warning => warning.startsWith('默认账户不在')).map(warning => `⚠️ ${warning}`),
    `📂 分类  ${tx.category}`,
    `📝 备注  ${tx.remark || '无'}`,
    line,
    ...(usedFallback ? [] : [`📊 今日请求剩余  ${rateLimits?.dailyRequestsRemaining != null && rateLimits?.dailyRequestsLimit != null ? `${rateLimits.dailyRequestsRemaining} / ${rateLimits.dailyRequestsLimit} 次` : '未提供'}`]),
    ...(elapsedSeconds === undefined ? [] : [`⏱️ 请求耗时  ${elapsedSeconds.toFixed(2)} 秒`]),
    line,
    '确认以上信息后入账？',
    '',
    `Powered by CostBridge · v${version}`
  ].join('\n'));
}
