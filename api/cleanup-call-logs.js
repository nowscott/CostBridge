import { neon } from '@neondatabase/serverless';

export default async function cleanup(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    return res.end();
  }
  const sql = neon(process.env.CALLLOG_DATABASE_URL);
  await sql`DELETE FROM call_logs WHERE created_at < now() - interval '7 days'`;
  res.statusCode = 204;
  res.end();
}
