export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function redirect(url, status = 302, headers = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('location', url);
  return new Response(null, { status, headers: responseHeaders });
}

export function getCookieMap(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const map = new Map();

  cookieHeader.split(';').forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    const index = trimmed.indexOf('=');
    if (index === -1) return;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    map.set(key, decodeURIComponent(value));
  });

  return map;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64UrlEncode(input) {
  return input.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return atob(padded);
}

export async function signSession(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const body = base64UrlEncode(btoa(JSON.stringify(payload)));
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const signature = base64UrlEncode(arrayBufferToBase64(signatureBuffer));
  return `${body}.${signature}`;
}

export async function verifySession(token, secret) {
  if (!token || !secret) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = base64UrlEncode(arrayBufferToBase64(signatureBuffer));
  if (expected !== signature) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (payload.exp && Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function getBaseUrl(request, env) {
  if (env.APP_BASE_URL) return env.APP_BASE_URL;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function createSessionCookie(token, maxAge = 60 * 60 * 24 * 7) {
  const parts = [
    `ts_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (typeof location === 'undefined') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookie() {
  return 'ts_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure';
}

export function createStateCookie(state, maxAge = 600) {
  return [
    `ts_oauth_state=${encodeURIComponent(state)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    'Secure',
  ].join('; ');
}

export function clearStateCookie() {
  return 'ts_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure';
}

export function generateRandomString(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
