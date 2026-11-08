import { neon } from '@neondatabase/serverless';

export async function writeCallLog(record, databaseUrl = process.env.CALLLOG_DATABASE_URL) {
  const sql = neon(databaseUrl);
  await sql`INSERT INTO call_logs (record) VALUES (${JSON.stringify(record)}::jsonb)`;
}
