const quota = document.querySelector('#quota');
function showQuota(snapshot) {
  if (!snapshot) { quota.textContent = '暂无限额记录。'; return; }
  const limits = snapshot.limits;
  for (const [name, remaining, limit, reset] of [
    ['requests', limits.dailyRequestsRemaining, limits.dailyRequestsLimit, limits.requestsReset],
    ['tokens', limits.tokensPerMinuteRemaining, limits.tokensPerMinuteLimit, limits.tokensReset]
  ]) {
    const available = remaining != null && limit != null;
    document.querySelector(`#${name}-remaining`).textContent = available ? Number(remaining).toLocaleString('zh-CN') : '—';
    document.querySelector(`#${name}-limit`).textContent = available ? `/ ${Number(limit).toLocaleString('zh-CN')}` : '';
    document.querySelector(`#${name}-bar`).style.width = available && Number(limit) > 0 ? `${Math.max(0, Math.min(100, Number(remaining) / Number(limit) * 100))}%` : '0%';
    document.querySelector(`#${name}-reset`).textContent = reset ? `${name === 'requests' ? '日请求' : 'Token'}：快照后 ${reset} 恢复` : `${name === 'requests' ? '日请求' : 'Token'}：恢复时间未提供`;
  }
  quota.textContent = `快照 ${new Date(snapshot.time).toLocaleString('zh-CN')}`;
}
async function refreshQuota() {
  try {
    const response = await fetch('/api/quota');
    const body = await response.json();
    if (!body.ok) { quota.textContent = body.error.message; return; }
    showQuota(body.snapshot);
  } catch { quota.textContent = '限额记录暂时不可用，请稍后再试。'; }
}
refreshQuota();
setInterval(() => { if (!document.hidden) refreshQuota(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshQuota(); });
const form = document.querySelector('#form');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const val = id => document.getElementById(id).value.trim();
  const list = id => val(id).split(/[,，]/).map(x => x.trim()).filter(Boolean);
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  const now = `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const output = document.querySelector('#output');
  output.textContent = '正在识别，请稍候…';
  quota.textContent = '等待本次限额信息…';
  const button = form.querySelector('button'); button.disabled = true;
  try {
    const file = document.querySelector('#image').files[0];
    if (file && (file.type !== 'image/jpeg' || file.size > 3000000)) throw new Error('请选择小于 3 MB 的 JPEG 截图。');
    const source = file ? {image: (await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }))} : {text:val('text')};
    const response = await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${val('token')}`},body:JSON.stringify({...source,expenseCategories:list('expense'),incomeCategories:list('income'),accounts:list('accounts'),defaultAccount:val('default'),ruleAccount:val('rule'),now})});
    const body = await response.json();
    output.textContent = JSON.stringify(body,null,2);
    if (body.rateLimits && Object.values(body.rateLimits).some(value => value != null)) showQuota({limits:body.rateLimits, model:'qwen/qwen3.8-27b', time:body.rateLimitsTime});
    else quota.textContent = '本次未取得限额信息，稍后将自动更新。';
  } catch (error) { output.textContent = error.message === '请选择小于 3 MB 的 JPEG 截图。' ? error.message : '请求失败，请检查网络或服务配置。'; quota.textContent = '本次未取得 Groq 限额信息，稍后将自动更新。'; }
  finally { button.disabled = false; }
});
