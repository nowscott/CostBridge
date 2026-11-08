import { readFile } from 'node:fs/promises';

const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml']
};

export async function serveStatic(req, res) {
  const path = (req.url || '').split('?')[0];
  const entry = req.method === 'GET' && FILES[path];
  if (!entry) return false;
  const [file, contentType] = entry;
  let body;
  try { body = await readFile(new URL(`../public/${file}`, import.meta.url)); }
  catch { return false; }
  res.writeHead(200, { 'content-type': contentType });
  res.end(body);
  return true;
}
