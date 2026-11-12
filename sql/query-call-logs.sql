-- 只读排查模板：在目标 Neon 数据库 SQL Editor 中选择需要的 SELECT 执行。
-- 当前索引覆盖 created_at；先限制时间范围。时间显示为上海时间。

-- 1. 日志覆盖范围：可用于发现记录停更或实际保留期异常。
SELECT count(*) AS total,
       min(created_at) AT TIME ZONE 'Asia/Shanghai' AS oldest_shanghai,
       max(created_at) AT TIME ZONE 'Asia/Shanghai' AS newest_shanghai
FROM call_logs;

-- 2. 最近 24 小时按状态和错误汇总；NULL 可能是旧日志未记录。
SELECT record->>'status' AS status, record->>'errorCode' AS error_code,
       record->>'errorMessage' AS error_message, count(*) AS requests
FROM call_logs
WHERE created_at >= now() - interval '24 hours'
GROUP BY 1, 2, 3 ORDER BY requests DESC;

-- 3. 最近失败明细；不展示整份 record，避免无关元数据大量导出。
SELECT created_at AT TIME ZONE 'Asia/Shanghai' AS written_shanghai,
       record->>'time' AS request_time, record->>'requestId' AS request_id,
       record->>'deployment' AS deployment, record->>'status' AS status,
       record->>'stage' AS stage, record->>'errorCode' AS error_code,
       record->>'errorMessage' AS error_message,
       record->>'provider' AS preferred_provider,
       record->>'upstreamStatus' AS upstream_status,
       record->>'totalMs' AS total_ms
FROM call_logs
WHERE created_at >= now() - interval '24 hours'
  AND (record->>'status')::integer >= 400
ORDER BY created_at DESC, id DESC LIMIT 100;

-- 4. 慢请求与切换：不是单家供应商的性能/故障率统计。
SELECT created_at AT TIME ZONE 'Asia/Shanghai' AS written_shanghai,
       record->>'requestId' AS request_id, record->>'status' AS status,
       record->>'provider' AS preferred_provider,
       record->>'resultProvider' AS actual_provider,
       record->>'usedFallback' AS used_fallback,
       record->>'authMs' AS auth_ms, record->>'modelMs' AS model_ms,
       record->>'totalMs' AS total_ms
FROM call_logs
WHERE created_at >= now() - interval '24 hours'
ORDER BY (record->>'totalMs')::numeric DESC NULLS LAST, id DESC LIMIT 50;

-- 5. 单次请求追踪：替换 request-id-here；也可改为 record->>'keyId' 查询凭据历史。
SELECT created_at AT TIME ZONE 'Asia/Shanghai' AS written_shanghai, record
FROM call_logs
WHERE created_at >= now() - interval '7 days'
  AND record->>'requestId' = 'request-id-here'
ORDER BY created_at DESC, id DESC LIMIT 100;

-- 6. 按部署比较；当前没有环境字段，不能直接等同于生产/预览对比。
SELECT record->>'deployment' AS deployment,
       count(*) AS requests,
       count(*) FILTER (WHERE (record->>'status')::integer >= 400) AS errors,
       count(*) FILTER (WHERE record->>'usedFallback' = 'true') AS fallback_requests,
       max(created_at) AT TIME ZONE 'Asia/Shanghai' AS latest_shanghai
FROM call_logs
WHERE created_at >= now() - interval '24 hours'
GROUP BY 1 ORDER BY max(created_at) DESC;

-- 7. 新日志按环境、路由汇总；旧日志缺字段时明确列为 unknown。
SELECT COALESCE(record->>'environment', 'unknown') AS environment,
       COALESCE(record->>'route', 'unknown') AS route,
       count(*) AS requests,
       count(*) FILTER (WHERE (record->>'status')::integer >= 400) AS errors
FROM call_logs
WHERE created_at >= now() - interval '24 hours'
GROUP BY 1, 2 ORDER BY requests DESC;

-- 8. 逐供应商故障和切换统计；旧日志无 attempts 不参与。
-- 仅统计生产；要查预览时将 production 替换为 preview。
SELECT attempt->>'provider' AS provider,
       attempt->>'model' AS model,
       attempt->>'outcome' AS outcome,
       attempt->>'errorCode' AS error_code,
       attempt->>'upstreamStatus' AS upstream_status,
       count(*) AS attempts,
       count(*) FILTER (WHERE attempt->>'willFallback' = 'true') AS fallback_decisions,
       round(avg((attempt->>'durationMs')::numeric)) AS avg_ms
FROM call_logs
CROSS JOIN LATERAL jsonb_array_elements(record->'attempts') AS attempt
WHERE created_at >= now() - interval '24 hours'
  AND record->>'environment' = 'production'
GROUP BY 1, 2, 3, 4, 5 ORDER BY attempts DESC;

-- 9. 关联平台日志：旧日志没有 platformRequestId 时也尝试匹配旧 requestId。
SELECT created_at AT TIME ZONE 'Asia/Shanghai' AS written_shanghai, record
FROM call_logs
WHERE created_at >= now() - interval '7 days'
  AND (record->>'platformRequestId' = 'platform-id-here'
       OR record->>'requestId' = 'platform-id-here')
ORDER BY created_at DESC, id DESC LIMIT 100;
