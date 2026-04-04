import test from 'node:test';
import assert from 'node:assert/strict';
import {
  json,
  redirect,
  getCookieMap,
  signSession,
  verifySession,
  getBaseUrl,
  createSessionCookie,
  clearSessionCookie,
  createStateCookie,
  clearStateCookie,
  generateRandomString,
} from '../functions/_lib/auth.js';

// ===== json() =====

test('json() returns Response with JSON body and correct content-type', async () => {
  const res = json({ ok: true });
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
});

test('json() respects custom status and headers', async () => {
  const res = json({ error: 'not_found' }, {
    status: 404,
    headers: { 'x-custom': 'test' },
  });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('x-custom'), 'test');
});

// ===== redirect() =====

test('redirect() returns 302 with Location header', () => {
  const res = redirect('https://example.com');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://example.com');
});

test('redirect() supports custom status code', () => {
  const res = redirect('/login', 301);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/login');
});

// ===== getCookieMap() =====

test('getCookieMap parses multiple cookies', () => {
  const request = {
    headers: { get: (name) => name === 'cookie' ? 'a=1; b=hello%20world; c=3' : null },
  };
  const map = getCookieMap(request);
  assert.equal(map.get('a'), '1');
  assert.equal(map.get('b'), 'hello world');
  assert.equal(map.get('c'), '3');
});

test('getCookieMap handles empty cookie header', () => {
  const request = {
    headers: { get: () => null },
  };
  const map = getCookieMap(request);
  assert.equal(map.size, 0);
});

test('getCookieMap handles cookie with equals in value', () => {
  const request = {
    headers: { get: (name) => name === 'cookie' ? 'token=abc=def=ghi' : null },
  };
  const map = getCookieMap(request);
  assert.equal(map.get('token'), 'abc=def=ghi');
});

// ===== signSession / verifySession =====

test('signSession + verifySession roundtrip', async () => {
  const payload = { sub: '123', email: 'test@test.com', exp: Date.now() + 100000 };
  const secret = 'test-secret-key';

  const token = await signSession(payload, secret);
  assert.ok(token.includes('.'), 'token should have body.signature format');

  const verified = await verifySession(token, secret);
  assert.deepEqual(verified.sub, '123');
  assert.deepEqual(verified.email, 'test@test.com');
});

test('verifySession rejects tampered token', async () => {
  const payload = { sub: '123', exp: Date.now() + 100000 };
  const token = await signSession(payload, 'secret-1');

  // 验证用不同的 secret
  const result = await verifySession(token, 'secret-2');
  assert.equal(result, null);
});

test('verifySession rejects expired token', async () => {
  const payload = { sub: '123', exp: Date.now() - 1000 };
  const secret = 'test-secret';
  const token = await signSession(payload, secret);

  const result = await verifySession(token, secret);
  assert.equal(result, null);
});

test('verifySession returns null for empty/invalid input', async () => {
  assert.equal(await verifySession(null, 'secret'), null);
  assert.equal(await verifySession('', 'secret'), null);
  assert.equal(await verifySession('no-dot', 'secret'), null);
  assert.equal(await verifySession(undefined, 'secret'), null);
});

// ===== getBaseUrl() =====

test('getBaseUrl uses env.APP_BASE_URL when available', () => {
  const request = { url: 'https://fallback.com/path' };
  const env = { APP_BASE_URL: 'https://custom.example.com' };
  assert.equal(getBaseUrl(request, env), 'https://custom.example.com');
});

test('getBaseUrl falls back to request URL', () => {
  const request = { url: 'https://auto.example.com/some/path?q=1' };
  const env = {};
  assert.equal(getBaseUrl(request, env), 'https://auto.example.com');
});

// ===== Cookie helpers =====

test('createSessionCookie contains expected parts', () => {
  const cookie = createSessionCookie('my-token', 3600);
  assert.ok(cookie.includes('ts_session=my-token'));
  assert.ok(cookie.includes('Path=/'));
  assert.ok(cookie.includes('HttpOnly'));
  assert.ok(cookie.includes('SameSite=Lax'));
  assert.ok(cookie.includes('Max-Age=3600'));
});

test('clearSessionCookie sets Max-Age=0', () => {
  const cookie = clearSessionCookie();
  assert.ok(cookie.includes('ts_session='));
  assert.ok(cookie.includes('Max-Age=0'));
});

test('createStateCookie contains expected parts', () => {
  const cookie = createStateCookie('state-value', 300);
  assert.ok(cookie.includes('ts_oauth_state=state-value'));
  assert.ok(cookie.includes('Max-Age=300'));
  assert.ok(cookie.includes('HttpOnly'));
});

test('clearStateCookie sets Max-Age=0', () => {
  const cookie = clearStateCookie();
  assert.ok(cookie.includes('ts_oauth_state='));
  assert.ok(cookie.includes('Max-Age=0'));
});

// ===== generateRandomString =====

test('generateRandomString returns correct length hex string', () => {
  const str = generateRandomString(16);
  assert.equal(str.length, 32); // 16 bytes → 32 hex chars
  assert.match(str, /^[0-9a-f]+$/);
});

test('generateRandomString defaults to 32 bytes', () => {
  const str = generateRandomString();
  assert.equal(str.length, 64); // 32 bytes → 64 hex chars
});

test('generateRandomString produces unique values', () => {
  const a = generateRandomString();
  const b = generateRandomString();
  assert.notEqual(a, b);
});
