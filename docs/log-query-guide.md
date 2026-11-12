# 日志查询与线上排查

核对日期：2026-11-12。包含 v0.13.2 待发布改动，新增字段仅部署后的新日志具备。依据当前代码和 Vercel 项目环境变量元数据；本次未读取真实日志行，未验证生产数据库连通性或定时清理执行结果。

## 查询入口

1. 打开 Vercel 的 CostBridge 项目，在 Storage / 集成中找到日志数据库，进入对应 Neon 项目；使用生产 `CALLLOG_DATABASE_URL` 对应的数据库和分支，在 SQL Editor 执行 `sql/query-call-logs.sql` 中需要的 SELECT。
2. 已有安全注入数据库连接串的环境中，可用项目依赖 `@neondatabase/serverless` 直接执行参数化 SELECT。当前仓库没有日志查询命令；本地服务也不会写入这些日志。不要将连接串粘贴到命令历史、报告或代码仓库。
3. 若数据库没有对应记录，进入 Vercel 项目的运行日志，按事发时间、部署、路由查找；重点搜索 `call_log_write_failed`、`call_log_schedule_failed`、`call_log_cleanup_failed`、`call_log_cleanup_skipped`。函数启动前拒绝、平台强制超时、后台写入失败可能不会留下数据库记录。
4. `GET /api/quota` 仅返回 Groq 最近一次额度快照，不能用于查询失败请求；项目没有公开的完整日志查询接口。授权 Key 的状态和额度需在 Unkey 对照检查，不要把访问凭据当成 Key ID。

本机存在 Vercel 项目绑定和 CLI 登录。只读项目配置确认 `CALLLOG_DATABASE_URL` 和 `CRON_SECRET` 已配置于 production、preview；本次 Vercel 环境变量读取返回元数据而未取得连接值，因此不能据此断言真实写入、保留期或近期错误情况正常。控制台入口的具体布局未实测。

## 数据路径和范围

`api/analyze*.js` → `src/api-handler.js` → `src/http.js` 收集诊断信息 → 响应结束后通过 Vercel `waitUntil` → Neon `call_logs.record`（JSONB）。

表字段为 `id`、`created_at`（数据库写入时间）、`record`。`record.time` 是请求开始时间。`environment` 区分 production、preview、development 或 local；`route` 仅保留路径，不保存查询参数。按上海时间显示，但筛选统一使用数据库时间与明确时区。现有索引仅覆盖 `created_at`，先限制时间范围，再筛选 JSON 字段。

清理计划每天 UTC 02:00（上海 10:00）删除写入时间超过 7 天的记录；配置见 `vercel.json` 与 `api/cleanup-call-logs.js`。配置存在不代表任务已成功执行；不能依赖此库进行长期趋势统计。

只有分析接口写调用日志，`/api/create-key`、`/api/quota` 不写此表。日志不保存原始账单、截图或识别结果，因此无法用它复原一次识别内容。

## 排查顺序

- 先看最近 24 小时状态汇总及最近失败，确认错误代码、固定文案、上游状态、时间和部署。
- `unauthorized`：查 Unkey；`auth_unavailable`：查授权服务及连接；`invalid_input`、`invalid_json`、`invalid_image`：结合固定文案检查快捷指令设置。
- `model_unavailable`：检查连接和超时；`model_error`：结合 `upstreamStatus`；`model_invalid`、`incomplete`：模型返回格式或交易字段不合格，日志不能还原账单。
- 对慢请求看 `totalMs`、`authMs`、`modelMs`；`inputMs` 包含读取、解析与校验；`modelMs` 包含全部模型尝试及结果校验，并非单家模型耗时。输入校验失败记录在 input 阶段。
- 已知事发时间时查前后数分钟；已知 `requestId` 或 `keyId` 时再缩小范围。响应 JSON 的 `requestId` 与 `x-costbridge-request-id` 响应头返回同一编号，日志也使用此编号；平台编号另存为 `platformRequestId`。旧日志的 requestId 仍可能是平台编号。小票文本目前不包含请求编号。
- 比较 `provider/model`（首选）与 `resultProvider/resultModel`（成功时实际使用），结合 `usedFallback` 看是否被备用救回。`attempts` 按顺序记录 provider、model、startedAt、durationMs、outcome、errorCode、upstreamStatus、willFallback 和可用的 usage；错误代码 timeout 与 connection_error 用于区分超时和其他连接错误，不记录异常原文或供应商响应正文。`lastAttemptProvider/lastAttemptModel` 在失败时也有值；`usedFallback` 表示是否实际进入第二次尝试。旧日志可能没有新字段，应将 NULL 解释为“未记录”。

## 剩余限制

- 历史日志无法补出环境及逐次尝试数据。使用新字段统计时仅选择包含对应字段的日志，旧记录另行统计。
- 生产与预览均配置了数据库变量，尚未确认是否同库；新日志可用 environment 筛选，旧日志仅能按部署与平台信息辅助判断。
- 后台写入失败现在在 Vercel 输出请求编号、平台编号、环境、路由和部署，但不会自动重试；平台强制终止时仍可能没有完整数据库记录。
- 不保存账单、截图、识别结果、访问凭据、完整 URL 或异常原文。模型未提供 token 用量时不估算，失败响应不解析正文；因而日志不能复原识别内容，也不能作为完整计费账本。
- 目前没有定时汇总或异常告警。下一步适合增加私有只读查询命令，再按真实流量确定告警阈值；不将完整诊断日志公开到额度接口。

新增字段写入现有 JSONB record，不需要表结构迁移；保留期仍为 7 天。
