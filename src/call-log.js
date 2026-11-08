import { neon } from '@neondatabase/serverless';

export async function writeCallLog(record, databaseUrl = process.env.CALLLOG_DATABASE_URL) {
  const sql = neon(databaseUrl);
  await sql`INSERT INTO call_logs (record) VALUES (${JSON.stringify(record)}::jsonb)`;
}

export async function readLatestRateLimits(databaseUrl = process.env.CALLLOG_DATABASE_URL) {
  const sql = neon(databaseUrl);
  const rows = await sql`SELECT record->'rateLimits' AS limits, record->>'rateLimitsTime' AS time, record->>'model' AS model FROM call_logs WHERE record ? 'rateLimits' ORDER BY record->>'rateLimitsTime' DESC LIMIT 1`;
  return rows[0] || null;
}
