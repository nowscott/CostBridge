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
  document.querySelector('#quota').textContent = '等待本次限额信息…';
  const button = form.querySelector('button'); button.disabled = true;
  try {
    const file = document.querySelector('#image').files[0];
    if (file && (file.type !== 'image/jpeg' || file.size > 3000000)) throw new Error('请选择小于 3 MB 的 JPEG 截图。');
    const source = file ? {image: (await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }))} : {text:val('text')};
    const response = await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${val('token')}`},body:JSON.stringify({...source,expenseCategories:list('expense'),incomeCategories:list('income'),accounts:list('accounts'),defaultAccount:val('default'),ruleAccount:val('rule'),now})});
    const body = await response.json();
    output.textContent = JSON.stringify(body,null,2);
    const limits = body.rateLimits;
    document.querySelector('#quota').textContent = [limits?.dailyRequestsRemaining, limits?.dailyRequestsLimit, limits?.tokensPerMinuteRemaining, limits?.tokensPerMinuteLimit].every(value => value != null)
      ? `Groq 当次调用后：每日请求剩余 ${limits.dailyRequestsRemaining} / ${limits.dailyRequestsLimit}；每分钟 token 剩余 ${limits.tokensPerMinuteRemaining} / ${limits.tokensPerMinuteLimit}。这是共享限额快照，实际可用量可能变化。`
      : '本次未取得 Groq 限额信息。';
  } catch (error) { output.textContent = error.message === '请选择小于 3 MB 的 JPEG 截图。' ? error.message : '请求失败，请检查网络或服务配置。'; document.querySelector('#quota').textContent = '本次未取得 Groq 限额信息。'; }
  finally { button.disabled = false; }
});
