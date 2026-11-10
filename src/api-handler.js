import { waitUntil } from '@vercel/functions';
import { handle } from './http.js';
import { writeCallLog } from './call-log.js';

export function createHandler(options = {}) {
  return function handler(req, res) {
    return handle(req, res, record => {
      if (!process.env.CALLLOG_DATABASE_URL) return;
      try {
        waitUntil(new Promise(resolve => setImmediate(resolve)).then(() => writeCallLog(record)).catch(() => {
          console.error('call_log_write_failed');
        }));
      } catch {
        console.error('call_log_schedule_failed');
      }
    }, options);
  };
}
