import test from 'node:test';
import assert from 'node:assert/strict';
import { serveStatic } from '../src/static.js';

function mockResponse() {
  const res = { statusCode: 0, headers: {}, body: undefined };
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; };
  res.end = body => { res.body = body; };
  return res;
}

test('serves the landing page and every referenced asset including the favicon', async () => {
  const routes = [
    ['/', 'text/html'],
    ['/style.css', 'text/css'],
    ['/app.js', 'text/javascript'],
    ['/favicon.svg', 'image/svg+xml']
  ];
  for (const [url, type] of routes) {
    const res = mockResponse();
    assert.equal(await serveStatic({ method: 'GET', url }, res), true);
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].startsWith(type));
    assert.ok(res.body.length > 0);
  }
});

test('ignores query strings and declines non-GET or unknown paths', async () => {
  assert.equal(await serveStatic({ method: 'GET', url: '/?ref=x' }, mockResponse()), true);
  assert.equal(await serveStatic({ method: 'POST', url: '/' }, mockResponse()), false);
  assert.equal(await serveStatic({ method: 'GET', url: '/missing.js' }, mockResponse()), false);
});
