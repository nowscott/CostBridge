import { CREATE_KEY_TIMEOUT_MS, fetchWithTimeout } from './timeouts.js';

export async function handleCreateKey(req, res, fetcher = fetch) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  const send = (ok, message, key = '') => {
    res.statusCode = 200;
    res.end(JSON.stringify({ok, message, key}));
  };
  if (req.method !== 'POST') return send(false, '请使用 POST。');
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ') || !auth.slice(7).trim()) return send(false, '请配置 Unkey Root Key。');
  if (!process.env.UNKEY_CREATE_API_ID) return send(false, '服务端未配置 Unkey API ID。');
  let body = req.body;
  if (body === undefined) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 4096) return send(false, '请求内容过大。');
    }
    body = raw;
  }
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return send(false, '请求不是有效的 JSON。'); }
  }
  if (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 255) return send(false, '请输入有效的 Key 名称。');
  let response;
  try {
    response = await fetchWithTimeout(fetcher, 'https://api.unkey.com/v2/keys.createKey', {
      method: 'POST',
      headers: {authorization: auth, 'content-type': 'application/json'},
      body: JSON.stringify({apiId: process.env.UNKEY_CREATE_API_ID, name: body.name.trim(), prefix: 'cb', byteLength: 32})
    }, CREATE_KEY_TIMEOUT_MS);
  } catch {
    return send(false, '连接 Unkey 失败，Key 可能已经创建，请先检查 Unkey 后台。');
  }
  if (response.status === 401 || response.status === 403) return send(false, 'Root Key 无效或权限不足。');
  if (response.status === 429) return send(false, 'Unkey 请求过于频繁，请稍后再试。');
  if (!response.ok) return send(false, `Unkey 创建失败（HTTP ${response.status}），请检查后台。`);
  let data;
  try { data = await response.json(); } catch { return send(false, 'Unkey 响应无法解析，Key 可能已经创建，请先检查后台。'); }
  if (typeof data?.data?.key !== 'string' || !data.data.key.trim()) return send(false, 'Unkey 未返回 Key，Key 可能已经创建，请先检查后台。');
  return send(true, 'Key 已生成并复制到剪贴板。', data.data.key);
}
