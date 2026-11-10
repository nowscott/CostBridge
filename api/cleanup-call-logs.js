import { neon } from '@neondatabase/serverless';

export default async function cleanup(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    return res.end();
  }
  if (!process.env.CALLLOG_DATABASE_URL) {
    console.error('call_log_cleanup_skipped: CALLLOG_DATABASE_URL is not configured');
    res.statusCode = 503;
    return res.end();
  }
  try {
    const sql = neon(process.env.CALLLOG_DATABASE_URL);
    await sql`DELETE FROM call_logs WHERE created_at < now() - interval '7 days'`;
    res.statusCode = 204;
  } catch (error) {
    console.error('call_log_cleanup_failed', error?.message || error);
    res.statusCode = 503;
  }
  res.end();
}
