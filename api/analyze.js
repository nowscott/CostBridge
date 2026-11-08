import { waitUntil } from '@vercel/functions';
import { handle } from '../src/http.js';
import { writeCallLog } from '../src/call-log.js';

export default function handler(req, res) {
  return handle(req, res, record => {
    if (!process.env.CALLLOG_DATABASE_URL) return;
    try {
      waitUntil(new Promise(resolve => setImmediate(resolve)).then(() => writeCallLog(record)).catch(() => {
        console.error('call_log_write_failed');
      }));
    } catch {
      console.error('call_log_schedule_failed');
    }
  });
}
