import { clearSessionCookie, clearStateCookie, json } from '../../_lib/auth.js';

export async function onRequestPost() {
  const headers = new Headers();
  headers.append('Set-Cookie', clearSessionCookie());
  headers.append('Set-Cookie', clearStateCookie());
  return json({ ok: true }, { headers });
}

export async function onRequestGet() {
  return onRequestPost();
}
